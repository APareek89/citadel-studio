import { authEnabled, tenantMap, tenantSet } from "./tenant.js";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { createHash } from "node:crypto";
import { z } from "zod";
import { projectById, now } from "./store.js";
import { recordTrace, commitObservedTraces } from "./telemetry.js";
import { registerIntegrationSecret } from "./integration-secrets.js";
import type { ObservedSpan } from "../shared/types.js";

// Public API v2: https://langfuse.com/docs/api-and-data-platform/features/observations-api
const CLOUD = [
  "cloud.langfuse.com",
  "us.cloud.langfuse.com",
  "jp.cloud.langfuse.com",
  "hipaa.cloud.langfuse.com",
];
type Connection = {
  url: string;
  publicKey: string;
  secretKey: string;
  projectName: string;
  remoteId: string;
  lastSyncAt?: string;
};
const connections = tenantMap<string, Connection>("langfuse-connections");
const generations = tenantMap<string, number>("langfuse-generations");
const syncing = tenantSet<string>("langfuse-syncing");
export function langfuseUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Enter a valid Langfuse base URL.");
  }
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !["", "/"].includes(url.pathname)
  )
    throw new Error(
      "Use the base URL only, without credentials, path, query or fragment.",
    );
  const cloud =
    url.protocol === "https:" &&
    CLOUD.includes(url.hostname) &&
    (!url.port || url.port === "443");
  const local =
    !authEnabled() && ["127.0.0.1", "localhost"].includes(url.hostname) &&
    ["http:", "https:"].includes(url.protocol);
  if (!cloud && !local)
    throw new Error(
      "Use Langfuse Cloud EU, US, Japan or HIPAA, or a localhost Langfuse v4 instance. Other self-hosted domains are not enabled yet.",
    );
  return url.origin;
}
async function api(
  c: Pick<Connection, "url" | "publicKey" | "secretKey">,
  route: string,
): Promise<any> {
  const url = new URL(c.url + route);
  return new Promise((resolve, reject) => {
    const fail = (message: string) => reject(new Error(message));
    const req = (url.protocol === "https:" ? httpsRequest : httpRequest)(
      url,
      {
        method: "GET",
        headers: {
          Authorization:
            "Basic " +
            Buffer.from(c.publicKey + ":" + c.secretKey).toString("base64"),
          Accept: "application/json",
        },
        timeout: 12000,
      },
      (res) => {
        const status = res.statusCode || 0;
        if (status !== 200) {
          res.resume();
          return fail(
            status === 401 || status === 403
              ? "Langfuse rejected these project keys. Check the keys and region."
              : status === 404
                ? "Langfuse endpoint is unavailable. This connector requires Cloud or self-hosted v4 observations API."
                : `Langfuse request failed (HTTP ${status}).`,
          );
        }
        let size = 0;
        const chunks: Buffer[] = [];
        res.on("data", (b: Buffer) => {
          size += b.length;
          if (size > 5_000_000) {
            req.destroy();
            fail("Langfuse response exceeded 5 MB. Reduce the sync window.");
          } else chunks.push(b);
        });
        res.on("end", () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
          } catch {
            fail("Langfuse returned malformed JSON.");
          }
        });
        res.on("error", () => fail("Langfuse response was interrupted."));
      },
    );
    req.on("timeout", () => {
      req.destroy();
      fail("Langfuse request timed out.");
    });
    req.on("error", () =>
      fail(
        "Could not reach Langfuse. Check its base URL, region and connectivity.",
      ),
    );
    req.end();
  });
}
export function langfuseStatus(projectId: string) {
  projectById(projectId);
  const c = connections.get(projectId);
  return {
    connected: !!c,
    url: c?.url,
    projectName: c?.projectName,
    lastSyncAt: c?.lastSyncAt,
  };
}
export async function connectLangfuse(projectId: string, raw: unknown) {
  projectById(projectId);
  const data = z
    .object({
      url: z.string().max(300),
      publicKey: z.string().trim().min(8).max(256),
      secretKey: z.string().trim().min(8).max(256),
    })
    .parse(raw);
  const url = langfuseUrl(data.url);
  registerIntegrationSecret(data.publicKey);
  registerIntegrationSecret(data.secretKey);
  registerIntegrationSecret(
    Buffer.from(data.publicKey + ":" + data.secretKey).toString("base64"),
  );
  const generation = (generations.get(projectId) || 0) + 1;
  generations.set(projectId, generation);
  const result = await api({ ...data, url }, "/api/public/projects");
  const projects = z
    .object({
      data: z
        .array(
          z.object({
            id: z.string().min(1).max(200),
            name: z.string().max(200),
          }),
        )
        .min(1)
        .max(20),
    })
    .safeParse(result);
  if (!projects.success)
    throw new Error("Langfuse did not return a project for these keys.");
  if (generations.get(projectId) !== generation)
    throw new Error("Connection request superseded.");
  connections.set(projectId, {
    ...data,
    url,
    projectName: projects.data.data[0].name,
    remoteId: projects.data.data[0].id,
  });
  return langfuseStatus(projectId);
}
export function disconnectLangfuse(projectId: string) {
  projectById(projectId);
  generations.set(projectId, (generations.get(projectId) || 0) + 1);
  connections.delete(projectId);
}
function boundedIO(value: unknown) {
  if (value === undefined || value === null) return undefined;
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > 23000
    ? text.slice(0, 22960) + "\n[truncated by local import limit]"
    : value;
}
function observation(row: any): ObservedSpan {
  if (
    !row ||
    typeof row.id !== "string" ||
    typeof row.traceId !== "string" ||
    typeof row.startTime !== "string"
  )
    throw new Error("Langfuse returned an invalid observation row.");
  const role =
    row.type === "GENERATION"
      ? "agent"
      : /agent|chain/i.test(row.type || "")
        ? "orchestrator"
        : /guardrail/i.test(row.type || "")
          ? "guardrail"
          : "tool";
  const usage =
    row.type === "GENERATION"
      ? {
          inputTokens: Number(row.inputUsage ?? row.usageDetails?.input ?? 0),
          outputTokens: Number(
            row.outputUsage ?? row.usageDetails?.output ?? 0,
          ),
          ...(row.totalCost !== undefined && row.totalCost !== null
            ? { estimatedCostUsd: Number(row.totalCost) }
            : {}),
        }
      : undefined;
  return {
    id: row.id,
    name: String(row.name || row.type || "Observed span").slice(0, 200),
    parentId: row.parentObservationId || undefined,
    status:
      row.level === "ERROR" ? "failed" : row.endTime ? "completed" : "running",
    role,
    startTime: new Date(row.startTime).toISOString(),
    endTime: row.endTime ? new Date(row.endTime).toISOString() : undefined,
    input: boundedIO(row.input),
    output: boundedIO(row.output),
    error:
      row.level === "ERROR"
        ? String(row.statusMessage || "Source app reported an error").slice(
            0,
            20000,
          )
        : undefined,
    model: row.model || undefined,
    usage,
  };
}
export async function syncLangfuse(projectId: string, hours = 24) {
  projectById(projectId);
  z.number().int().min(1).max(168).parse(hours);
  const c = connections.get(projectId);
  if (!c)
    throw new Error(
      "Connect Langfuse project keys again after a server restart.",
    );
  if (syncing.has(projectId))
    throw new Error("A Langfuse sync is already running.");
  syncing.add(projectId);
  try {
    const end = new Date();
    const start = new Date(end.getTime() - hours * 3600000);
    let cursor: string | undefined;
    const seen = new Set<string>();
    const rows: any[] = [];
    for (let page = 0; page < 3; page++) {
      const query = new URLSearchParams({
        fromStartTime: start.toISOString(),
        toStartTime: end.toISOString(),
        fields: "core,basic,io,model,usage,trace_context",
        limit: "100",
      });
      if (cursor) query.set("cursor", cursor);
      const response = await api(c, "/api/public/v2/observations?" + query);
      if (!Array.isArray(response.data) || response.data.length > 100)
        throw new Error(
          "Langfuse returned an unexpected observations response.",
        );
      rows.push(...response.data);
      cursor = response.meta?.cursor || undefined;
      if (!cursor) break;
      if (
        typeof cursor !== "string" ||
        cursor.length > 4000 ||
        seen.has(cursor)
      )
        throw new Error("Langfuse returned an invalid pagination cursor.");
      seen.add(cursor);
    }
    if (connections.get(projectId) !== c)
      throw new Error("Langfuse was disconnected or replaced during sync.");
    // Validate every row before persisting any imported trace.
    const mapped = rows.map((row) => ({ row, span: observation(row) }));
    const groups = new Map<string, { name?: string; spans: ObservedSpan[] }>();
    for (const { row, span } of mapped) {
      const group: { name?: string; spans: ObservedSpan[] } = groups.get(
        row.traceId,
      ) || {
        name: row.traceName,
        spans: [],
      };
      group.spans.push(span);
      groups.set(row.traceId, group);
    }
    const namespace = createHash("sha256")
      .update(c.url + ":" + c.remoteId)
      .digest("hex");
    const prepared = [...groups].map(([traceId, group]) =>
      recordTrace(
        projectId,
        { traceId, name: group.name, spans: group.spans },
        { kind: "langfuse", namespace, partial: true },
        false,
      ),
    );
    commitObservedTraces(prepared);
    const runs = prepared.length;
    c.lastSyncAt = now();
    return {
      runs,
      spans: rows.length,
      limited: !!cursor,
      message: rows.length
        ? `Imported ${rows.length} observations across ${runs} traces. This is a partial snapshot of the last ${hours} hours${cursor ? "; the 300-observation limit was reached" : ""}.`
        : "Connected successfully; no observations in this time window. Run the instrumented app, then sync again.",
    };
  } finally {
    syncing.delete(projectId);
  }
}
