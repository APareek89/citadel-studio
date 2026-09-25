import test, { after } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { ModelConfig, Project, RedPlan } from "../shared/types.js";

const directory = await mkdtemp(path.join(tmpdir(), "workbench-redteam-test-"));
process.env.WORKBENCH_DATA_DIR = path.join(directory, "state");
process.env.WORKBENCH_SECRETS_FILE = path.join(directory, "absent-secrets");
process.env.WORKBENCH_SPEND_LIMIT_USD = "0";
const originalFetch = globalThis.fetch;
const { state } = await import("../server/store.js");
const { discoverRepo } = await import("../server/importer.js");
const { addCredential, discoverModels } =
  await import("../server/providers.js");
const { planRedTeam, runRedTeam } = await import("../server/workflows.js");
after(async () => {
  globalThis.fetch = originalFetch;
  await rm(directory, { recursive: true, force: true });
});

let sequence = 0;
const model = "gemini-3.5-flash-lite";
const brandRules = "Do not invent product facts or disclose private data.";
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function sourceProject() {
  const index = ++sequence;
  const folder = path.join(directory, `python-app-${index}`);
  const canary = path.join(directory, `must-not-execute-${index}`);
  await mkdir(folder);
  const source = [
    "from pathlib import Path",
    `Path(${JSON.stringify(canary)}).write_text('repository code executed')`,
    "",
    "def respond(user_input):",
    "    return eval(user_input)",
    "",
  ].join("\n");
  await writeFile(path.join(folder, "agent.py"), source);
  await writeFile(path.join(folder, ".env"), "SECRET_FIXTURE=must-not-be-read");
  const root = await realpath(folder);
  const discovered = await discoverRepo(root);
  assert.equal(discovered.repo.adapter, "discovery-only");
  assert.ok(discovered.repo.sources.some((file) => file.path === "agent.py"));
  const date = new Date().toISOString();
  const project: Project = {
    id: `redteam-project-${index}`,
    name: "Python source fixture",
    brief: "Respond to product questions",
    ...discovered,
    createdAt: date,
    updatedAt: date,
  };
  state.projects.push(project);
  return { project, root, source, canary };
}

function response(value: unknown) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
function reviewReply() {
  return JSON.stringify({
    summary: "One source concern requires validation in an isolated runtime.",
    findings: [
      {
        title: "Input passed to eval",
        severity: "high",
        category: "security",
        description:
          "The inspected function passes its user_input argument directly to eval. Reachability and runtime exploitation were not tested.",
        source: { path: "agent.py", line: 5 },
        quote: "return eval(user_input)",
        recommendation:
          "Replace eval with a bounded parser and validate allowed inputs.",
      },
    ],
  });
}

async function withModel<T>(
  text: string,
  work: (
    config: ModelConfig,
    requests: { url: string; body: any }[],
  ) => Promise<T>,
) {
  const previous = globalThis.fetch;
  const requests: { url: string; body: any }[] = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    assert.ok(
      url.startsWith("https://generativelanguage.googleapis.com/v1beta/"),
      `Unexpected mocked destination: ${url}`,
    );
    if (init.method !== "POST") {
      assert.ok(url.includes("/models"));
      return response({
        models: [
          {
            name: `models/${model}`,
            displayName: model,
            supportedGenerationMethods: ["generateContent"],
          },
        ],
      });
    }
    assert.ok(url.endsWith(`/${model}:generateContent`));
    requests.push({ url, body: JSON.parse(String(init.body)) });
    return response({
      candidates: [{ finishReason: "STOP", content: { parts: [{ text }] } }],
      usageMetadata: { promptTokenCount: 30, candidatesTokenCount: 20 },
    });
  };
  try {
    const credential = addCredential(
      "gemini",
      "Source review fixture",
      "synthetic-redteam-credential-123456",
    );
    await discoverModels(credential.id);
    return await work({ credentialId: credential.id, model }, requests);
  } finally {
    globalThis.fetch = previous;
  }
}

async function completed(plan: RedPlan) {
  const deadline = Date.now() + 5000;
  while (plan.status !== "completed" && Date.now() < deadline) await pause(10);
  assert.equal(
    plan.status,
    "completed",
    "Bounded source review must finish and retain a report.",
  );
  return plan;
}

test("discovery-only source planning is free, defaults honestly and never executes repository code", async () => {
  const { project, canary } = await sourceProject();
  const beforeRuns = structuredClone(state.runs);
  const previous = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    throw new Error("Planning must not call a provider");
  };
  try {
    const plan = await planRedTeam({
      projectId: project.id,
      scope: "local-test",
      brandRules,
    });
    assert.equal(plan.mode, "source-review");
    assert.equal(plan.status, "proposed");
    assert.equal(plan.target, "import");
    assert.deepEqual(plan.probes, []);
    assert.equal(plan.maxProbes, 0);
    assert.equal(plan.graphRevision, project.graph.revision);
    assert.ok(plan.targetFingerprint);
    assert.ok(plan.review?.files);
    assert.match(plan.review!.digest, /^[a-f0-9]{64}$/);
    assert.equal(calls, 0);
    assert.deepEqual(state.runs, beforeRuns);
    assert.equal(existsSync(canary), false);
    assert.ok(!JSON.stringify(plan).includes("must-not-be-read"));
  } finally {
    globalThis.fetch = previous;
  }
});

test("explicit behavioral mode on discovery-only source rejects before any model request or persisted plan", async () => {
  const { project } = await sourceProject();
  const before = state.redPlans.length;
  const previous = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    throw new Error("Unsupported behavior must not call a provider");
  };
  try {
    await assert.rejects(
      planRedTeam({
        projectId: project.id,
        mode: "behavioral",
        scope: "local-test",
        brandRules,
        maxProbes: 2,
      }),
      /adapter|behavioral|supported/i,
    );
    assert.equal(calls, 0);
    assert.equal(state.redPlans.length, before);
  } finally {
    globalThis.fetch = previous;
  }
});

test("source review makes one bounded model call and stores source-only findings without target runs", async () => {
  const { project, canary } = await sourceProject();
  const plan = await planRedTeam({
    projectId: project.id,
    mode: "source-review",
    scope: "local-test",
    brandRules,
  });
  const beforeRuns = structuredClone(state.runs);
  await withModel(reviewReply(), async (config, requests) => {
    await completed(await runRedTeam(plan.id, config));
    assert.equal(requests.length, 1);
    assert.ok(requests[0].body.generationConfig.maxOutputTokens > 0);
    assert.ok(requests[0].body.generationConfig.maxOutputTokens <= 5000);
    assert.ok(
      plan.findings.some(
        (finding) =>
          finding.source?.path === "agent.py" && finding.source.line === 5,
      ),
    );
    assert.ok(
      plan.findings.every(
        (finding) =>
          finding.evidenceType === "suspected" ||
          finding.evidenceType === "inconclusive",
      ),
    );
    assert.ok(plan.findings.every((finding) => !finding.runId));
    assert.deepEqual(state.runs, beforeRuns);
    assert.equal(existsSync(canary), false);
    assert.ok(!JSON.stringify(requests).includes("must-not-be-read"));
    await assert.rejects(
      async () => runRedTeam(plan.id, config),
      /already|started|new plan/i,
    );
    assert.equal(requests.length, 1);
  });
});

test("changing the approved graph rejects source review before spend or status transition", async () => {
  const { project } = await sourceProject();
  const plan = await planRedTeam({
    projectId: project.id,
    scope: "local-test",
    brandRules,
  });
  project.graph.revision++;
  await withModel(reviewReply(), async (config, requests) => {
    await assert.rejects(
      async () => runRedTeam(plan.id, config),
      /changed|stale|new plan|replan|re-plan/i,
    );
    assert.equal(plan.status, "proposed");
    assert.equal(requests.length, 0);
  });
});

test("a free source plan still requires a usable credential before review execution", async () => {
  const { project } = await sourceProject();
  const plan = await planRedTeam({
    projectId: project.id,
    scope: "local-test",
    brandRules,
  });
  const previous = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    throw new Error("An unavailable credential must block inference");
  };
  try {
    await assert.rejects(
      runRedTeam(plan.id, { credentialId: "not-connected", model }),
      /credential|model|key/i,
    );
    assert.equal(plan.status, "proposed");
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = previous;
  }
});

test("changing source bytes after approval rejects review before spend or status transition", async () => {
  const { project, root, source } = await sourceProject();
  const plan = await planRedTeam({
    projectId: project.id,
    scope: "local-test",
    brandRules,
  });
  await writeFile(
    path.join(root, "agent.py"),
    source + "# changed after plan approval\n",
  );
  await withModel(reviewReply(), async (config, requests) => {
    await assert.rejects(
      async () => runRedTeam(plan.id, config),
      /changed|stale|new plan|replan|re-plan/i,
    );
    assert.equal(plan.status, "proposed");
    assert.equal(requests.length, 0);
  });
});

test("concurrent source-review starts reserve one execution and reject the duplicate", async () => {
  const { project } = await sourceProject();
  const plan = await planRedTeam({
    projectId: project.id,
    scope: "local-test",
    brandRules,
  });
  await withModel(reviewReply(), async (config, requests) => {
    const outcomes = await Promise.allSettled([
      runRedTeam(plan.id, config),
      runRedTeam(plan.id, config),
    ]);
    assert.equal(
      outcomes.filter((outcome) => outcome.status === "fulfilled").length,
      1,
    );
    assert.equal(
      outcomes.filter((outcome) => outcome.status === "rejected").length,
      1,
    );
    await completed(plan);
    assert.equal(requests.length, 1);
  });
});

test("malformed source reviewer output remains inconclusive without a fabricated runtime trace", async () => {
  const { project } = await sourceProject();
  const plan = await planRedTeam({
    projectId: project.id,
    scope: "local-test",
    brandRules,
  });
  const beforeRuns = structuredClone(state.runs);
  await withModel("not valid JSON", async (config, requests) => {
    await completed(await runRedTeam(plan.id, config));
    assert.equal(requests.length, 1);
    assert.ok(plan.findings.length > 0);
    assert.ok(
      plan.findings.every((finding) => finding.evidenceType === "inconclusive"),
    );
    assert.deepEqual(state.runs, beforeRuns);
  });
});
