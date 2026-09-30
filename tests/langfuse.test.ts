import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { once } from "node:events";
import type { Project } from "../shared/types.js";

const scratch = mkdtempSync(path.join(tmpdir(), "workbench-langfuse-test-"));
process.env.WORKBENCH_DATA_DIR = scratch;
const { state } = await import("../server/store.js");
const {
  connectLangfuse,
  disconnectLangfuse,
  langfuseStatus,
  langfuseUrl,
  syncLangfuse,
} = await import("../server/langfuse.js");
const { redact } = await import("../server/providers.js");
after(() => rmSync(scratch, { recursive: true, force: true }));
const publicKey = "pk-lf-fixture-public-key-12345",
  secretKey = "sk-lf-fixture-secret-key-12345";
const authorization =
  "Basic " + Buffer.from(publicKey + ":" + secretKey).toString("base64");
const start = "2026-09-25T10:00:00.000Z",
  end = "2026-09-25T10:00:01.000Z";
let sequence = 0;
function project(): Project {
  const id = `langfuse-test-${++sequence}`;
  const p: Project = {
    id,
    name: "Fixture app",
    brief: "Synthetic fixture",
    createdAt: start,
    updatedAt: start,
    graph: {
      id: `graph-${id}`,
      revision: 1,
      name: "Fixture",
      description: "",
      nodes: [],
      edges: [],
      limits: {
        maxCalls: 4,
        maxRevisions: 1,
        timeoutMs: 10000,
        maxOutputTokens: 256,
      },
    },
  };
  state.projects.push(p);
  return p;
}
function row(id: string, traceId: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    traceId,
    traceName: "Observed app",
    name: id,
    type: "SPAN",
    startTime: start,
    endTime: end,
    input: "question",
    output: "answer",
    ...extra,
  };
}
function json(res: ServerResponse, body: unknown, status = 200) {
  res
    .writeHead(status, { "Content-Type": "application/json" })
    .end(JSON.stringify(body));
}
async function fixture(
  handler: (url: URL, req: IncomingMessage, res: ServerResponse) => void,
  work: (url: string) => Promise<void>,
) {
  const server = createServer((req, res) =>
    handler(new URL(req.url!, "http://127.0.0.1"), req, res),
  );
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  try {
    await work(`http://127.0.0.1:${address.port}`);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}
function projectResponse(res: ServerResponse) {
  json(res, { data: [{ id: "remote-project", name: "Local fixture" }] });
}

test("Langfuse only accepts official cloud or loopback base URLs", () => {
  for (const domain of [
    "cloud.langfuse.com",
    "us.cloud.langfuse.com",
    "jp.cloud.langfuse.com",
    "hipaa.cloud.langfuse.com",
  ])
    assert.equal(langfuseUrl(`https://${domain}/`), `https://${domain}`);
  assert.equal(langfuseUrl("http://127.0.0.1:4567"), "http://127.0.0.1:4567");
  for (const url of [
    "https://example.com",
    "http://cloud.langfuse.com",
    "https://cloud.langfuse.com.evil.example",
    "https://cloud.langfuse.com:444",
    "https://user:secret@cloud.langfuse.com",
    "https://cloud.langfuse.com/api",
    "https://cloud.langfuse.com?token=value",
    "file:///etc/passwd",
    "http://169.254.169.254",
  ])
    assert.throws(() => langfuseUrl(url));
});

test("Langfuse uses Basic auth and v2 fields, groups traces and syncs idempotently as partial evidence", async () => {
  const p = project(),
    calls: URL[] = [];
  await fixture(
    (url, req, res) => {
      assert.equal(req.headers.authorization, authorization);
      calls.push(url);
      if (url.pathname === "/api/public/projects") return projectResponse(res);
      assert.equal(url.pathname, "/api/public/v2/observations");
      const cursor = url.searchParams.get("cursor");
      json(
        res,
        cursor
          ? {
              data: [row("other", "trace-b", { output: "second answer" })],
              meta: {},
            }
          : {
              data: [
                row("root", "trace-a"),
                row("model", "trace-a", {
                  type: "GENERATION",
                  parentObservationId: "root",
                  model: "fixture-model",
                  inputUsage: 11,
                  outputUsage: 5,
                  totalCost: "0.002",
                  output: `secret=${secretKey}`,
                }),
              ],
              meta: { cursor: "next-page" },
            },
      );
    },
    async (url) => {
      const status = await connectLangfuse(p.id, { url, publicKey, secretKey });
      assert.equal(status.connected, true);
      assert.equal(status.projectName, "Local fixture");
      assert.ok(!JSON.stringify(status).includes(secretKey));
      const summary = await syncLangfuse(p.id, 24);
      assert.deepEqual(
        { runs: summary.runs, spans: summary.spans, limited: summary.limited },
        { runs: 2, spans: 3, limited: false },
      );
      const imported = state.runs.filter((r) => r.projectId === p.id);
      assert.equal(imported.length, 2);
      const a = imported.find((r) => r.external?.traceId === "trace-a")!;
      assert.equal(a.status, "completed");
      assert.equal(a.output, "answer");
      assert.equal(a.external?.partial, true);
      assert.equal(
        a.graph.nodes.find((n) => n.label === "model")?.role,
        "agent",
      );
      assert.equal(
        a.graph.edges.filter((e) => e.provenance === "observed").length,
        1,
      );
      assert.deepEqual(a.usage, {
        inputTokens: 11,
        outputTokens: 5,
        estimatedCostUsd: 0.002,
      });
      assert.ok(!JSON.stringify(a).includes(secretKey));
      const runIds = imported.map((r) => r.id).sort();
      const pagesBeforeRepeat = calls.filter((c) => c.pathname.includes("observations")).length;
      await syncLangfuse(p.id, 24);
      assert.equal(calls.filter((c) => c.pathname.includes("observations")).length - pagesBeforeRepeat, 2,
        "the same pagination cursor is fresh for each sync, not mixed with active project markers");
      assert.deepEqual(
        state.runs
          .filter((r) => r.projectId === p.id)
          .map((r) => r.id)
          .sort(),
        runIds,
      );
      const observationRequest = calls.find((c) =>
        c.pathname.includes("observations"),
      )!;
      assert.equal(observationRequest.searchParams.get("limit"), "100");
      assert.equal(
        observationRequest.searchParams.get("fields"),
        "core,basic,io,model,usage,trace_context",
      );
      assert.equal(
        Date.parse(observationRequest.searchParams.get("toStartTime")!) -
          Date.parse(observationRequest.searchParams.get("fromStartTime")!),
        86400000,
      );
      assert.ok(langfuseStatus(p.id).lastSyncAt);
      disconnectLangfuse(p.id);
      assert.equal(langfuseStatus(p.id).connected, false);
      assert.equal(redact(secretKey), "[REDACTED]");
      await assert.rejects(syncLangfuse(p.id), /Connect Langfuse/);
      assert.equal(state.runs.filter((r) => r.projectId === p.id).length, 2);
    },
  );
});

test("Langfuse refuses redirects without forwarding project keys", async () => {
  const p = project();
  let targetRequests = 0;
  await fixture(
    (_url, _req, res) => {
      targetRequests++;
      projectResponse(res);
    },
    async (target) => {
      await fixture(
        (_url, _req, res) => {
          res
            .writeHead(302, { Location: target + "/api/public/projects" })
            .end();
        },
        async (url) => {
          await assert.rejects(
            connectLangfuse(p.id, { url, publicKey, secretKey }),
            /HTTP 302/,
          );
          assert.equal(langfuseStatus(p.id).connected, false);
          assert.equal(targetRequests, 0);
        },
      );
    },
  );
});

test("Langfuse validation rejects authorization, malformed JSON and invalid project responses", async () => {
  for (const mode of ["unauthorized", "malformed", "no-project"]) {
    const p = project();
    await fixture(
      (_url, _req, res) => {
        if (mode === "unauthorized") json(res, { error: "rejected" }, 401);
        else if (mode === "malformed") res.writeHead(200).end("not json");
        else json(res, { data: [] });
      },
      async (url) => {
        await assert.rejects(
          connectLangfuse(p.id, { url, publicKey, secretKey }),
          mode === "unauthorized"
            ? /rejected these project keys/
            : mode === "malformed"
              ? /malformed JSON/
              : /did not return a project/,
        );
        assert.equal(langfuseStatus(p.id).connected, false);
      },
    );
  }
});

test("Langfuse sync caps pages and labels a bounded import as limited", async () => {
  const p = project();
  let pages = 0;
  await fixture(
    (url, _req, res) => {
      if (url.pathname === "/api/public/projects") return projectResponse(res);
      pages++;
      json(res, {
        data: [row(`span-${pages}`, "bounded-trace")],
        meta: { cursor: `page-${pages}` },
      });
    },
    async (url) => {
      await connectLangfuse(p.id, { url, publicKey, secretKey });
      const result = await syncLangfuse(p.id, 1);
      assert.equal(pages, 3);
      assert.equal(result.limited, true);
      assert.equal(result.spans, 3);
      assert.equal(
        state.runs.find((r) => r.projectId === p.id)?.external?.partial,
        true,
      );
      await assert.rejects(syncLangfuse(p.id, 169));
      assert.equal(pages, 3);
    },
  );
});

test("malformed rows and repeated cursors fail before persisting evidence", async () => {
  for (const mode of ["bad-row", "repeated-cursor"]) {
    const p = project();
    await fixture(
      (url, _req, res) => {
        if (url.pathname === "/api/public/projects")
          return projectResponse(res);
        json(
          res,
          mode === "bad-row"
            ? {
                data: [
                  row("valid", "valid-trace"),
                  { id: "invalid", traceId: "invalid-trace" },
                ],
              }
            : {
                data: [row("repeated", "cursor-trace")],
                meta: { cursor: "same-cursor" },
              },
        );
      },
      async (url) => {
        await connectLangfuse(p.id, { url, publicKey, secretKey });
        await assert.rejects(
          syncLangfuse(p.id),
          mode === "bad-row"
            ? /invalid observation/
            : /invalid pagination cursor/,
        );
        assert.equal(state.runs.filter((r) => r.projectId === p.id).length, 0);
        assert.equal(langfuseStatus(p.id).lastSyncAt, undefined);
      },
    );
  }
});

test("invalid values or parent cycles in a later trace do not partially persist an import", async () => {
  for (const invalidRows of [
    [row("invalid", "invalid-trace", { type: "GENERATION", inputUsage: -10 })],
    [
      row("cycle-a", "invalid-trace", { parentObservationId: "cycle-b" }),
      row("cycle-b", "invalid-trace", { parentObservationId: "cycle-a" }),
    ],
  ]) {
    const p = project();
    await fixture(
      (url, _req, res) => {
        if (url.pathname === "/api/public/projects")
          return projectResponse(res);
        json(res, { data: [row("valid", "valid-trace"), ...invalidRows] });
      },
      async (url) => {
        await connectLangfuse(p.id, { url, publicKey, secretKey });
        await assert.rejects(syncLangfuse(p.id));
        assert.equal(
          state.runs.filter((r) => r.projectId === p.id).length,
          0,
          "A rejected sync must not leave earlier trace groups persisted as if the import succeeded",
        );
        assert.equal(langfuseStatus(p.id).lastSyncAt, undefined);
      },
    );
  }
});
