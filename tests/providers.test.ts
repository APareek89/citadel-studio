import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import type { Provider, ModelConfig, Project } from "../shared/types.js";

const directory = await mkdtemp(path.join(tmpdir(), "citadel-provider-tests-"));
process.env.WORKBENCH_DATA_DIR = directory;
process.env.WORKBENCH_SECRETS_FILE = path.join(
  directory,
  "nonexistent-secrets",
);
const providers = await import("../server/providers.js");
const originalFetch = globalThis.fetch;
after(async () => {
  globalThis.fetch = originalFetch;
  await rm(directory, { recursive: true, force: true });
});

type RequestRecord = { url: string; init: RequestInit; body: any };
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
function models(provider: Provider, model: string) {
  return provider === "gemini"
    ? {
        models: [
          {
            name: `models/${model}`,
            displayName: model,
            supportedGenerationMethods: ["generateContent"],
          },
        ],
      }
    : provider === "openrouter"
      ? {
          data: [
            {
              id: model,
              architecture: { output_modalities: ["text"] },
              supported_parameters: ["response_format", "tools"],
            },
          ],
        }
      : { data: [{ id: model }] };
}
function completion(provider: Provider, text = "sample answer") {
  return provider === "gemini"
    ? {
        candidates: [
          {
            finishReason: "STOP",
            content: {
              parts: [
                { thought: true, text: "private internal text" },
                { text },
              ],
            },
          },
        ],
        usageMetadata: {
          promptTokenCount: 11,
          candidatesTokenCount: 7,
          thoughtsTokenCount: 2,
        },
      }
    : provider === "anthropic"
      ? {
          content: [
            { type: "thinking", thinking: "private internal text" },
            { type: "text", text },
          ],
          usage: { input_tokens: 11, output_tokens: 9 },
          stop_reason: "end_turn",
        }
      : {
          choices: [{ message: { content: text }, finish_reason: "stop" }],
          usage: { prompt_tokens: 11, completion_tokens: 9 },
        };
}
const modelIds: Record<Provider, string> = {
  gemini: "gemini-2.5-flash",
  openai: "gpt-4.1-test",
  anthropic: "claude-test",
  groq: "llama-3.3-test",
  openrouter: "test/text-model",
};
async function mock<T>(
  fetcher: typeof fetch,
  work: () => Promise<T>,
): Promise<T> {
  const previous = globalThis.fetch;
  globalThis.fetch = fetcher;
  try {
    return await work();
  } finally {
    globalThis.fetch = previous;
  }
}
async function credential(
  provider: Provider,
  model: string,
  key = `synthetic-${provider}-key-123456789`,
) {
  const meta = providers.addCredential(provider, `Test ${provider}`, key);
  await providers.discoverModels(meta.id);
  return { credentialId: meta.id, model };
}

for (const provider of Object.keys(modelIds) as Provider[])
  test(`${provider} discovery and inference use correct request/auth shapes without network`, async () => {
    const records: RequestRecord[] = [];
    const model = modelIds[provider];
    const key = `request-shape-${provider}-synthetic-key`;
    await mock(
      async (url, init = {}) => {
        const record = {
          url: String(url),
          init,
          body: init.body ? JSON.parse(String(init.body)) : undefined,
        };
        records.push(record);
        return json(
          init.method === "POST"
            ? completion(provider)
            : String(url).endsWith("/key")
              ? { data: { is_free_tier: true } }
              : models(provider, model),
        );
      },
      async () => {
        const config = await credential(provider, model, key);
        const initial = providers.cachedModels(config.credentialId)[0];
        assert.equal(initial.available, true);
        const result = await providers.generate(
          { ...config, temperature: 0.4 },
          "System instruction",
          "User input",
          { json: true, maxOutputTokens: 321 },
        );
        assert.equal(result.text, "sample answer");
        assert.deepEqual(
          {
            input: result.usage.inputTokens,
            output: result.usage.outputTokens,
          },
          { input: 11, output: 9 },
        );
        assert.equal(providers.modelFor(config).verified, true);
        const request = records.find((r) => r.init.method === "POST")!;
        const headers = new Headers(request.init.headers);
        assert.equal(headers.get("content-type"), "application/json");
        if (provider === "gemini") {
          assert.equal(headers.get("x-goog-api-key"), key);
          assert.equal(headers.get("authorization"), null);
          assert.match(
            request.url,
            /\/models\/gemini-2\.5-flash:generateContent$/,
          );
          assert.equal(
            request.body.systemInstruction.parts[0].text,
            "System instruction",
          );
          assert.equal(request.body.contents[0].parts[0].text, "User input");
          assert.equal(request.body.generationConfig.maxOutputTokens, 321);
          assert.equal(
            request.body.generationConfig.responseMimeType,
            "application/json",
          );
          assert.deepEqual(request.body.generationConfig.thinkingConfig, {
            thinkingBudget: 0,
          });
        } else if (provider === "anthropic") {
          assert.equal(headers.get("x-api-key"), key);
          assert.equal(headers.get("anthropic-version"), "2023-06-01");
          assert.match(request.url, /\/messages$/);
          assert.equal(request.body.max_tokens, 321);
          assert.equal(request.body.messages[0].content, "User input");
          assert.match(request.body.system, /valid JSON/);
        } else {
          assert.equal(headers.get("authorization"), `Bearer ${key}`);
          assert.match(request.url, /\/chat\/completions$/);
          assert.equal(request.body.model, model);
          assert.equal(request.body.messages[1].content, "User input");
          assert.deepEqual(request.body.response_format, {
            type: "json_object",
          });
          if (provider === "openai") {
            assert.equal(request.body.max_completion_tokens, 321);
            assert.equal(request.body.temperature, undefined);
          } else {
            assert.equal(request.body.max_tokens, 321);
            assert.equal(request.body.temperature, 0.4);
          }
          if (provider === "openrouter") {
            assert.deepEqual(request.body.provider, { allow_fallbacks: false });
            assert.ok(records.some((r) => r.url.endsWith("/key")));
          }
        }
        assert.ok(
          !request.url.includes(key),
          "Keys must never enter provider URLs.",
        );
        assert.ok(
          !JSON.stringify(providers.credentials()).includes(key),
          "Credential metadata must not expose the key.",
        );
      },
    );
  });

test("metadata discovery does not prove inference access; 404 disables only that credential/model", async () => {
  const model = "gpt-4.1-inference-denied";
  let post = 0;
  await mock(
    async (_url, init = {}) =>
      init.method === "POST"
        ? (post++, json({ error: { message: "Unknown model" } }, 404))
        : json(models("openai", model)),
    async () => {
      const config = await credential(
        "openai",
        model,
        "metadata-only-synthetic-key",
      );
      assert.equal(providers.modelFor(config).verified, false);
      await assert.rejects(
        providers.generate(config, "system", "input"),
        /unavailable.*404/,
      );
      assert.equal(post, 1);
      assert.equal(
        providers.cachedModels(config.credentialId)[0].available,
        false,
      );
      const refreshed = await providers.discoverModels(config.credentialId);
      assert.equal(refreshed[0].available, false);
      await assert.rejects(
        providers.generate(config, "system", "input"),
        /unavailable/,
      );
      assert.equal(post, 1);
    },
  );
});

test("429 is explicit, redacted, not retried, and does not permanently disable the model", async () => {
  const model = "gpt-4.1-rate-limit";
  const key = "rate-limit-synthetic-secret-123456";
  let posts = 0;
  await mock(
    async (_url, init = {}) =>
      init.method === "POST"
        ? (posts++, json({ error: { message: `Rejected token ${key}` } }, 429))
        : json(models("openai", model)),
    async () => {
      const config = await credential("openai", model, key);
      await assert.rejects(
        providers.generate(config, "system", "input"),
        (error) => {
          assert.match((error as Error).message, /Rate limit or quota/);
          assert.ok(!(error as Error).message.includes(key));
          return true;
        },
      );
      assert.equal(posts, 1);
      assert.equal(providers.modelFor(config).available, true);
    },
  );
});

test("request abort reaches fetch and an empty/safety-blocked output is not a success", async () => {
  const model = "gpt-4.1-abort";
  let infer = false;
  await mock(
    async (_url, init = {}) => {
      if (init.method !== "POST") return json(models("openai", model));
      if (!infer) return json({ choices: [] });
      return new Promise((_resolve, reject) => {
        const signal = init.signal!;
        if (signal.aborted) reject(signal.reason);
        else
          signal.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          });
      });
    },
    async () => {
      const config = await credential(
        "openai",
        model,
        "abort-synthetic-key-123456789",
      );
      await assert.rejects(
        providers.generate(config, "system", "input"),
        /no text/,
      );
      infer = true;
      const signal = AbortSignal.timeout(15);
      const start = Date.now();
      await assert.rejects(
        providers.generate(config, "system", "input", { signal }),
        (error) => (error as Error).name === "TimeoutError",
      );
      assert.ok(Date.now() - start < 500);
    },
  );
});

for (const provider of ["gemini", "anthropic", "openai"] as Provider[])
  test(`${provider} truncation fails before a partial answer is released`, async () => {
    const model =
      provider === "gemini"
        ? "gemini-2.5-flash-truncated"
        : provider === "anthropic"
          ? "claude-truncated"
          : "gpt-4.1-truncated";
    await mock(
      async (_url, init = {}) => {
        if (init.method !== "POST") return json(models(provider, model));
        const out: any = completion(provider, "incomplete text");
        if (provider === "gemini")
          out.candidates[0].finishReason = "MAX_TOKENS";
        else if (provider === "anthropic") out.stop_reason = "max_tokens";
        else out.choices[0].finish_reason = "length";
        return json(out);
      },
      async () => {
        const config = await credential(
          provider,
          model,
          `${provider}-truncated-synthetic-key`,
        );
        await assert.rejects(
          providers.generate(config, "system", "input"),
          /token limit/,
        );
        assert.equal(providers.modelFor(config).verified, false);
      },
    );
  });

test("five comparison slots preserve mixed successes and independent infrastructure errors", async () => {
  const { state } = await import("../server/store.js");
  const { defaultGraph } = await import("../server/graph.js");
  const { compare } = await import("../server/workflows.js");
  const { waitRun } = await import("../server/runs.js");
  const project: Project = {
    id: "mixed-five-project",
    name: "Mixed slots",
    brief: "test",
    graph: defaultGraph("Mixed slots"),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  state.projects.push(project);
  const definitions: [Provider, string, string][] = [
    ["gemini", "gemini-2.5-flash-mixed", "gemini-success"],
    ["openai", "gpt-4.1-mixed", "openai-success"],
    ["anthropic", "claude-mixed", "rate"],
    ["groq", "llama-3.3-mixed", "missing"],
  ];
  const byKey = new Map(
    definitions.map(([provider, model, outcome]) => [
      `mixed-${provider}-synthetic-key`,
      { provider, model, outcome },
    ]),
  );
  await mock(
    async (_url, init = {}) => {
      const h = new Headers(init.headers);
      const key =
        h.get("x-goog-api-key") ||
        h.get("x-api-key") ||
        h.get("authorization")?.replace(/^Bearer /, "") ||
        "";
      const slot = byKey.get(key)!;
      if (init.method !== "POST")
        return json(models(slot.provider, slot.model));
      if (slot.outcome === "rate")
        return json({ error: { message: "Synthetic quota" } }, 429);
      if (slot.outcome === "missing")
        return json({ error: { message: "Synthetic unavailable model" } }, 404);
      return json(completion(slot.provider, slot.outcome));
    },
    async () => {
      const slots = [];
      for (const [provider, model, outcome] of definitions)
        slots.push({
          label: outcome,
          config: await credential(
            provider,
            model,
            `mixed-${provider}-synthetic-key`,
          ),
        });
      slots.push({
        label: "invalid credential",
        config: { credentialId: "does-not-exist", model: "missing" },
      });
      const comparison = await compare({
        projectId: project.id,
        input: "Identical prompt",
        strategy: "workflow",
        slots,
      });
      await Promise.all(
        comparison.slots
          .filter((s) => s.runId)
          .map((s) => waitRun(state.runs.find((r) => r.id === s.runId)!)),
      );
      const runs = comparison.slots
        .filter((s) => s.runId)
        .map((s) => state.runs.find((r) => r.id === s.runId)!);
      assert.equal(comparison.slots.length, 5);
      assert.equal(runs.filter((r) => r.status === "completed").length, 2);
      assert.equal(runs.filter((r) => r.status === "failed").length, 2);
      assert.match(comparison.slots[4].error || "", /missing/);
      assert.ok(runs.every((r) => r.input === "Identical prompt"));
      assert.ok(runs.every((r) => r.graph.revision === project.graph.revision));
    },
  );
});

test("cancelling a real run aborts its mocked provider request and preserves earlier events", async () => {
  const { state } = await import("../server/store.js");
  const { defaultGraph } = await import("../server/graph.js");
  const { startRun, cancelRun, waitRun } = await import("../server/runs.js");
  const project: Project = {
    id: "cancel-provider-project",
    name: "Cancellation",
    brief: "test",
    graph: defaultGraph(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  state.projects.push(project);
  let started!: () => void;
  const callStarted = new Promise<void>((resolve) => {
    started = resolve;
  });
  let aborted = false;
  await mock(
    async (_url, init = {}) => {
      if (init.method !== "POST")
        return json(models("openai", "gpt-4.1-cancel-test"));
      started();
      return new Promise((_resolve, reject) =>
        init.signal!.addEventListener(
          "abort",
          () => {
            aborted = true;
            reject(init.signal!.reason);
          },
          { once: true },
        ),
      );
    },
    async () => {
      const config = await credential(
        "openai",
        "gpt-4.1-cancel-test",
        "run-cancel-synthetic-key",
      );
      const run = await startRun({
        projectId: project.id,
        input: "cancel me",
        config,
      });
      await callStarted;
      cancelRun(run.id);
      await waitRun(run);
      assert.equal(aborted, true);
      assert.equal(run.status, "cancelled");
      assert.ok(
        run.events.some(
          (e) => e.nodeId === "entry" && e.type === "node.completed",
        ),
      );
      assert.ok(
        !run.events.some(
          (e) => e.nodeId === "output" && e.type === "node.completed",
        ),
      );
    },
  );
});
