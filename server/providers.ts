import { estimate } from "./pricing.js";
import { redactIntegrationSecrets } from "./integration-secrets.js";
export { estimate } from "./pricing.js";
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import type {
  Provider,
  Credential,
  Model,
  ModelConfig,
  Usage,
} from "../shared/types.js";
import { id, now, assertWriteCapacity } from "./store.js";
import { authEnabled, dataRoot, tenantRoot, tenantMap, tenantSet, tenantValue, hasTenant } from "./tenant.js";
import { registerIntegrationSecret, registerServerSecret } from "./integration-secrets.js";
export const secretsPath =
  process.env.WORKBENCH_SECRETS_FILE ||
  path.join(homedir(), "Documents", "mysecrets");
const vault = tenantMap<
  string,
  { meta: Credential; key: string; models: Model[] }
>("credentials");
const verified = tenantSet<string>("verified-models");
const rejected = tenantMap<string, string>("rejected-models");
export const credentials = () => {
  ensureBuiltinCredentials();
  return [...vault.values()].map((c) => ({ ...c.meta }));
};
export function redact(value: string): string {
  let result = redactIntegrationSecrets(String(value));
  for (const { key } of hasTenant() ? vault.values() : [])
    if (key) result = result.split(key).join("[REDACTED]");
  return result
    .replace(
      /(?:AIza[\w-]{25,}|sk-(?:ant-)?[\w-]{18,}|AKIA[A-Z0-9]{16})/g,
      "[REDACTED]",
    )
    .replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]");
}
export function safeObject<T>(value: T): T {
  if (typeof value === "string") return redact(value) as T;
  if (Array.isArray(value)) return value.map((v) => safeObject(v)) as T;
  if (value && typeof value === "object") {
    const seen = new Set<string>();
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => {
          const base = redact(k);
          let key = base,
            suffix = 2;
          while (seen.has(key)) key = `${base} (${suffix++})`;
          seen.add(key);
          return [key, safeObject(v)];
        }),
    ) as T;
  }
  return value;
}
export function addCredential(
  provider: Provider,
  label: string,
  key: string,
  source: Credential["source"] = "session",
): Credential {
  if (
    !["gemini", "openai", "anthropic", "groq", "openrouter"].includes(provider)
  )
    throw new Error("Unsupported provider");
  if (key.trim().length < 12 || key.length > 512)
    throw new Error("Enter a complete API key");
  const existing = [...vault.values()].find(
    (v) => v.key === key.trim() && v.meta.provider === provider,
  );
  if (existing) return { ...existing.meta };
  const meta: Credential = {
    id: id("cred"),
    provider,
    label: label.trim() || provider,
    source,
    valid: false,
  };
  registerIntegrationSecret(key.trim());
  vault.set(meta.id, { meta, key: key.trim(), models: [] });
  return { ...meta };
}
export function importCredential(provider: Provider) {
  if (authEnabled()) throw new Error("Host secret file imports are disabled. Use a configured provider or your own session key.");
  if (!existsSync(secretsPath))
    throw new Error(
      "Local secrets file was not found. Add a session key instead.",
    );
  const text = readFileSync(secretsPath, "utf8");
  let key = "";
  const providerPatterns: Record<Provider, RegExp> = {
    gemini: /AIza[\w-]{30,}/,
    anthropic: /sk-ant-[\w-]{20,}/,
    openai: /sk-(?:proj-)?[\w-]{20,}/,
    groq: /gsk_[\w-]{20,}/,
    openrouter: /sk-or-[\w-]{20,}/,
  };
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (
      new RegExp(provider === "gemini" ? "gemini|google" : provider, "i").test(
        lines[i],
      )
    ) {
      const assignment = lines[i].match(/^[^=:]+[=:]\s*[\"']?([^\s\"']+)/);
      key =
        assignment?.[1] ||
        (lines
          .slice(i, i + 2)
          .join(" ")
          .match(providerPatterns[provider]) || [])[0] ||
        "";
      if (key) break;
    }
  }
  if (!key && provider === "gemini")
    key = (text.match(providerPatterns.gemini) || [])[0] || "";
  if (!key)
    throw new Error(
      `No ${provider} credential found in the configured local file`,
    );
  return addCredential(provider, `${provider} · local file`, key, "local-file");
}
export function getCredential(credentialId: string) {
  ensureBuiltinCredentials();
  const item = vault.get(credentialId);
  if (!item)
    throw new Error(
      "Credential is missing. Session keys must be re-added after server restart.",
    );
  return item;
}
const bases: Record<Provider, string> = {
  gemini: "https://generativelanguage.googleapis.com/v1beta",
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com/v1",
  groq: "https://api.groq.com/openai/v1",
  openrouter: "https://openrouter.ai/api/v1",
};
function headers(p: Provider, key: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    ...(p === "gemini"
      ? { "x-goog-api-key": key }
      : p === "anthropic"
        ? { "x-api-key": key, "anthropic-version": "2023-06-01" }
        : { Authorization: `Bearer ${key}` }),
  };
}
export class ProviderError extends Error {
  constructor(
    message: string,
    public status?: number,
  ) {
    super(message);
  }
}
async function api(
  provider: Provider,
  key: string,
  route: string,
  body?: unknown,
  signal?: AbortSignal,
) {
  const response = await fetch(bases[provider] + route, {
    method: body ? "POST" : "GET",
    headers: headers(provider, key),
    body: body ? JSON.stringify(body) : undefined,
    signal: signal || AbortSignal.timeout(15000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const reason =
      response.status === 401 || response.status === 403
        ? "Key rejected or account lacks access"
        : response.status === 429
          ? "Rate limit or quota reached"
          : response.status === 404
            ? "Model or endpoint is unavailable"
            : "Provider request failed";
    throw new ProviderError(
      `${provider}: ${reason} (HTTP ${response.status}). ${redact(data.error?.message || "").slice(0, 400)}`,
      response.status,
    );
  }
  return data;
}
export async function discoverModels(credentialId: string): Promise<Model[]> {
  const c = getCredential(credentialId);
  if (c.meta.source === "example" || c.meta.source === "configured") return c.models;
  try {
    const data = await api(
      c.meta.provider,
      c.key,
      "/models" + (c.meta.provider === "gemini" ? "?pageSize=1000" : ""),
    );
    let items: any[] = data.models || data.data || [];
    const provider = c.meta.provider;
    if (provider === "openrouter") await api(provider, c.key, "/key");
    const models: Model[] = items
      .map((m) => {
        const modelId = String(
          m.name && provider === "gemini"
            ? m.name.replace(/^models\//, "")
            : m.id,
        );
        const text =
          provider === "gemini"
            ? Boolean(
                m.supportedGenerationMethods?.includes("generateContent"),
              ) &&
              /^gemini-(?:(?:2\.5|3(?:\.\d+)?)-(?:flash|pro)|(?:flash|flash-lite|pro)-latest)/.test(
                modelId,
              ) &&
              !/image|tts|robot|live|audio|computer-use|transcribe|custom.?tools|omni/.test(
                modelId,
              )
            : provider === "anthropic"
              ? true
              : provider === "openai"
                ? /^(gpt-|o[134])/.test(modelId) &&
                  !/audio|image|realtime|transcri|search|codex|moderation/.test(
                    modelId,
                  )
                : provider === "openrouter"
                  ? !m.architecture?.output_modalities ||
                    m.architecture.output_modalities.includes("text")
                  : !/whisper|tts|guard/.test(modelId);
        const structured =
          provider === "gemini"
            ? /gemini-(?:2\.5|[3-9])/.test(modelId)
            : provider === "openai"
              ? /gpt-(?:4o|4\.1|[5-9])|^o[134]/.test(modelId)
              : provider === "anthropic"
                ? true
                : provider === "openrouter"
                  ? m.supported_parameters?.includes("response_format") || false
                  : /gpt-oss|llama-3\.3/.test(modelId);
        return {
          id: modelId,
          name: m.displayName || m.name || modelId,
          provider,
          text,
          structured,
          tools:
            provider === "openrouter"
              ? m.supported_parameters?.includes("tools") || false
              : text,
          context: m.inputTokenLimit || m.context_length,
          available: text && !rejected.has(`${credentialId}:${modelId}`),
          verified: verified.has(`${credentialId}:${modelId}`),
          reason:
            rejected.get(`${credentialId}:${modelId}`) ||
            (text ? undefined : "Not supported by this text workflow adapter"),
        };
      })
      .filter((m) => m.text)
      .sort((a, b) => a.id.localeCompare(b.id));
    c.models = models;
    c.meta.valid = true;
    c.meta.validatedAt = now();
    delete c.meta.error;
    return models;
  } catch (e) {
    c.meta.valid = false;
    c.meta.error = redact((e as Error).message);
    throw e;
  }
}
export function cachedModels(credentialId: string) {
  return getCredential(credentialId).models;
}
export function modelFor(config: ModelConfig) {
  const c = getCredential(config.credentialId);
  if (!c.meta.valid)
    throw new Error("Validate this credential before running.");
  const m = c.models.find((m) => m.id === config.model);
  if (!m || !m.available)
    throw new Error(
      "Selected model is unavailable or not compatible with text workflows. Refresh the model list.",
    );
  return m;
}
export interface GenerateResult {
  text: string;
  usage: Usage;
}
export interface GenerateOptions {
  signal?: AbortSignal;
  maxOutputTokens?: number;
  json?: boolean;
  responseSchema?: Record<string, unknown>;
}
const spendLimit = Number(process.env.WORKBENCH_SPEND_LIMIT_USD || 0);
interface Ledger { reservedUsd: number; completedUsd: number; calls: number }
const emptyLedger = (): Ledger => ({ reservedUsd: 0, completedUsd: 0, calls: 0 });
const ledgerFile = () => path.join(tenantRoot(), "usage.json");
const ledger = () => tenantValue<Ledger>("spend-ledger", () => existsSync(ledgerFile()) ? JSON.parse(readFileSync(ledgerFile(), "utf8")) : emptyLedger());
function ledgerSave() { writeFileSync(ledgerFile(), JSON.stringify(ledger()), { mode: 0o600 }); }
export function spendStatus() { return { ...ledger(), limitUsd: spendLimit || undefined }; }
const configuredModel = process.env.WORKBENCH_CONFIGURED_MODEL || "gemini-3.5-flash-lite";
const configuredKey = process.env.GEMINI_API_KEY;
if (configuredKey) registerServerSecret(configuredKey);
const sharedLimit = Number(process.env.WORKBENCH_SHARED_SPEND_LIMIT_USD || "0.25");
let sharedLedger: Ledger | undefined;
function sharedSpend(): Ledger {
  if (!sharedLedger) {
    const file = path.join(dataRoot, "configured-provider-usage.json");
    sharedLedger = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : emptyLedger();
  }
  return sharedLedger!;
}
function saveShared() { writeFileSync(path.join(dataRoot, "configured-provider-usage.json"), JSON.stringify(sharedSpend()), { mode: 0o600 }); }
function ensureBuiltinCredentials() {
  if (!authEnabled()) return;
  if (!vault.has("cached-example")) vault.set("cached-example", {
    meta: { id: "cached-example", label: "Cached workflow example · no API call", provider: "gemini", source: "example", valid: true }, key: "",
    models: [{ id: "cached-example", name: "Cached fixture (no model)", provider: "gemini", text: true, structured: false, tools: false, available: true, verified: false }],
  });
  if (configuredKey && !vault.has("configured-provider")) vault.set("configured-provider", {
    meta: { id: "configured-provider", label: "Portfolio provider · shared allowance", provider: "gemini", source: "configured", valid: true }, key: configuredKey,
    models: [{ id: configuredModel, name: configuredModel, provider: "gemini", text: true, structured: true, tools: true, available: true, verified: false, reason: "Configured provider; account inference has not been verified in this workspace." }],
  });
}
export async function generate(
  config: ModelConfig,
  system: string,
  input: string,
  opts: GenerateOptions = {},
): Promise<GenerateResult> {
  system = redact(system);
  input = redact(input);
  if (authEnabled() && process.env.WORKBENCH_PROVIDER_MODE !== "live") throw new Error("Live provider calls are disabled in this preview. Try the cached workflow example.");
  assertWriteCapacity(4 * 1024 * 1024);
  const c = getCredential(config.credentialId);
  const m = modelFor(config);
  if (c.meta.source === "example") throw new Error("Cached provider is restricted to the separate example workflow.");
  const spendLedger = ledger();
  const responseSchema = opts.responseSchema
    ? safeObject(opts.responseSchema)
    : undefined;
  if (responseSchema) {
    if (
      typeof responseSchema !== "object" ||
      Array.isArray(responseSchema) ||
      JSON.stringify(responseSchema).length > 20_000
    )
      throw new Error(
        "Structured response schema exceeds the provider contract.",
      );
    opts = { ...opts, json: true };
    if (c.meta.provider === "gemini" && !m.structured)
      throw new Error(
        "This model does not support native structured responses.",
      );
    // Other provider adapters retain a prompted schema + local validation. They
    // do not claim the native schema guarantee used by the Gemini adapter.
    if (c.meta.provider !== "gemini")
      system += `\nReturn exactly one JSON object matching this schema: ${JSON.stringify(responseSchema)}`;
  }
  if (system.length + input.length > 120000)
    throw new Error("Input exceeds the local 120,000-character safety limit.");
  const p = c.meta.provider;
  const max = opts.maxOutputTokens || 1536;
  let body: any;
  let route: string;
  if (p === "gemini") {
    route = `/models/${encodeURIComponent(config.model)}:generateContent`;
    body = {
      systemInstruction: { parts: [{ text: system || "Respond helpfully." }] },
      contents: [{ role: "user", parts: [{ text: input }] }],
      generationConfig: {
        maxOutputTokens: max,
        temperature: config.temperature ?? 0.2,
        ...(opts.json ? { responseMimeType: "application/json" } : {}),
        ...(responseSchema ? { responseJsonSchema: responseSchema } : {}),
        ...(/^gemini-2\.5-flash/.test(config.model)
          ? { thinkingConfig: { thinkingBudget: 0 } }
          : {}),
      },
    };
  } else if (p === "anthropic") {
    route = "/messages";
    body = {
      model: config.model,
      max_tokens: max,
      system: system + (opts.json ? "\nReturn only valid JSON." : ""),
      messages: [{ role: "user", content: input }],
      temperature: config.temperature ?? 0.2,
    };
  } else {
    route = "/chat/completions";
    body = {
      model: config.model,
      messages: [
        {
          role: "system",
          content: system + (opts.json ? "\nReturn only valid JSON." : ""),
        },
        { role: "user", content: input },
      ],
      ...(p === "openai"
        ? { max_completion_tokens: max }
        : { max_tokens: max, temperature: config.temperature ?? 0.2 }),
      ...(opts.json && m.structured
        ? { response_format: { type: "json_object" } }
        : {}),
      ...(p === "openrouter" ? { provider: { allow_fallbacks: false } } : {}),
    };
  }
  const reservation = estimate(
    p,
    config.model,
    Buffer.byteLength(system + input),
    max,
  );
  if (c.meta.source === "configured") {
    if (!(sharedLimit > 0) || reservation === undefined || sharedSpend().reservedUsd + reservation > sharedLimit)
      throw new Error("The shared portfolio allowance is exhausted. Use your own provider key.");
  }
  if (spendLimit) {
    if (reservation === undefined)
      throw new Error("Session dollar cap needs a model with known pricing.");
    if (spendLedger.reservedUsd + reservation > spendLimit)
      throw new Error("Session spend cap reached. No request was sent.");
  }
  if (c.meta.source === "configured") {
    sharedSpend().reservedUsd += reservation!; sharedSpend().calls++; saveShared();
  }
  spendLedger.reservedUsd += reservation || 0;
  spendLedger.calls++;
  ledgerSave();
  let data: any;
  try {
    data = await api(p, c.key, route, body, opts.signal);
  } catch (e) {
    if (e instanceof ProviderError && [403, 404].includes(e.status || 0)) {
      m.available = false;
      m.reason = redact(e.message);
      rejected.set(`${config.credentialId}:${config.model}`, m.reason);
    }
    throw e;
  }
  let text = "",
    inputTokens = 0,
    outputTokens = 0;
  if (p === "gemini") {
    const candidate = data.candidates?.[0];
    if (candidate?.finishReason === "MAX_TOKENS")
      throw new ProviderError(
        "Output exceeded the configured token limit. Increase it before retrying.",
      );
    text =
      candidate?.content?.parts
        ?.filter((v: any) => !v.thought)
        .map((v: any) => v.text || "")
        .join("") || "";
    inputTokens = data.usageMetadata?.promptTokenCount || 0;
    outputTokens =
      (data.usageMetadata?.candidatesTokenCount || 0) +
      (data.usageMetadata?.thoughtsTokenCount || 0);
  } else if (p === "anthropic") {
    if (data.stop_reason === "max_tokens")
      throw new ProviderError("Output exceeded the configured token limit.");
    text =
      data.content
        ?.filter((v: any) => v.type === "text")
        .map((v: any) => v.text)
        .join("") || "";
    inputTokens = data.usage?.input_tokens || 0;
    outputTokens = data.usage?.output_tokens || 0;
  } else {
    if (data.choices?.[0]?.finish_reason === "length")
      throw new ProviderError("Output exceeded the configured token limit.");
    text = data.choices?.[0]?.message?.content || "";
    inputTokens = data.usage?.prompt_tokens || 0;
    outputTokens = data.usage?.completion_tokens || 0;
  }
  if (!text)
    throw new ProviderError(
      "Provider returned no text (possibly blocked by its safety policy).",
    );
  const actual = estimate(p, config.model, inputTokens, outputTokens);
  if (actual !== undefined) {
    spendLedger.reservedUsd += actual - (reservation || 0);
    spendLedger.completedUsd += actual;
    ledgerSave();
  }
  if (c.meta.source === "configured" && actual !== undefined) {
    sharedSpend().reservedUsd += actual - (reservation || 0); sharedSpend().completedUsd += actual; saveShared();
  }
  verified.add(`${config.credentialId}:${config.model}`);
  m.verified = true;
  return {
    text: redact(text),
    usage: {
      inputTokens,
      outputTokens,
      estimatedCostUsd: estimate(p, config.model, inputTokens, outputTokens),
    },
  };
}
