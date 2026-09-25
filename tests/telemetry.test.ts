import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer } from "node:http";
import { once } from "node:events";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Project, ObservedSpan } from "../shared/types.js";

const scratch = mkdtempSync(path.join(tmpdir(), "workbench-telemetry-test-"));
process.env.WORKBENCH_DATA_DIR = scratch;
const { state } = await import("../server/store.js");
const {
  createReceiver,
  authorizeReceiver,
  receiverStatus,
  disconnectReceiver,
  recordTrace,
  traceSchema,
} = await import("../server/telemetry.js");
const { redact } = await import("../server/providers.js");
after(() => rmSync(scratch, { recursive: true, force: true }));
let sequence = 0;
const start = "2026-09-25T10:00:00.000Z";
const end = "2026-09-25T10:00:01.000Z";
function project(source = true): Project {
  const id = `native-test-${++sequence}`;
  const p: Project = {
    id,
    name: "Fixture app",
    brief: "Synthetic fixture",
    createdAt: start,
    updatedAt: start,
    graph: {
      id: `graph-${id}`,
      revision: 7,
      name: "Source workflow",
      description: "Fixture graph",
      nodes: [
        {
          id: "entry",
          label: "Entry",
          role: "orchestrator",
          prompt: "Original prompt",
          source: { path: "src/app.ts", symbol: "main" },
        },
        {
          id: "research",
          label: "Research",
          role: "agent",
          source: { path: "src/research.ts", symbol: "research" },
        },
        { id: "ui", label: "Interface", role: "resource", hidden: true },
      ],
      edges: [
        {
          id: "entry-research",
          source: "entry",
          target: "research",
          kind: "dependency",
          label: "Source relation",
          provenance: "inferred",
        },
      ],
      limits: {
        maxCalls: 4,
        maxRevisions: 1,
        timeoutMs: 10000,
        maxOutputTokens: 256,
      },
    },
    ...(source
      ? {
          repo: {
            path: "/synthetic",
            name: "Fixture app",
            revision: "fixture",
            adapter: "discovery-only" as const,
            sources: [],
            coverage: [],
            limitations: [],
          },
        }
      : {}),
  };
  state.projects.push(p);
  return p;
}
function span(id: string, extra: Partial<ObservedSpan> = {}): ObservedSpan {
  return {
    id,
    name: id,
    status: "completed",
    startTime: start,
    endTime: end,
    ...extra,
  };
}

test("native tokens are project scoped, rotate, disconnect and remain redacted", () => {
  const a = project(),
    b = project();
  const first = createReceiver(a.id),
    other = createReceiver(b.id);
  assert.doesNotThrow(() => authorizeReceiver(a.id, `Bearer ${first.token}`));
  assert.throws(
    () => authorizeReceiver(b.id, `Bearer ${first.token}`),
    /another project/,
  );
  assert.throws(
    () => authorizeReceiver(a.id, `Bearer ${other.token}`),
    /another project/,
  );
  assert.throws(() => authorizeReceiver(a.id), /missing/);
  const second = createReceiver(a.id);
  assert.notEqual(second.token, first.token);
  assert.throws(
    () => authorizeReceiver(a.id, `Bearer ${first.token}`),
    /expired/,
  );
  assert.doesNotThrow(() => authorizeReceiver(a.id, `Bearer ${second.token}`));
  disconnectReceiver(a.id);
  assert.equal(receiverStatus(a.id).enabled, false);
  assert.throws(
    () => authorizeReceiver(a.id, `Bearer ${second.token}`),
    /expired/,
  );
  assert.equal(
    redact(`${first.token} ${second.token}`),
    "[REDACTED] [REDACTED]",
  );
});

test("native start, update and final preserve the source snapshot and map known nodes", () => {
  const p = project();
  createReceiver(p.id);
  const root = span("root", {
    nodeId: "entry",
    status: "running",
    endTime: undefined,
    input: "question",
  });
  const initial = recordTrace(p.id, {
    traceId: "lifecycle",
    status: "running",
    input: "question",
    spans: [root],
  });
  const runId = initial.id;
  p.graph.revision = 8;
  p.graph.nodes[0].prompt = "Edited prompt";
  const child = span("child", {
    parentId: "root",
    source: { path: "src/research.ts", symbol: "research" },
    model: "fixture-model",
    output: "evidence",
    usage: { inputTokens: 12, outputTokens: 7 },
  });
  const update = recordTrace(p.id, { traceId: "lifecycle", spans: [child] });
  assert.equal(update.status, "running");
  assert.equal(update.id, runId);
  assert.equal(update.graph.revision, 7);
  assert.equal(update.graph.nodes[0].prompt, "Original prompt");
  assert.equal(update.graph.nodes.length, 3);
  assert.equal(
    update.events.find((e) => e.id === "child:end")?.nodeId,
    "research",
  );
  assert.ok(
    update.graph.edges.some(
      (e) =>
        e.source === "entry" &&
        e.target === "research" &&
        e.provenance === "observed",
    ),
  );
  const finalRoot = {
    ...root,
    status: "completed",
    endTime: end,
    output: "answer",
  };
  const completed = recordTrace(p.id, {
    traceId: "lifecycle",
    status: "completed",
    spans: [finalRoot],
    output: "answer",
  });
  assert.equal(completed.status, "completed");
  assert.equal(completed.output, "answer");
  assert.equal(completed.external?.partial, false);
  assert.equal(completed.external?.spans.length, 2);
  assert.deepEqual(completed.usage, { inputTokens: 12, outputTokens: 7 });
  assert.equal(completed.events.at(-1)?.type, "run.completed");
  const saved = JSON.stringify(completed);
  assert.equal(
    recordTrace(p.id, {
      traceId: "lifecycle",
      status: "completed",
      spans: [finalRoot],
      output: "answer",
    }).id,
    runId,
  );
  assert.equal(JSON.stringify(completed), saved);
  assert.throws(
    () =>
      recordTrace(p.id, {
        traceId: "lifecycle",
        spans: [{ ...child, output: "rewritten" }],
      }),
    /immutable/,
  );
  assert.equal(JSON.stringify(completed), saved);
  assert.ok(receiverStatus(p.id).lastReceivedAt);
});

test("external evidence redacts tokens in every persisted field", () => {
  const p = project(false);
  const { token } = createReceiver(p.id);
  const r = recordTrace(p.id, {
    traceId: "redaction",
    name: token,
    status: "failed",
    input: token,
    spans: [
      span("bad", {
        name: token,
        status: "failed",
        input: { secret: token },
        output: token,
        error: token,
      }),
    ],
  });
  assert.ok(!JSON.stringify(r).includes(token));
  assert.ok(
    !readFileSync(path.join(scratch, "workspace.json"), "utf8").includes(token),
  );
  assert.ok(
    !readFileSync(path.join(scratch, "events.jsonl"), "utf8").includes(token),
  );
  assert.equal(r.error, "[REDACTED]");
});

test("duplicate IDs, parent cycles and premature completion do not persist", () => {
  const p = project();
  const count = state.runs.length;
  assert.throws(
    () =>
      recordTrace(p.id, {
        traceId: "duplicate",
        spans: [span("a"), span("a")],
      }),
    /Duplicate/,
  );
  assert.throws(
    () =>
      recordTrace(p.id, {
        traceId: "cycle",
        spans: [span("a", { parentId: "b" }), span("b", { parentId: "a" })],
      }),
    /cycle/,
  );
  assert.throws(
    () =>
      recordTrace(p.id, {
        traceId: "premature",
        status: "completed",
        spans: [span("a", { status: "running", endTime: undefined })],
      }),
    /Complete every span/,
  );
  assert.equal(state.runs.length, count);
});

test("missing parents remain partial without invented nodes; trace-only projects use observed structure", () => {
  const p = project(false);
  const r = recordTrace(p.id, {
    traceId: "partial",
    spans: [span("child", { parentId: "unknown", name: "Actual operation" })],
  });
  assert.equal(r.external?.partial, true);
  assert.deepEqual(
    r.graph.nodes.map((n) => n.label),
    ["Actual operation"],
  );
  assert.equal(r.graph.edges.length, 0);
  assert.equal(p.graph.nodes.length, 3);
});

test("completed span batches remain open until an explicit native trace completion", () => {
  const p = project(false);
  const child = span("child-first", {
    parentId: "late-root",
    output: "evidence",
  });
  const first = recordTrace(p.id, { traceId: "out-of-order", spans: [child] });
  assert.equal(first.status, "running");
  assert.equal(first.external?.partial, true);
  assert.equal(first.finishedAt, undefined);
  assert.ok(!first.events.some((event) => event.type === "run.completed"));

  const root = span("late-root", { output: "answer" });
  const updated = recordTrace(p.id, { traceId: "out-of-order", spans: [root] });
  assert.equal(updated.id, first.id);
  assert.equal(updated.status, "running");
  assert.equal(updated.external?.spans.length, 2);
  assert.equal(
    updated.graph.edges.filter((edge) => edge.provenance === "observed").length,
    1,
  );

  const final = recordTrace(p.id, {
    traceId: "out-of-order",
    status: "completed",
    output: "answer",
    spans: [root],
  });
  assert.equal(final.status, "completed");
  assert.equal(final.external?.partial, false);
  assert.equal(final.output, "answer");
  assert.throws(
    () =>
      recordTrace(p.id, {
        traceId: "out-of-order",
        spans: [span("unexpected-later-child", { parentId: "late-root" })],
      }),
    /immutable/,
  );
});

test("registered credentials in JSON property names are redacted without losing colliding values", () => {
  const p = project(false);
  const first = createReceiver(p.id).token;
  const second = createReceiver(p.id).token;
  const input = { [first]: "one", [second]: "two", "[REDACTED]": "three" };
  const result = recordTrace(p.id, {
    traceId: "key-redaction",
    status: "completed",
    spans: [span("keys", { input, output: { nested: input } })],
  });
  const saved = JSON.stringify(result);
  const workspace = readFileSync(path.join(scratch, "workspace.json"), "utf8");
  for (const token of [first, second]) {
    assert.ok(!saved.includes(token));
    assert.ok(!workspace.includes(token));
  }
  const sanitized = result.external!.spans[0].input as Record<string, string>;
  assert.equal(Object.keys(sanitized).length, 3);
  assert.deepEqual(Object.values(sanitized).sort(), ["one", "three", "two"]);
  assert.deepEqual(
    (result.external!.spans[0].output as { nested: unknown }).nested,
    sanitized,
  );
});

test("span timestamps reject end-before-start even across timezone offsets", () => {
  assert.throws(
    () =>
      traceSchema.parse({
        traceId: "offset",
        spans: [
          span("a", {
            startTime: "2026-09-25T10:00:00+00:00",
            endTime: "2026-09-25T11:00:00+02:00",
          }),
        ],
      }),
    /precedes/,
  );
});

test("JavaScript and Python helpers send nested real operations to the local receiver", async () => {
  const p = project(false),
    { token } = createReceiver(p.id);
  const received: unknown[] = [],
    rejected: string[] = [];
  const server = createServer(async (req, res) => {
    try {
      authorizeReceiver(p.id, req.headers.authorization);
      const buffers: Buffer[] = [];
      for await (const data of req) buffers.push(Buffer.from(data));
      const payload = JSON.parse(Buffer.concat(buffers).toString());
      received.push(payload);
      const run = recordTrace(p.id, payload);
      res
        .writeHead(200, { "Content-Type": "application/json" })
        .end(JSON.stringify({ id: run.id }));
    } catch (error) {
      rejected.push((error as Error).message);
      res.writeHead(400).end("Rejected fixture payload");
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const url = `http://127.0.0.1:${address.port}/trace`;
  try {
    const sdkUrl = new URL("../sdk/workbench-client.mjs", import.meta.url).href;
    const { WorkbenchTrace } = await import(sdkUrl);
    const trace = new WorkbenchTrace("JS app", {
      url,
      token,
      input: "question",
    });
    assert.equal(
      await trace.run(() =>
        trace.span("Research", async () => "JS answer", { role: "agent" }),
      ),
      "JS answer",
    );
    const js = state.runs.find((r) => r.external?.traceId === trace.traceId)!;
    assert.equal(js.status, "completed");
    assert.equal(js.output, "JS answer");
    assert.equal(js.external?.spans.length, 2);
    assert.equal(js.graph.edges.length, 1);
    const sdkPath = path.resolve("sdk/workbench-client.py");
    const program = `import importlib.util\nspec=importlib.util.spec_from_file_location('workbench_client', ${JSON.stringify(sdkPath)})\nm=importlib.util.module_from_spec(spec)\nspec.loader.exec_module(m)\nt=m.WorkbenchTrace('Python app', input='question')\nwith t.run() as root:\n    with t.span('Research', role='agent') as child:\n        child['output']='Python answer'\n    root['output']=child['output']\nprint(t.trace_id)`;
    const result = await promisify(execFile)("python3", ["-c", program], {
      env: {
        PATH: process.env.PATH,
        WORKBENCH_URL: url,
        WORKBENCH_TOKEN: token,
      },
      timeout: 10000,
    });
    assert.equal(result.stderr, "");
    const python = state.runs.find(
      (r) => r.external?.traceId === result.stdout.trim(),
    )!;
    assert.equal(python.status, "completed");
    assert.equal(python.output, "Python answer");
    assert.equal(python.external?.spans.length, 2);
    assert.equal(python.graph.edges.length, 1);
    assert.equal(received.length, 8);
    assert.deepEqual(rejected, []);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
