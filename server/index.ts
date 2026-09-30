import rateLimit from "express-rate-limit";
import { authEnabled, withTenant, tenantKey, bindTenant, requireTenant } from "./tenant.js";
import { initializeAuth, mountAuth, requireAuth, sameOrigin, getUser } from "./auth.js";
import { query } from "./db.js";
import { examples } from "./examples.js";
import express from "express";
import { z, ZodError } from "zod";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { state, id, now, save, projectById, assertWriteCapacity } from "./store.js";
import {
  addCredential,
  credentials,
  importCredential,
  discoverModels,
  cachedModels,
  redact,
  secretsPath,
  safeObject,
  spendStatus,
} from "./providers.js";
import { defaultGraph, graphSchema, validateGraph } from "./graph.js";
import { dockerAvailable } from "./sandbox.js";
import { preflight, startRun, cancelRun, bus, cancelAll } from "./runs.js";
import {
  align,
  compare,
  saveSuite,
  evaluate,
  planRedTeam,
  runRedTeam,
} from "./workflows.js";
import { exportProject } from "./export.js";
import {
  discoverRepo,
  readSource,
  importedExecutionAvailability,
} from "./importer.js";
import { hosting, validProxyToken } from "./hosting.js";
import {
  listGithubRepos,
  checkoutGithub,
  githubStatus,
  connectGithubToken,
  disconnectGithubToken,
  setGithubRedactionHook,
} from "./github.js";
import { importUploadedFolder, ensureUploadedSource } from "./uploads.js";
import { registerIntegrationSecret, registerServerSecret } from "./integration-secrets.js";
import {
  createReceiver,
  receiverStatus,
  authorizeReceiver,
  receiverOwner,
  recordTrace,
  disconnectReceiver,
} from "./telemetry.js";
import {
  connectLangfuse,
  disconnectLangfuse,
  langfuseStatus,
  syncLangfuse,
} from "./langfuse.js";
import { interpretMap, scrubSource } from "./semantic-map.js";
import type {
  Project,
  Provider,
  Alignment,
  EvalSuite,
} from "../shared/types.js";
const app = express();
const port = Number(process.env.PORT || 3001);
const development = process.env.WORKBENCH_DEV === "1";
if (!development && !existsSync("dist/index.html")) {
  throw new Error(
    "The app build is missing. Run npm run build before npm start, or use npm run dev for development.",
  );
}
app.disable("x-powered-by");
const trustedProxy = process.env.WORKBENCH_TRUSTED_PROXY_IP || "172.28.0.3";
app.set("trust proxy", (ip: string) => ip.replace(/^::ffff:/, "") === trustedProxy);
await initializeAuth();
app.get("/healthz", async (_req, res) => {
  try { if (authEnabled()) await query("select 1"); res.json({ ok: true }); }
  catch { res.status(503).json({ ok: false }); }
});
if (hosting.proxyToken) registerServerSecret(hosting.proxyToken);
app.use((req, res, next) => {
  const host = req.headers.host;
  if (hosting.publicOrigin) {
    if (!authEnabled() && !validProxyToken(req.headers["x-workbench-proxy-token"]))
      return res
        .status(403)
        .json({ error: "Authenticated proxy access required" });
    if (host?.toLowerCase() !== hosting.publicHost)
      return res.status(403).json({ error: "Unrecognized host" });
  } else if (!["127.0.0.1", "localhost"].includes(host?.split(":")[0] || ""))
    return res.status(403).json({ error: "Localhost access only" });
  if (hosting.publicOrigin && authEnabled()) {
    if (req.socket.remoteAddress?.replace(/^::ffff:/, "") !== trustedProxy)
      return res.status(403).json({ error: "Trusted application proxy required" });
    req.headers["x-forwarded-host"] = hosting.publicHost;
    req.headers["x-forwarded-proto"] = "https";
  }
  const origin = req.headers.origin;
  if (
    origin &&
    !(
      hosting.publicOrigin
        ? [hosting.publicOrigin]
        : [`http://127.0.0.1:${port}`, `http://localhost:${port}`]
    ).includes(origin)
  )
    return res.status(403).json({ error: "Cross-origin access denied" });
  if (hosting.publicOrigin && req.headers["sec-fetch-site"] === "cross-site")
    return res.status(403).json({ error: "Cross-site access denied" });
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  if (req.path.startsWith("/api")) res.setHeader("Cache-Control", "no-store");
  if (
    ["POST", "PUT", "DELETE", "PATCH"].includes(req.method) &&
    !req.path.startsWith("/auth/") && !req.is("application/json")
  )
    return res.status(415).json({ error: "Use application/json" });
  next();
});
setGithubRedactionHook(registerIntegrationSecret);
// The proxy exposes this one ingestion route without browser Basic Auth.
// Reject unknown receiver tokens before allocating/parsing a request body.
app.use(async (req, res, next) => {
  const native =
    req.method === "POST" &&
    req.path.match(/^\/api\/telemetry\/([A-Za-z0-9_-]+)\/spans$/);
  if (native) {
    try {
      const owner = receiverOwner(native[1], req.headers.authorization);
      if (authEnabled() && !(await query("select 1 from users where id=$1 and disabled_at is null", [owner])).length)
        throw new Error("Account is unavailable.");
      res.locals.nativeReceiver = true;
      if (authEnabled()) return withTenant(owner, next);
    } catch {
      return res
        .status(401)
        .json({
          error:
            "Telemetry token is missing, expired or belongs to another project.",
        });
    }
  }
  next();
});
app.use("/api/repos/upload", express.json({ limit: "16mb" }));
app.use(express.json({ limit: "2mb" }));
app.use("/auth", express.urlencoded({ extended: false, limit: "16kb" }));
mountAuth(app);
app.use("/api", (req, res, next) => {
  if (res.locals.nativeReceiver || req.path === "/health") return next();
  return requireAuth(req, res, next);
});
app.use("/api", (req, res, next) => res.locals.nativeReceiver ? next() : sameOrigin(req, res, next));
const mutationLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 60, standardHeaders: "draft-8", legacyHeaders: false,
  skip: req => !authEnabled() || ["GET", "HEAD"].includes(req.method), message: { error: "Workspace action limit reached. Please wait." } });
app.use("/api", mutationLimit);
const actionWindows = new Map<string, { started: number; count: number }>();
app.use("/api", (req, res, next) => {
  if (!authEnabled() || res.locals.nativeReceiver || ["GET", "HEAD"].includes(req.method)) return next();
  const key = requireTenant().id, at = Date.now();
  let window = actionWindows.get(key);
  if (!window || at - window.started > 15 * 60 * 1000) { window = { started: at, count: 0 }; actionWindows.set(key, window); }
  if (++window.count > 60) return res.status(429).json({ error: "Workspace action limit reached. Please wait." });
  next();
});
app.use("/api", async (req, _res, next) => {
  if (authEnabled() && !["GET", "HEAD"].includes(req.method)) assertWriteCapacity(Buffer.byteLength(JSON.stringify(req.body || {})) * 3 + 65536);
  const projectId = /^\/projects\/([^/]+)/.exec(req.path)?.[1] || req.body?.projectId;
  if (projectId) {
    const project = projectById(projectId);
    if (project.repo) await ensureUploadedSource(project.repo);
  }
  next();
});
app.post("/api/examples", async (_req, res) => res.json(await examples()));
const configSchema = z.object({
  credentialId: z.string().min(1),
  model: z.string().min(1),
  temperature: z.number().min(0).max(2).optional(),
});
const runSchema = z.object({
  projectId: z.string(),
  input: z.string().min(1).max(40000),
  config: configSchema,
  mode: z.enum(["build", "compare", "eval", "redteam", "import"]).optional(),
});
const providerSchema = z.enum([
  "gemini",
  "openai",
  "anthropic",
  "groq",
  "openrouter",
]);
const find = <T extends { id: string }>(items: T[], target: string) => {
  const item = items.find((i) => i.id === target);
  if (!item) throw new Error("Item not found");
  return item;
};
app.get("/api/health", (_req, res) => {
  let uiEntry: string | null = null;
  if (!development && existsSync("dist/index.html")) {
    // Read the published entry on each check: a build can change while this process runs.
    uiEntry =
      readFileSync("dist/index.html", "utf8").match(
        /<script\b[^>]*\bsrc="(\/assets\/[^\"]+\.js)"/,
      )?.[1] || null;
  }
  res.json({ ok: true, version: "0.1.0", uiEntry });
});
app.get("/api/bootstrap", async (_req, res) =>
  res.json({
    ...state,
    projects: state.projects.map((project) => ({
      ...project,
      ...(project.repo
        ? {
            repo: {
              ...project.repo,
              ...importedExecutionAvailability(project.repo),
            },
          }
        : {}),
    })),
    credentials: credentials(),
    system: {
      docker: await dockerAvailable(),
      localSecretsAvailable: !hosting.publicOrigin && existsSync(secretsPath),
      hosting: {
        mode: hosting.publicOrigin ? "hosted" : "local",
        publicOrigin: hosting.publicOrigin,
        localSource: !hosting.publicOrigin,
      },
      spend: spendStatus(),
    },
  }),
);
app.post("/api/projects", (req, res) => {
  const body = z
    .object({
      name: z.string().trim().min(1).max(120),
      brief: z.string().max(20000).default(""),
    })
    .parse(req.body);
  const project: Project = safeObject({
    id: id("project"),
    name: body.name,
    brief: body.brief,
    graph: defaultGraph(body.name),
    createdAt: now(),
    updatedAt: now(),
  });
  if (state.projects.length >= 40) throw new Error("Workspace project limit reached.");
  state.projects.unshift(project);
  save();
  res.json(project);
});
app.put("/api/projects/:id", (req, res) => {
  const project = projectById(req.params.id);
  const body = z
    .object({
      name: z.string().trim().min(1).max(120).optional(),
      brief: z.string().max(20000).optional(),
      graph: graphSchema.optional(),
    })
    .parse(req.body);
  if (body.graph) {
    if (project.repo)
      throw new Error(
        "Imported graphs are source-owned. Review a source patch instead of editing the map.",
      );
    const check = validateGraph(body.graph);
    if (!check.ok)
      return res.status(422).json({
        error: check.issues.map((i) => i.message).join("; "),
        issues: check.issues,
      });
    project.graph = safeObject({
      ...body.graph,
      id: project.graph.id,
      revision: project.graph.revision + 1,
    });
  }
  if (body.name) project.name = redact(body.name);
  if (body.brief !== undefined) project.brief = redact(body.brief);
  project.updatedAt = now();
  save();
  res.json(project);
});
app.post("/api/projects/:id/align", async (req, res) => {
  const b = z
    .object({ brief: z.string().min(8).max(20000), config: configSchema })
    .parse(req.body);
  res.json(await align(req.params.id, b.brief, b.config));
});
app.post("/api/projects/:id/accept", (req, res) => {
  const p = projectById(req.params.id);
  if (p.repo) throw new Error("A connected project is source-owned");
  if (!p.alignment) throw new Error("Generate alignment first");
  const graph = graphSchema.parse(
    req.body.alignment?.graph || p.alignment.graph,
  );
  const check = validateGraph(graph);
  if (!check.ok) throw new Error(check.issues.map((i) => i.message).join("; "));
  p.graph = safeObject({
    ...graph,
    id: p.graph.id,
    revision: p.graph.revision + 1,
  });
  p.updatedAt = now();
  save();
  res.json(p);
});
app.get("/api/credentials", (_req, res) => res.json(credentials()));
app.post("/api/credentials", (req, res) => {
  const b = z
    .object({
      provider: providerSchema,
      label: z.string().max(80).default(""),
      key: z.string().min(12).max(512),
    })
    .parse(req.body);
  res.json(addCredential(b.provider, b.label, b.key));
});
app.post("/api/credentials/import", (req, res) => {
  if (hosting.publicOrigin)
    return res.status(403).json({
      error: "Host secret-file import is disabled. Add a session credential.",
    });
  res.json(importCredential(providerSchema.parse(req.body.provider)));
});
app.post("/api/credentials/:id/validate", async (req, res) => {
  const models = await discoverModels(req.params.id);
  res.json({
    credential: credentials().find((c) => c.id === req.params.id),
    models,
  });
});
app.get("/api/credentials/:id/models", async (req, res) => {
  const models = cachedModels(req.params.id);
  res.json(models.length ? models : await discoverModels(req.params.id));
});
app.post("/api/preflight", async (req, res) => {
  const b = z
    .object({
      projectId: z.string(),
      input: z.string().max(40000),
      config: z.object({
        credentialId: z.string().default(""),
        model: z.string().default(""),
      }),
    })
    .parse(req.body);
  res.json(await preflight(b.projectId, b.config, b.input));
});
app.post("/api/runs", async (req, res) =>
  res.json(await startRun(runSchema.parse(req.body))),
);
app.get("/api/runs/:id", (req, res) =>
  res.json(find(state.runs, req.params.id)),
);
app.post("/api/runs/:id/cancel", (req, res) => {
  if (state.runs.find((r) => r.id === req.params.id)?.external)
    return res.status(409).json({
      error:
        "This is an observed external run. Cancel it in the source application.",
    });
  const run = cancelRun(req.params.id);
  if (!run) return res.status(404).json({ error: "Run not found" });
  res.json(run);
});
app.get("/api/runs/:id/events", (req, res) => {
  const run = find(state.runs, req.params.id);
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();
  const send = (r: unknown) => res.write(`data: ${JSON.stringify(r)}\n\n`);
  send(run);
  const channel = tenantKey(run.id);
  bus.on(channel, send);
  const heartbeat = setInterval(bindTenant(async () => {
    try {
      if (authEnabled() && !(await getUser(req, true))) { res.end(); return; }
      res.write(": heartbeat\n\n");
    } catch { res.end(); }
  }), 15000);
  req.on("close", () => {
    clearInterval(heartbeat);
    bus.off(channel, send);
  });
});
app.get(
  "/api/projects/:id/export",
  async (req, res) => await exportProject(projectById(req.params.id), res),
);
async function mapSource(
  root: string,
  mapping: "ai" | "static",
  config?: z.infer<typeof configSchema>,
) {
  const source = await discoverRepo(root);
  if (mapping === "ai") {
    if (!config)
      throw new Error(
        "Add a validated model credential for AI mapping, or choose source inventory only.",
      );
    try {
      return await interpretMap(source, config);
    } catch (error) {
      const candidates = source.graph.nodes.filter(
        (n) => !n.hidden && n.source && n.role !== "resource",
      ).length;
      source.repo.mapping = {
        method: "static",
        discoveredFiles: source.repo.sources.length,
        candidates,
        mappedCandidates: 0,
        unresolvedCandidates: candidates,
        sourceFilesRead: 0,
        truncated: true,
        notes: [
          "Source access succeeded. AI mapping failed; source candidates remain available. Retry AI mapping or inspect the source inventory.",
        ],
        error: redact((error as Error).message),
      };
    }
  } else if (!source.repo.mapping) {
    const candidates = source.graph.nodes.filter(
      (n) => !n.hidden && n.source && n.role !== "resource",
    ).length;
    source.repo.mapping = {
      method: "static",
      discoveredFiles: source.repo.sources.length,
      candidates,
      mappedCandidates: 0,
      unresolvedCandidates: candidates,
      sourceFilesRead: 0,
      truncated: false,
      notes: [
        "Deterministic source candidates only. Choose AI workflow map for semantic interpretation.",
      ],
    };
  }
  return source;
}
app.get("/api/github/status", async (_req, res) =>
  res.json(await githubStatus()),
);
app.post("/api/github/token", async (req, res) =>
  res.json(
    await connectGithubToken(
      z.object({ token: z.string().min(8).max(512) }).parse(req.body).token,
    ),
  ),
);
app.delete("/api/github/token", async (_req, res) => {
  disconnectGithubToken();
  res.json(await githubStatus());
});
app.post("/api/repos/upload", async (req, res) => {
  const b = z
    .object({
      name: z.string().min(1).max(120),
      files: z
        .array(
          z.object({ path: z.string().min(1).max(700), content: z.string() }),
        )
        .max(500),
      mapping: z.enum(["ai", "static"]).default("static"),
      config: configSchema.optional(),
    })
    .parse(req.body);
  if (state.projects.length >= 40) throw new Error("Workspace project limit reached.");
  const upload = await importUploadedFolder({ name: b.name, files: b.files });
  const discovered = await mapSource(upload.rootPath, b.mapping, b.config);
  discovered.repo.sourceKind = "upload";
  discovered.repo.sourceBundle = upload.sourceBundle;
  discovered.repo.name = upload.name;
  discovered.graph.name = upload.name;
  const p: Project = {
    id: id("project"),
    name: discovered.repo.name,
    brief: discovered.graph.description,
    ...discovered,
    createdAt: now(),
    updatedAt: now(),
  };
  state.projects.unshift(p);
  save();
  res.json({
    ...p,
    upload: {
      acceptedFiles: upload.acceptedFiles,
      skippedFiles: upload.skippedFiles,
    },
  });
});
app.post("/api/projects/:id/remap", async (req, res) => {
  const p = projectById(req.params.id);
  if (!p.repo) throw new Error("Connect source first.");
  const b = z
    .object({
      mapping: z.enum(["ai", "static"]).default("static"),
      config: configSchema.optional(),
    })
    .parse(req.body);
  const priorGraph = p.graph,
    priorRepo = p.repo;
  const discovered = await mapSource(priorRepo.path, b.mapping, b.config);
  if (p.graph !== priorGraph || p.repo !== priorRepo)
    return res.status(409).json({
      error:
        "Source changed while mapping. The newer connection was retained; refresh before trying again.",
    });
  if (p.repo.sourceKind === "upload") {
    discovered.repo.sourceKind = "upload";
    discovered.repo.sourceBundle = p.repo.sourceBundle;
    discovered.repo.name = p.repo.name;
    discovered.graph.name = p.repo.name;
  }
  p.graph = {
    ...discovered.graph,
    id: priorGraph.id,
    revision: priorGraph.revision + 1,
  };
  p.repo = discovered.repo;
  if (/^[a-f0-9]{20,}$/.test(p.name)) p.name = discovered.repo.name;
  p.updatedAt = now();
  save();
  res.json(p);
});
app.get("/api/projects/:id/source", async (req, res) => {
  const project = projectById(req.params.id);
  if (!project.repo) throw new Error("Connect source first.");
  const query = z
    .object({
      path: z.string().min(1).max(700),
      line: z.coerce.number().int().positive().optional(),
    })
    .parse(req.query);
  if (!project.repo.sources.some((source) => source.path === query.path))
    return res
      .status(404)
      .json({ error: "Source is not in this project's inventory." });
  const lines = scrubSource(
    await readSource(project.repo.path, query.path),
  ).split("\n");
  const line = Math.min(query.line || 1, Math.max(1, lines.length));
  const startLine = Math.max(1, line - 20);
  const slice = lines.slice(startLine - 1, line + 180).join("\n");
  res.json({
    path: query.path,
    content: slice.slice(0, 40000),
    startLine,
    truncated:
      startLine > 1 || line + 180 < lines.length || slice.length > 40000,
  });
});
app.get("/api/projects/:id/connections", (req, res) =>
  res.json({
    native: receiverStatus(req.params.id),
    langfuse: langfuseStatus(req.params.id),
  }),
);
app.post("/api/projects/:id/telemetry/token", (req, res) =>
  res.json(createReceiver(req.params.id)),
);
app.delete("/api/projects/:id/telemetry/token", (req, res) => {
  disconnectReceiver(req.params.id);
  res.json({ ok: true });
});
app.post("/api/telemetry/:id/spans", (req, res) => {
  try {
    authorizeReceiver(req.params.id, req.headers.authorization);
  } catch {
    return res.status(401).json({
      error:
        "Telemetry token is missing, expired or belongs to another project.",
    });
  }
  const run = recordTrace(req.params.id, req.body);
  res.json({
    runId: run.id,
    status: run.status,
    spans: run.external?.spans.length,
  });
});
app.get("/api/telemetry/client.mjs", (_req, res) => {
  res.attachment("workbench-client.mjs");
  res
    .type("text/javascript")
    .send(readFileSync("sdk/workbench-client.mjs", "utf8"));
});
app.get("/api/telemetry/client.py", (_req, res) => {
  res.attachment("workbench_client.py");
  res.type("text/plain").send(readFileSync("sdk/workbench-client.py", "utf8"));
});
app.post("/api/projects/:id/langfuse", async (req, res) =>
  res.json(await connectLangfuse(req.params.id, req.body)),
);
app.delete("/api/projects/:id/langfuse", (req, res) => {
  disconnectLangfuse(req.params.id);
  res.json({ ok: true });
});
app.post("/api/projects/:id/langfuse/sync", async (req, res) =>
  res.json(
    await syncLangfuse(
      req.params.id,
      z
        .object({ hours: z.number().int().min(1).max(168).default(24) })
        .parse(req.body).hours,
    ),
  ),
);
app.get("/api/repos/github", async (_req, res) =>
  res.json(await listGithubRepos()),
);
app.get("/api/repos/default", (_req, res) =>
  res.json({
    path: hosting.publicOrigin
      ? ""
      : path.join(
          homedir(),
          "Documents",
          "Codex",
          "2026-09-05",
          "use",
          "work",
          "render-to-vercel",
          "repos",
          "agentic-learning-studio",
        ),
  }),
);
app.post("/api/repos/connect", async (req, res) => {
  const b = z
    .object({
      path: z.string().trim().min(1).max(1000),
      projectId: z.string().optional(),
      mapping: z.enum(["ai", "static"]).default("static"),
      config: configSchema.optional(),
    })
    .parse(req.body);
  if ((hosting.publicOrigin || authEnabled()) && !/^https:\/\//i.test(b.path))
    return res.status(403).json({
      error:
        "Host filesystem imports are disabled. Connect GitHub or upload a folder.",
    });
  if (!b.projectId && state.projects.length >= 40) throw new Error("Workspace project limit reached.");
  const existing = b.projectId ? projectById(b.projectId) : undefined;
  const priorGraph = existing?.graph,
    priorRepo = existing?.repo;
  const discovered = await mapSource(
    /^https:\/\//i.test(b.path) ? await checkoutGithub(b.path) : b.path,
    b.mapping,
    b.config,
  );
  let p: Project;
  if (b.projectId) {
    p = projectById(b.projectId);
    if (p.graph !== priorGraph || p.repo !== priorRepo)
      return res.status(409).json({
        error:
          "Project changed while connecting. The newer source was retained; refresh before trying again.",
      });
    if (priorRepo?.path !== discovered.repo.path) {
      disconnectReceiver(p.id);
      disconnectLangfuse(p.id);
    }
    p.graph = {
      ...discovered.graph,
      id: priorGraph!.id,
      revision: priorGraph!.revision + 1,
    };
    p.repo = discovered.repo;
    p.name = discovered.repo.name;
    p.updatedAt = now();
  } else {
    p = {
      id: id("project"),
      name: discovered.repo.name,
      brief: discovered.graph.description,
      ...discovered,
      createdAt: now(),
      updatedAt: now(),
    };
    state.projects.unshift(p);
  }
  save();
  res.json(p);
});
app.post("/api/projects/:id/import-run", async (req, res) => {
  const b = z
    .object({ input: z.string().min(1).max(40000), config: configSchema })
    .parse(req.body);
  const p = projectById(req.params.id);
  if (!p.repo) throw new Error("Connect a repository first");
  res.json(await startRun({ ...b, projectId: p.id, mode: "import" }));
});
app.post("/api/comparisons", async (req, res) => {
  const b = z
    .object({
      projectId: z.string(),
      input: z.string().min(1).max(40000),
      strategy: z.enum(["node", "workflow"]),
      nodeId: z.string().optional(),
      slots: z
        .array(
          z.object({ label: z.string().min(1).max(60), config: configSchema }),
        )
        .min(2)
        .max(5),
    })
    .parse(req.body);
  res.json(await compare(b));
});
app.get("/api/comparisons/:id", (req, res) =>
  res.json(find(state.comparisons, req.params.id)),
);
const caseSchema = z.object({
  id: z.string().min(1).max(80),
  input: z.string().min(1).max(40000),
  expected: z.string().max(4000).optional(),
  assertions: z
    .array(
      z.object({
        type: z.enum([
          "contains",
          "not-contains",
          "regex",
          "json",
          "max-length",
        ]),
        value: z.string().max(200),
      }),
    )
    .max(20),
  sourceRunId: z.string().optional(),
});
const suiteSchema = z.object({
  projectId: z.string(),
  name: z.string().min(1).max(100),
  cases: z.array(caseSchema).min(1).max(20),
  judge: z
    .object({ rubric: z.string().min(1).max(4000), config: configSchema })
    .optional(),
});
app.post("/api/suites", (req, res) =>
  res.json(saveSuite(suiteSchema.parse(req.body))),
);
app.put("/api/suites/:id", (req, res) =>
  res.json(saveSuite(suiteSchema.parse(req.body), req.params.id)),
);
app.post("/api/suites/:id/run", (req, res) => {
  const b = z
    .object({ config: configSchema, baselineId: z.string().optional() })
    .parse(req.body);
  res.json(evaluate(req.params.id, b.config, b.baselineId));
});
app.get("/api/reports/:id", (req, res) =>
  res.json(find(state.reports, req.params.id)),
);
app.post("/api/redteam/plan", async (req, res) => {
  const b = z
    .object({
      projectId: z.string(),
      scope: z.string(),
      brandRules: z.string().max(4000),
      maxProbes: z.number().int().min(1).max(6).optional(),
      config: configSchema.optional(),
      mode: z.enum(["source-review", "behavioral"]).optional(),
    })
    .parse(req.body);
  res.json(await planRedTeam(b));
});
app.post("/api/redteam/:id/run", async (req, res) => {
  const b = z
    .object({ config: configSchema, confirmed: z.literal(true) })
    .parse(req.body);
  res.json(await runRedTeam(req.params.id, b.config));
});
app.get("/api/redteam/:id", (req, res) =>
  res.json(find(state.redPlans, req.params.id)),
);
app.use("/api", (_req, res) =>
  res.status(404).json({ error: "API route not found" }),
);
app.use(
  (
    error: Error,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    if (res.headersSent) return res.end();
    res
      .status(
        (error as any).type === "entity.too.large"
          ? 413
          : error instanceof ZodError
            ? 422
            : /not found/i.test(error.message)
              ? 404
              : 400,
      )
      .json({
        error: redact(
          error instanceof ZodError
            ? error.issues
                .map((i) => `${i.path.join(".")}: ${i.message}`)
                .join("; ")
            : error.message,
        ),
      });
  },
);
if (!development) {
  // The HTML selects the current hashed bundle; it must never select an old release from cache.
  app.use((_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  app.use(express.static("dist", { index: false, dotfiles: "deny" }));
  app.get("/{*path}", (_req, res) =>
    res.sendFile(path.resolve("dist/index.html")),
  );
} else {
  const { createServer } = await import("vite");
  const vite = await createServer({
    server: {
      middlewareMode: true,
      fs: {
        deny: [
          "**/.env*",
          "**/.local/**",
          "**/*accessKeys*",
          "**/*credentials*",
          "**/mysecrets*",
          "**/.git/**",
          "**/server/**",
        ],
      },
    },
    appType: "spa",
  });
  app.use((req, res, next) => {
    if (
      /accesskeys|mysecrets|credentials|\.local|\.env|\.git|\/server\//i.test(
        decodeURIComponent(req.path),
      )
    )
      return res.sendStatus(403);
    next();
  });
  app.use(vite.middlewares);
}
const server = app.listen(port, process.env.HOST || "127.0.0.1", () =>
  console.log(`Agent Workbench: http://127.0.0.1:${port}`),
);
function shutdown() {
  cancelAll();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 4000).unref();
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
