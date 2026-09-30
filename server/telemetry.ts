import { authEnabled, requireTenant, tenantKey } from "./tenant.js";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type {
  Graph,
  GraphNode,
  ObservedSpan,
  Run,
  RunEvent,
} from "../shared/types.js";
import { state, projectById, id, now, save, journal, assertWriteCapacity } from "./store.js";
import { safeObject, redact } from "./providers.js";
import { registerIntegrationSecret } from "./integration-secrets.js";
import { bus } from "./runs.js";
import { hosting } from "./hosting.js";

const identifier = z
  .string()
  .min(1)
  .max(160)
  .regex(/^[\w.:-]+$/);
const spanSchema = z
  .object({
    id: identifier,
    name: z.string().min(1).max(200),
    parentId: identifier.optional(),
    nodeId: identifier.optional(),
    role: z
      .enum([
        "orchestrator",
        "agent",
        "tool",
        "validator",
        "guardrail",
        "output",
        "resource",
        "opaque",
      ])
      .optional(),
    status: z.enum(["running", "completed", "failed"]),
    startTime: z.string().datetime({ offset: true }),
    endTime: z.string().datetime({ offset: true }).optional(),
    input: z.unknown().optional(),
    output: z.unknown().optional(),
    error: z.string().max(20000).optional(),
    model: z.string().max(200).optional(),
    usage: z
      .object({
        inputTokens: z.number().nonnegative().max(1e9),
        outputTokens: z.number().nonnegative().max(1e9),
        estimatedCostUsd: z.number().nonnegative().max(1e6).optional(),
      })
      .optional(),
    source: z
      .object({
        path: z.string().max(600),
        line: z.number().int().positive().optional(),
        symbol: z.string().max(200).optional(),
      })
      .optional(),
  })
  .superRefine((s, c) => {
    if (s.parentId === s.id)
      c.addIssue({ code: "custom", message: "A span cannot parent itself" });
    if (s.endTime && Date.parse(s.endTime) < Date.parse(s.startTime))
      c.addIssue({ code: "custom", message: "Span end precedes its start" });
    for (const value of [s.input, s.output])
      if (value !== undefined && JSON.stringify(value).length > 24000)
        c.addIssue({
          code: "custom",
          message: "Span input/output must be under 24,000 characters",
        });
  });
export const traceSchema = z.object({
  traceId: identifier,
  name: z.string().max(200).optional(),
  input: z.unknown().optional(),
  output: z.unknown().optional(),
  status: z.enum(["running", "completed", "failed"]).optional(),
  spans: z.array(spanSchema).min(1).max(1000),
});
const tokens = new Map<string, { ownerId: string; projectId: string; digest: Buffer; lastReceivedAt?: string }>();
const digest = (token: string) => createHash("sha256").update(token).digest();
export const receiverEndpoint = (
  projectId: string,
  port = Number(process.env.PORT || 3001),
) =>
  `${hosting.publicOrigin || `http://127.0.0.1:${port}`}/api/telemetry/${encodeURIComponent(projectId)}/spans`;
export function receiverStatus(projectId: string) {
  projectById(projectId);
  return {
    enabled: tokens.has(tenantKey(projectId)),
    endpoint: receiverEndpoint(projectId),
    lastReceivedAt: tokens.get(tenantKey(projectId))?.lastReceivedAt,
  };
}
export function createReceiver(projectId: string) {
  projectById(projectId);
  const token = "wb_" + randomBytes(32).toString("base64url");
  registerIntegrationSecret(token);
  tokens.set(tenantKey(projectId), { ownerId: requireTenant().id, projectId, digest: digest(token) });
  const endpoint = receiverEndpoint(projectId);
  return {
    token,
    endpoint,
    snippet: `# Server-side environment; never put these in client code\nWORKBENCH_URL=${endpoint}\nWORKBENCH_TOKEN=${token}\n\n# Download the JS or Python helper below, then wrap real app operations.\n# The local workbench must be running. Restarting it requires a new token.`,
  };
}
export function disconnectReceiver(projectId: string) {
  projectById(projectId);
  tokens.delete(tenantKey(projectId));
}
export function authorizeReceiver(projectId: string, authorization?: string) {
  const active = tokens.get(tenantKey(projectId));
  const token = authorization?.startsWith("Bearer ")
    ? authorization.slice(7)
    : "";
  if (
    !active ||
    !token ||
    token.length > 512 ||
    !timingSafeEqual(active.digest, digest(token))
  )
    throw new Error(
      "Telemetry token is missing, expired or belongs to another project.",
    );
}

/** Native ingestion resolves its actor from the unguessable receiver capability, never a caller owner ID. */
export function receiverOwner(projectId: string, authorization?: string): string {
  const token = authorization?.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!token || token.length > 512) throw new Error("Receiver unauthorized");
  const value = digest(token);
  for (const receiver of tokens.values()) {
    if (receiver.projectId === projectId && timingSafeEqual(receiver.digest, value)) return receiver.ownerId;
  }
  throw new Error("Receiver unauthorized");
}
const text = (value: unknown) =>
  value === undefined
    ? undefined
    : redact(typeof value === "string" ? value : JSON.stringify(value)).slice(
        0,
        24000,
      );
function validateParents(spans: ObservedSpan[]) {
  const byId = new Map(spans.map((s) => [s.id, s]));
  for (const s of spans) {
    const visited = new Set<string>();
    let next: ObservedSpan | undefined = s;
    while (next) {
      if (visited.has(next.id))
        throw new Error("Telemetry parent relationships contain a cycle.");
      visited.add(next.id);
      next = next.parentId ? byId.get(next.parentId) : undefined;
    }
  }
}
export function recordTrace(
  projectId: string,
  raw: unknown,
  origin: {
    kind: "workbench" | "langfuse";
    namespace: string;
    partial?: boolean;
  } = { kind: "workbench", namespace: "native" },
  commit = true,
): Run {
  const p = projectById(projectId);
  const parsed = traceSchema.parse(raw);
  if (origin.kind === "workbench" && parsed.spans.length > 200)
    throw new Error("A native batch is limited to 200 spans.");
  if (JSON.stringify(parsed).length > 1_000_000)
    throw new Error("Trace batch exceeds 1 MB.");
  if (new Set(parsed.spans.map((s) => s.id)).size !== parsed.spans.length)
    throw new Error("Duplicate span IDs in one batch.");
  const data = safeObject(parsed);
  let run = state.runs.find(
    (r) =>
      r.projectId === projectId &&
      r.external?.kind === origin.kind &&
      r.external.namespace === origin.namespace &&
      r.external.traceId === data.traceId,
  );
  const merged = new Map<string, ObservedSpan>(
    (run?.external?.spans || []).map((s) => [s.id, s]),
  );
  for (const span of data.spans)
    merged.set(span.id, { ...merged.get(span.id), ...span });
  const spans = [...merged.values()].sort(
    (a, b) =>
      Date.parse(a.startTime) - Date.parse(b.startTime) ||
      a.id.localeCompare(b.id),
  );
  if (spans.length > 1000 || JSON.stringify(spans).length > 3_000_000)
    throw new Error("One observed trace is limited to 1,000 spans / 3 MB.");
  validateParents(spans);
  if (
    origin.kind === "workbench" &&
    run &&
    ["completed", "failed"].includes(run.status)
  ) {
    if (
      JSON.stringify(spans) !== JSON.stringify(run.external!.spans) ||
      (data.status && data.status !== run.status) ||
      (data.output !== undefined && text(data.output) !== run.output)
    )
      throw new Error(
        "A finished observed trace is immutable. Use a new trace ID for another run.",
      );
    return run;
  }
  const anyRunning = spans.some((s) => s.status === "running");
  if (data.status === "completed" && anyRunning)
    throw new Error("Complete every span before completing the trace.");
  const inferredStatus = anyRunning
    ? "running"
    : spans.some((s) => s.status === "failed")
      ? "failed"
      : "completed";
  // A completed child batch is not a trace completion signal. More spans may arrive.
  const status =
    data.status || (origin.kind === "workbench" ? "running" : inferredStatus);
  const graph: Graph = run
    ? structuredClone(run.graph)
    : structuredClone(p.graph);
  // A trace-only project has no source map. Its observed structure comes exclusively from spans.
  if (!run && !p.repo) {
    graph.nodes = [];
    graph.edges = [];
    graph.name = data.name || p.name;
    graph.description =
      "Observed external span hierarchy. No imported source or execution adapter is implied.";
  }
  const spanNodes = new Map<string, string>();
  for (const span of spans) {
    let node = span.nodeId
      ? graph.nodes.find((n) => n.id === span.nodeId)
      : undefined;
    if (!node && span.source)
      node = graph.nodes.find((n) =>
        [n.source, ...(n.sourceRefs || [])].some(
          (ref) =>
            ref?.path === span.source?.path &&
            ref?.symbol === span.source?.symbol &&
            !!span.source?.symbol,
        ),
      );
    if (!node) {
      const nodeId =
        "observed_" +
        createHash("sha256").update(span.id).digest("hex").slice(0, 16);
      node = graph.nodes.find((n) => n.id === nodeId);
      if (!node) {
        node = {
          id: nodeId,
          label: span.name,
          role: span.role || (span.model ? "agent" : "tool"),
          source: span.source,
          hidden: span.role === "resource",
          description:
            "Observed span from the connected application. Parent-child relationships describe tracing context, not proof of data dependencies.",
        };
        graph.nodes.push(node);
      }
    }
    spanNodes.set(span.id, node.id);
  }
  for (const span of spans) {
    const source = span.parentId ? spanNodes.get(span.parentId) : undefined,
      target = spanNodes.get(span.id)!;
    if (
      source &&
      source !== target &&
      !graph.edges.some(
        (e) =>
          e.source === source &&
          e.target === target &&
          e.provenance === "observed",
      )
    )
      graph.edges.push({
        id: `observed:${source}:${target}`,
        source,
        target,
        kind: "data",
        label: "Observed child span",
        provenance: "observed",
      });
  }
  const started = spans[0].startTime;
  const invocation = new Map<string, number>();
  const events: RunEvent[] = [
    {
      id: "trace:start",
      type: "run.started",
      time: started,
      input: text(data.input ?? run?.input),
      message: `Observed externally via ${origin.kind}; the workbench did not execute this app.`,
    },
  ];
  for (const span of spans) {
    const nodeId = spanNodes.get(span.id)!;
    const visit = (invocation.get(nodeId) || 0) + 1;
    invocation.set(nodeId, visit);
    events.push({
      id: `${span.id}:start`,
      time: span.startTime,
      type: "node.started",
      nodeId,
      invocation: visit,
      input: text(span.input),
    });
    if (span.status !== "running")
      events.push({
        id: `${span.id}:end`,
        time: span.endTime || span.startTime,
        type: span.status === "failed" ? "node.failed" : "node.completed",
        nodeId,
        invocation: visit,
        input: text(span.input),
        output: text(span.output),
        message: span.error,
        usage: span.usage,
        latencyMs: span.endTime
          ? Math.max(0, Date.parse(span.endTime) - Date.parse(span.startTime))
          : undefined,
      });
  }
  events.sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
  const finished =
    status === "running"
      ? undefined
      : spans.reduce(
          (latest, s) =>
            Date.parse(s.endTime || s.startTime) > Date.parse(latest)
              ? s.endTime || s.startTime
              : latest,
          started,
        );
  const roots = spans.filter((s) => !s.parentId);
  const output = text(
    data.output ??
      (roots.length === 1 ? roots[0].output : undefined) ??
      run?.output,
  );
  if (finished)
    events.push({
      id: "trace:end",
      time: finished,
      type: status === "failed" ? "run.failed" : "run.completed",
      output: status === "completed" ? output : undefined,
      message:
        status === "failed" ? spans.find((s) => s.error)?.error : undefined,
    });
  const missingParents = spans.some(
    (s) => s.parentId && !merged.has(s.parentId),
  );
  const usage = spans.reduce(
    (u, s) => ({
      inputTokens: u.inputTokens + (s.usage?.inputTokens || 0),
      outputTokens: u.outputTokens + (s.usage?.outputTokens || 0),
      estimatedCostUsd: u.estimatedCostUsd + (s.usage?.estimatedCostUsd || 0),
    }),
    { inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0 },
  );
  if (!spans.some((s) => s.usage?.estimatedCostUsd !== undefined))
    delete (usage as any).estimatedCostUsd;
  const next: Run = {
    id: run?.id || id("observed"),
    projectId,
    graph,
    input: text(data.input) ?? run?.input ?? text(roots[0]?.input) ?? "",
    config: {
      credentialId: "external-observed",
      model: spans.find((s) => s.model)?.model || "External app",
    },
    status,
    mode: "import",
    events,
    output: status === "completed" ? output : undefined,
    error:
      status === "failed"
        ? spans.find((s) => s.error)?.error ||
          "The source app reported a failed span."
        : undefined,
    createdAt: started,
    finishedAt: finished,
    usage,
    external: {
      ...origin,
      traceId: data.traceId,
      partial: !!origin.partial || missingParents || !data.status,
      spans,
    },
  };
  if (commit) commitObservedTraces([next]);
  return next;
}
export function commitObservedTraces(runs: Run[]) {
  for (const run of runs) projectById(run.projectId);
  assertWriteCapacity(Buffer.byteLength(JSON.stringify(runs)) * 3 + 65536);
  if (state.runs.length + runs.filter(r => !state.runs.some(existing => existing.id === r.id)).length > 300) throw new Error("Workspace trace limit reached. Existing traces were preserved.");
  for (const next of runs) {
    const existing = state.runs.find((r) => r.id === next.id);
    if (existing) Object.assign(existing, next);
    else state.runs.unshift(next);
    journal({
      runId: next.id,
      type: "external.snapshot",
      time: now(),
      source: next.external!.kind,
      spanCount: next.external!.spans.length,
      status: next.status,
    });
    if (next.external!.kind === "workbench" && tokens.has(tenantKey(next.projectId)))
      tokens.get(tenantKey(next.projectId))!.lastReceivedAt = now();
  }
  save();
  for (const run of runs) bus.emit(tenantKey(run.id), run);
}
