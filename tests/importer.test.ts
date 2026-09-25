import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  symlink,
  rm,
  access,
  realpath,
} from "node:fs/promises";
import { execFile, spawnSync } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { tmpdir } from "node:os";
import {
  committedSource,
  discoverRepo,
  LEARNING_REVISION,
  readSource,
  sourceFiles,
} from "../server/importer.js";
import {
  learningSandboxAvailable,
  learningSandboxPolicy,
  runLearningStudio,
  validLearningResponseSchema,
} from "../server/learning-runner.js";
import type { RunEvent } from "../shared/types.js";

const sourceRepo =
  "/Users/macbook/Documents/Codex/2026-09-05/use/work/render-to-vercel/repos/agentic-learning-studio";

test("source discovery excludes secrets, dependencies and symlinks", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "citadel-discovery-test-"));
  try {
    await mkdir(path.join(root, "src"));
    await mkdir(path.join(root, "node_modules"));
    await writeFile(path.join(root, "package.json"), "{}");
    await writeFile(path.join(root, "src", "app.ts"), "export const value=1");
    await writeFile(path.join(root, ".env"), "SECRET=do-not-load");
    await writeFile(path.join(root, "MySecrets.md"), "do-not-load");
    await writeFile(
      path.join(root, "node_modules", "dependency.ts"),
      "do-not-load",
    );
    await symlink(path.join(root, ".env"), path.join(root, "src", "linked.ts"));
    assert.deepEqual(await sourceFiles(root), ["package.json", "src/app.ts"]);
    await assert.rejects(readSource(root, ".env"), /not allowed/);
    await assert.rejects(readSource(root, "src/linked.ts"), /symlinks/);
    const discovered = await discoverRepo(root);
    assert.equal(discovered.repo.adapter, "discovery-only");
    assert.equal(discovered.graph.nodes[0].role, "opaque");
    assert.ok(discovered.graph.nodes.slice(1).every((n) => n.hidden));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("remote URLs are not silently cloned or executed", async () => {
  await assert.rejects(
    discoverRepo("https://github.com/example/repo"),
    /local checkout/,
  );
});

test("sandbox policy denies network, writes and process creation", () => {
  const policy = learningSandboxPolicy(
    "/private/tmp/scratch",
    "/opt/node/bin/node",
  );
  assert.match(policy, /\(deny network\*\)/);
  assert.match(policy, /\(deny file-write\*\)/);
  assert.match(policy, /\(deny process-fork\)/);
  assert.doesNotMatch(policy, /allow file-read\*\)/);
});

test("macOS sandbox actually denies external reads, writes, network and child execution", async (t) => {
  if (!(await learningSandboxAvailable())) {
    t.skip("macOS sandbox-exec unavailable.");
    return;
  }
  const root = await realpath(
    await mkdtemp(path.join(tmpdir(), "citadel-boundary-test-")),
  );
  const outside = await realpath(
    await mkdtemp(path.join(tmpdir(), "citadel-outside-test-")),
  );
  try {
    await writeFile(
      path.join(outside, "private.txt"),
      "synthetic-private-data",
    );
    const node = await realpath(process.execPath);
    const script = `const fs=require('node:fs'),net=require('node:net'),cp=require('node:child_process');
      const result={envKeys:Object.keys(process.env)};
      try{fs.readFileSync(${JSON.stringify(path.join(outside, "private.txt"))});result.read='allowed'}catch(e){result.read=e.code}
      try{fs.writeFileSync(${JSON.stringify(path.join(root, "forbidden.txt"))},'x');result.write='allowed'}catch(e){result.write=e.code}
      const child=cp.spawnSync('/bin/echo',['should-not-execute']);result.spawn=child.error?.code||child.status;
      const socket=net.connect({host:'127.0.0.1',port:9});
      socket.on('connect',()=>{result.network='allowed';socket.destroy();process.stdout.write(JSON.stringify(result));});
      socket.on('error',e=>{result.network=e.code;process.stdout.write(JSON.stringify(result));});`;
    const result = spawnSync(
      "/usr/bin/sandbox-exec",
      ["-p", learningSandboxPolicy(root, node), node, "-e", script],
      { env: {}, cwd: root, encoding: "utf8", timeout: 3000 },
    );
    assert.equal(result.status, 0, result.stderr);
    const observed = JSON.parse(result.stdout);
    // CoreFoundation may inject this harmless encoding value after env:{} is applied.
    assert.deepEqual(
      observed.envKeys.filter(
        (key: string) => key !== "__CF_USER_TEXT_ENCODING",
      ),
      [],
    );
    assert.equal(observed.read, "EPERM");
    assert.equal(observed.write, "EPERM");
    assert.equal(observed.spawn, "EPERM");
    assert.equal(observed.network, "EPERM");
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test("learning adapter runs original overview, schemas and renderer with free model fixtures", async (t) => {
  try {
    await access(sourceRepo);
  } catch {
    t.skip("Inspected source checkout unavailable.");
    return;
  }
  if (!(await learningSandboxAvailable())) {
    t.skip("macOS sandbox-exec unavailable.");
    return;
  }
  const { repo, graph } = await discoverRepo(sourceRepo);
  assert.equal(repo.revision, LEARNING_REVISION);
  assert.equal(repo.adapter, "learning-studio");
  assert.ok(
    graph.nodes.some(
      (n) => n.id === "build" && n.description?.includes("Not executed"),
    ),
  );
  assert.ok(graph.edges.every((e) => e.provenance !== "observed"));
  const events: Omit<RunEvent, "id" | "time">[] = [];
  let modelCalls = 0;
  const output = await runLearningStudio({
    repo,
    input: "Teach agent memory.",
    config: { credentialId: "fixture", model: "fixture" },
    signal: new AbortController().signal,
    onEvent: (event) => events.push(event),
    generate: async (_system, input, options) => {
      modelCalls++;
      assert.equal(
        options?.json,
        true,
        "Original structured calls must request JSON mode",
      );
      assert.ok(validLearningResponseSchema(options?.responseSchema));
      const schema = options!.responseSchema as any;
      if (
        input.includes(
          "Return ONLY: title, framing, concepts, examples, outcomes",
        )
      ) {
        assert.equal(schema.properties.concepts.items.type, "object");
        assert.equal(
          schema.properties.concepts.items.properties.label.type,
          "string",
        );
        assert.deepEqual(schema.properties.concepts.items.required, ["label"]);
        assert.equal(schema.properties.examples.items.type, "string");
        assert.equal(schema.properties.outcomes.items.type, "string");
      }
      const value = input.includes("Return ONLY the planned sections.")
        ? {
            sections: [
              {
                title: "Working memory",
                summary: "Inspect a short conversation.",
              },
            ],
          }
        : input.includes(
              "Return ONLY: title, framing, concepts, examples, outcomes",
            )
          ? {
              title: "Agent memory",
              framing: "Choose memory for a small assistant.",
              concepts: [
                { label: "Working memory", why: "Keep current context." },
              ],
              examples: ["A support conversation"],
              outcomes: ["Choose a context policy"],
            }
          : {
              topic: "Agent memory",
              learningGoal: "Choose memory",
              lessonFocus: "understand_mechanism",
              mustCover: ["Working memory"],
              scope: "narrow",
            };
      return {
        text: JSON.stringify(value),
        usage: { inputTokens: 10, outputTokens: 20, estimatedCostUsd: 0 },
      };
    },
  });
  assert.equal(modelCalls, 3);
  const result = JSON.parse(output);
  assert.equal(result.blueprint.meta.title, "Agent memory");
  assert.equal(result.blueprint.learnerProfile.quick, true);
  assert.equal(result.blueprint.modules[0].loadState, "stub");
  assert.ok(result.htmlBytes > 1000);
  const render = events.find(
    (e) => e.nodeId === "render" && e.type === "node.completed",
  );
  assert.match(render?.output || "", /<!doctype html>/i);
  assert.ok(
    events.some(
      (e) =>
        e.nodeId === "retriever" && e.output?.includes("model's own knowledge"),
    ),
  );
  const total = events.reduce(
    (sum, event) => sum + (event.usage?.outputTokens || 0),
    0,
  );
  assert.equal(total, 60);
});

test("structured IPC validates the pinned schema vocabulary and bounds", () => {
  assert.equal(
    validLearningResponseSchema({
      type: "object",
      properties: { answer: { type: "string" } },
      required: ["answer"],
    }),
    true,
  );
  for (const value of [
    null,
    [],
    {},
    { type: "object", properties: {}, required: ["missing"] },
    { type: "object", properties: { unknown: {} }, required: [] },
    { type: "string", $ref: "https://external.invalid/schema" },
    { type: "array", items: { type: "unknown" } },
    { type: "string", enum: ["x".repeat(1001)] },
  ])
    assert.equal(validLearningResponseSchema(value), false);
  let nested: unknown = { type: "string" };
  for (let i = 0; i < 14; i++) nested = { type: "array", items: nested };
  assert.equal(validLearningResponseSchema(nested), false);
});

test("adapter refuses unreviewed revisions before requesting any model", async () => {
  let called = false;
  await assert.rejects(
    runLearningStudio({
      repo: {
        path: sourceRepo,
        name: "agentic-learning-studio",
        revision: "changed",
        adapter: "learning-studio",
        coverage: [],
        limitations: [],
        sources: [],
      },
      input: "test",
      config: { credentialId: "fixture", model: "fixture" },
      signal: new AbortController().signal,
      onEvent: () => {},
      generate: async () => {
        called = true;
        return { text: "{}", usage: { inputTokens: 0, outputTokens: 0 } };
      },
    }),
    /inspected/,
  );
  assert.equal(called, false);
});

test("original model schemas reject malformed output and mark overview failed", async (t) => {
  try {
    await access(sourceRepo);
  } catch {
    t.skip("Inspected source checkout unavailable.");
    return;
  }
  if (!(await learningSandboxAvailable())) {
    t.skip("macOS sandbox-exec unavailable.");
    return;
  }
  const { repo } = await discoverRepo(sourceRepo);
  const events: Omit<RunEvent, "id" | "time">[] = [];
  await assert.rejects(
    runLearningStudio({
      repo,
      input: "Teach memory.",
      config: { credentialId: "fixture", model: "fixture" },
      signal: new AbortController().signal,
      onEvent: (event) => events.push(event),
      generate: async () => ({
        text: "{}",
        usage: { inputTokens: 1, outputTokens: 1 },
      }),
    }),
  );
  assert.ok(
    events.some((e) => e.nodeId === "profiler" && e.type === "node.failed"),
  );
  assert.ok(
    events.some((e) => e.nodeId === "overview" && e.type === "node.failed"),
  );
  assert.ok(
    !events.some((e) => e.nodeId === "render" && e.type === "node.completed"),
  );
});

test("source pinning ignores git replacement objects and inherited GIT_DIR", async (t) => {
  try {
    await access(sourceRepo);
  } catch {
    t.skip("Inspected source checkout unavailable.");
    return;
  }
  const root = await realpath(
    await mkdtemp(path.join(tmpdir(), "citadel-pinning-test-")),
  );
  const copy = path.join(root, "checkout");
  const command = promisify(execFile);
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
  );
  const git = async (args: string[]) =>
    (await command("git", args, { env, timeout: 10_000 })).stdout.trim();
  try {
    await git([
      "clone",
      "--shared",
      "--no-checkout",
      "--quiet",
      sourceRepo,
      copy,
    ]);
    const file = "src/agent/nodes.ts";
    await mkdir(path.join(copy, "src/agent"), { recursive: true });
    await writeFile(path.join(copy, file), "export const malicious = true;\n");
    const originalBlob = await git([
      "-C",
      copy,
      "rev-parse",
      `${LEARNING_REVISION}:${file}`,
    ]);
    const replacedBlob = await git(["-C", copy, "hash-object", "-w", file]);
    await git(["-C", copy, "replace", originalBlob, replacedBlob]);
    assert.match(
      await git(["-C", copy, "show", `${LEARNING_REVISION}:${file}`]),
      /malicious/,
    );
    const repo = {
      path: copy,
      name: "agentic-learning-studio",
      revision: LEARNING_REVISION,
      adapter: "learning-studio" as const,
      coverage: [],
      limitations: [],
      sources: [],
    };
    const inherited = process.env.GIT_DIR;
    process.env.GIT_DIR = path.join(root, "does-not-exist");
    try {
      await assert.rejects(
        committedSource(repo, file),
        /Modified imported source/,
      );
    } finally {
      if (inherited === undefined) delete process.env.GIT_DIR;
      else process.env.GIT_DIR = inherited;
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("cancelling imported execution terminates the child without another model request", async (t) => {
  try {
    await access(sourceRepo);
  } catch {
    t.skip("Inspected source checkout unavailable.");
    return;
  }
  if (!(await learningSandboxAvailable())) {
    t.skip("macOS sandbox-exec unavailable.");
    return;
  }
  const { repo } = await discoverRepo(sourceRepo);
  const controller = new AbortController();
  let calls = 0;
  const started = Date.now();
  await assert.rejects(
    runLearningStudio({
      repo,
      input: "Teach memory.",
      config: { credentialId: "fixture", model: "fixture" },
      signal: controller.signal,
      onEvent: () => {},
      generate: async () => {
        calls++;
        setTimeout(() => controller.abort(), 10);
        return new Promise(() => {});
      },
    }),
    /cancelled/,
  );
  assert.equal(calls, 1);
  assert.ok(Date.now() - started < 5000);
});
