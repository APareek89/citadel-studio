// Finite QA only: three reviewed original modules, one optional budgeted call.
// Run: node scripts/qa/demo-studio-run.mjs [--live]
import { createHash, randomUUID } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import {
  mkdtemp,
  readFile,
  writeFile,
  realpath,
  rm,
  mkdir,
  lstat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const repo = path.join(root, ".local/repos/4c6a1f3e143a8ecf74f8afa6");
const projectId = "project_8affabcd-15d";
const revision = "e80a18077036490e25608d90ff027f918379bcc1";
const live = process.argv.includes("--live");
if (process.argv.slice(2).some((x) => x !== "--live"))
  throw Error("Only --live is supported.");
const pins = {
  "server/runtime_acts.py":
    "5e888a6631aac014141990160119af3a6e40d74cd1433f77817e101f56152501",
  "server/runtime_coverage.py":
    "4ed36dd5acd785e11d3e856ff89a0642446abf36eab605d0a3d9197c7a492062",
  "server/agents/summary.py":
    "b515003242f170c5a2aa1a891b40bfa3169150bf6613fdf672b4a5b2683df852",
};
const cleanGit = Object.fromEntries(
  Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_")),
);
const command = promisify(execFile);
const head = (
  await command(
    "/usr/bin/git",
    ["--no-replace-objects", "-C", repo, "rev-parse", "HEAD"],
    { env: cleanGit },
  )
).stdout.trim();
if (head !== revision)
  throw Error("Reviewed revision changed; inspect before executing.");
const launcher = await realpath(
  "/Users/macbook/Documents/demo-studio/.venv/bin/python",
);
const pythonRoot = path.dirname(path.dirname(launcher));
const python = await realpath(
  path.join(pythonRoot, "Resources/Python.app/Contents/MacOS/Python"),
);
const libraries = await realpath(
  "/Users/macbook/Documents/demo-studio/.venv/lib/python3.11/site-packages",
);
const scratch = await realpath(
  await mkdtemp(path.join(tmpdir(), "workbench-demo-qa-")),
);
const outside = await realpath(
  await mkdtemp(path.join(tmpdir(), "workbench-demo-canary-")),
);
const canary = path.join(outside, "canary.txt");
const base = "http://127.0.0.1:3001/api";
const rootId = randomUUID(),
  traceId = randomUUID();
let receiver,
  nativeRun,
  brokerRun,
  brokerProject,
  modelCalls = 0,
  activeRunId;
const abort = new AbortController();
process.once("SIGINT", () => abort.abort());
process.once("SIGTERM", () => abort.abort());
async function api(route, body, method = body === undefined ? "GET" : "POST") {
  const response = await fetch(base + route, {
    method,
    signal: AbortSignal.any([abort.signal, AbortSignal.timeout(15000)]),
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const value = await response.json();
  if (!response.ok) throw Error(value.error || `HTTP ${response.status}`);
  return value;
}
async function trace(spans, status, output) {
  const response = await fetch(receiver.endpoint, {
    method: "POST",
    signal: AbortSignal.timeout(5000),
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + receiver.token,
    },
    body: JSON.stringify({
      traceId,
      name:
        "Demo Studio · original source QA" +
        (live ? " + live summary" : " · guardrails only"),
      input: {
        scope:
          "Reviewed subsystem QA; synthetic conversation, not a full demo build",
        revision,
      },
      spans,
      status,
      output,
    }),
  });
  const value = await response.json();
  if (!response.ok) throw Error(value.error || "Native trace rejected");
  nativeRun = value;
}
function worker(request, onMessage = async () => {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "/usr/bin/sandbox-exec",
      [
        "-f",
        path.join(scratch, "sandbox.sb"),
        python,
        "-I",
        "-S",
        "-B",
        path.join(scratch, "worker.py"),
      ],
      { cwd: scratch, env: {}, stdio: ["pipe", "pipe", "pipe"] },
    );
    let buffer = "",
      stderr = "",
      bytes = 0,
      result,
      done = false,
      chain = Promise.resolve();
    const stop = (error) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      abort.signal.removeEventListener("abort", cancel);
      child.kill("SIGKILL");
      reject(error);
    };
    const cancel = () => stop(Error("QA cancelled"));
    abort.signal.addEventListener("abort", cancel, { once: true });
    const timer = setTimeout(
      () => stop(Error("QA worker exceeded deadline")),
      live ? 100000 : 15000,
    );
    child.stdin.write(JSON.stringify(request) + "\n");
    child.stdout.on("data", (chunk) => {
      bytes += chunk.length;
      if (bytes > 150000) return stop(Error("Worker output cap exceeded"));
      buffer += chunk.toString();
      let at;
      while ((at = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, at);
        buffer = buffer.slice(at + 1);
        chain = chain
          .then(async () => {
            const message = JSON.parse(line);
            if (message.type === "result") result = message;
            if (message.type === "model") {
              const reply = await onMessage(message);
              child.stdin.write(JSON.stringify(reply) + "\n");
            } else await onMessage(message);
          })
          .catch(stop);
      }
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
      if (stderr.length > 8000) stop(Error("Worker stderr cap exceeded"));
    });
    child.on("error", stop);
    child.on("exit", (code) =>
      chain.then(() => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        abort.signal.removeEventListener("abort", cancel);
        if (code !== 0 || !result)
          reject(Error("Sandbox worker failed: " + stderr.slice(-2500)));
        else resolve(result);
      }),
    );
  });
}
let rootSpan;
try {
  await writeFile(canary, "non-secret sandbox canary", { mode: 0o600 });
  for (const [relative, hash] of Object.entries(pins)) {
    const location = path.join(repo, relative);
    if (
      (await lstat(location)).isSymbolicLink() ||
      !(await realpath(location)).startsWith((await realpath(repo)) + path.sep)
    )
      throw Error("Source path escaped reviewed repository");
    const bytes = await readFile(location);
    if (createHash("sha256").update(bytes).digest("hex") !== hash)
      throw Error("Reviewed module changed: " + relative);
    const committed = (
      await command(
        "/usr/bin/git",
        ["--no-replace-objects", "-C", repo, "show", revision + ":" + relative],
        { env: cleanGit, maxBuffer: 200000 },
      )
    ).stdout;
    if (createHash("sha256").update(committed).digest("hex") !== hash)
      throw Error("Commit source pin mismatch");
    await writeFile(path.join(scratch, path.basename(relative)), bytes, {
      mode: 0o600,
    });
  }
  await writeFile(
    path.join(scratch, "worker.py"),
    await readFile(path.join(root, "scripts/qa/demo-studio-worker.py")),
    { mode: 0o600 },
  );
  const q = JSON.stringify;
  const policy = `(version 1)\n(deny default)\n(allow process-exec (literal ${q(python)}))\n(allow sysctl-read)\n(allow mach-lookup)\n(allow file-read-metadata)\n(allow file-read* (literal "/") (subpath "/System") (subpath "/usr/lib") (subpath "/Library/Apple/System/Library") (subpath "/Library/Apple/usr") (subpath "/usr/libexec/rosetta") (subpath "/private/var/db/dyld") (subpath ${q(pythonRoot)}) (subpath ${q(libraries)}) (subpath ${q(scratch)}) (literal "/dev/null") (literal "/dev/urandom") (literal "/dev/random"))\n(deny network*)\n(deny file-write*)\n(deny process-fork)\n`;
  await writeFile(path.join(scratch, "sandbox.sb"), policy, { mode: 0o600 });
  const checks = (
    await worker({
      mode: "selftest",
      canary,
      libraries: live ? libraries : undefined,
    })
  ).checks;
  if (!Object.values(checks).every(Boolean))
    throw Error("Sandbox enforcement check failed");
  console.log(
    "Sandbox checks passed: empty secret environment, outside-read/write/network/fork denial.",
  );
  const boot = await api("/bootstrap");
  const project = boot.projects.find((p) => p.id === projectId);
  if (
    !project?.repo ||
    (await realpath(project.repo.path)) !== (await realpath(repo))
  )
    throw Error("Project no longer references inspected source");
  let config;
  if (live) {
    const credential = boot.credentials.find(
      (c) => c.provider === "gemini" && c.validatedAt,
    );
    if (!credential)
      throw Error(
        "Validated Gemini session credential is required; no secret-file reads in this harness.",
      );
    const models = await api("/credentials/" + credential.id + "/models");
    const model = models.find(
      (m) => m.id === "gemini-3.5-flash-lite" && m.available,
    );
    if (!model) throw Error("Expected small Gemini text model unavailable");
    config = { credentialId: credential.id, model: model.id, temperature: 0.1 };
  }
  receiver = await api("/projects/" + projectId + "/telemetry/token", {});
  rootSpan = {
    id: rootId,
    name: "Inspected Demo Studio QA harness",
    role: "orchestrator",
    status: "running",
    startTime: new Date().toISOString(),
    input: {
      synthetic: true,
      scope:
        "Original guardrails and optional original summary; no build/media/storage writes",
    },
  };
  await trace([rootSpan], "running");
  const result = await worker(
    { mode: "run", live, rootId, libraries },
    async (message) => {
      if (message.type === "span") return trace([message.span]);
      if (message.type !== "model") return;
      if (
        ++modelCalls !== 1 ||
        message.maxOutputTokens !== 1200 ||
        message.system.length + message.input.length > 15000
      )
        throw Error("Original request exceeded reviewed one-call scope");
      brokerProject = await api("/projects", {
        name: "Demo Studio summary · QA broker",
        brief:
          "Original source prompt/schema broker for one isolated session-summary QA run. Not an imported-app execution adapter.",
      });
      const graph = {
        id: brokerProject.graph.id,
        revision: 1,
        name: "Original summary request broker",
        description:
          "One mediated call from reviewed Demo Studio summary.py; original Pydantic validation occurs in the sandbox.",
        nodes: [
          { id: "entry", label: "Original request", role: "orchestrator" },
          {
            id: "summary",
            label: "Original summary prompt",
            role: "agent",
            prompt: message.system,
            schema: message.schema,
            source: {
              path: "server/agents/summary.py",
              line: 47,
              symbol: "summarize",
            },
          },
          { id: "output", label: "Return structured result", role: "output" },
        ],
        edges: [
          {
            id: "a",
            source: "entry",
            target: "summary",
            label: "Original payload",
            kind: "data",
          },
          {
            id: "b",
            source: "summary",
            target: "output",
            label: "JSON response",
            kind: "data",
          },
        ],
        limits: {
          maxCalls: 1,
          maxRevisions: 0,
          timeoutMs: 80000,
          maxOutputTokens: 1200,
          maxCostUsd: 0.02,
        },
      };
      await api("/projects/" + brokerProject.id, { graph }, "PUT");
      console.log(
        "Calling one small-model summary via existing budgeted provider broker (1200 output tokens; $0.02 per-run cap).",
      );
      const started = await api("/runs", {
        projectId: brokerProject.id,
        config,
        input: message.input,
      });
      activeRunId = started.id;
      for (let i = 0; i < 90; i++) {
        brokerRun = await api("/runs/" + activeRunId);
        if (!["running", "queued"].includes(brokerRun.status)) break;
        await new Promise((resolve) => setTimeout(resolve, 750));
      }
      if (brokerRun.status !== "completed")
        throw Error(
          "Single summary call did not complete: " +
            (brokerRun.error || brokerRun.status),
        );
      activeRunId = undefined;
      return { text: brokerRun.output };
    },
  );
  const output = {
    ...result.output,
    scope:
      "Subsystem QA only: synthetic transcript; original summary and guardrails, not full Demo Studio build or production run",
    revision,
    sourceHashes: pins,
    sandboxChecks: checks,
    provider: live
      ? {
          model: config.model,
          usage: brokerRun?.usage,
          brokerRunId: brokerRun?.id,
        }
      : undefined,
    substitutions: [
      "In-memory read-only product/deck fixture store",
      "config.MOCK_LLM=false for live summary",
      "runtime.structured: one budgeted workbench model request, no provider fallback; original requested low-thinking option is not forwarded by the broker",
      "Unused mock module fails closed",
    ],
    writesToSourceApp: false,
  };
  await trace(
    [
      {
        ...rootSpan,
        status: "completed",
        endTime: new Date().toISOString(),
        output,
      },
    ],
    "completed",
    output,
  );
  await mkdir(path.join(root, "output/qa"), { recursive: true });
  const receipt = {
    time: new Date().toISOString(),
    projectId,
    traceId,
    nativeRunId: nativeRun.runId,
    brokerProjectId: brokerProject?.id,
    ...output,
  };
  await writeFile(
    path.join(root, "output/qa/demo-studio-original-run.json"),
    JSON.stringify(receipt, null, 2),
    { mode: 0o600 },
  );
  console.log(
    JSON.stringify(
      {
        status: "completed",
        projectId,
        traceId,
        nativeRunId: nativeRun.runId,
        modelCalls,
        summary: result.output.summary,
        usage: brokerRun?.usage,
        receipt: "output/qa/demo-studio-original-run.json",
      },
      null,
      2,
    ),
  );
} catch (error) {
  if (receiver && rootSpan)
    try {
      await trace(
        [
          {
            ...rootSpan,
            status: "failed",
            endTime: new Date().toISOString(),
            error: String(error.message).slice(0, 1000),
          },
        ],
        "failed",
      );
    } catch {}
  throw error;
} finally {
  if (activeRunId)
    try {
      await fetch(base + "/runs/" + activeRunId + "/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
        signal: AbortSignal.timeout(5000),
      });
    } catch {}
  abort.abort();
  await rm(scratch, { recursive: true, force: true });
  await rm(outside, { recursive: true, force: true });
}
