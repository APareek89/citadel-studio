import express from "express";
import { z, ZodError } from "zod";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { state, id, now, save, projectById } from "./store.js";
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
import { discoverRepo } from "./importer.js";
import type {
  Project,
  Provider,
  Alignment,
  EvalSuite,
} from "../shared/types.js";
const app = express();
const port = Number(process.env.PORT || 3001);
app.disable("x-powered-by");
app.use((req, res, next) => {
  const host = req.headers.host?.split(":")[0];
  if (!["127.0.0.1", "localhost"].includes(host || ""))
    return res.status(403).json({ error: "Localhost access only" });
  const origin = req.headers.origin;
  if (
    origin &&
    ![`http://127.0.0.1:${port}`, `http://localhost:${port}`].includes(origin)
  )
    return res.status(403).json({ error: "Cross-origin access denied" });
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  if (req.path.startsWith("/api")) res.setHeader("Cache-Control", "no-store");
  if (
    ["POST", "PUT", "DELETE", "PATCH"].includes(req.method) &&
    !req.is("application/json")
  )
    return res.status(415).json({ error: "Use application/json" });
  next();
});
app.use(express.json({ limit: "2mb" }));
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
app.get("/api/health", (_req, res) => res.json({ ok: true, version: "0.1.0" }));
app.get("/api/bootstrap", async (_req, res) =>
  res.json({
    ...state,
    credentials: credentials(),
    system: {
      docker: await dockerAvailable(),
      localSecretsAvailable: existsSync(secretsPath),
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
      return res
        .status(422)
        .json({
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
app.post("/api/credentials/import", (req, res) =>
  res.json(importCredential(providerSchema.parse(req.body.provider))),
);
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
  bus.on(run.id, send);
  const heartbeat = setInterval(() => res.write(": heartbeat\n\n"), 15000);
  req.on("close", () => {
    clearInterval(heartbeat);
    bus.off(run.id, send);
  });
});
app.get(
  "/api/projects/:id/export",
  async (req, res) => await exportProject(projectById(req.params.id), res),
);
app.get("/api/repos/default", (_req, res) =>
  res.json({
    path: path.join(
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
    })
    .parse(req.body);
  const discovered = await discoverRepo(b.path);
  let p: Project;
  if (b.projectId) {
    p = projectById(b.projectId);
    p.graph = discovered.graph;
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
      maxProbes: z.number().int().min(1).max(6),
      config: configSchema,
    })
    .parse(req.body);
  res.json(await planRedTeam(b));
});
app.post("/api/redteam/:id/run", (req, res) => {
  const b = z
    .object({ config: configSchema, confirmed: z.literal(true) })
    .parse(req.body);
  res.json(runRedTeam(req.params.id, b.config));
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
        error instanceof ZodError
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
if (existsSync("dist/index.html") && process.env.WORKBENCH_DEV !== "1") {
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
const server = app.listen(port, "127.0.0.1", () =>
  console.log(`Agent Workbench: http://127.0.0.1:${port}`),
);
function shutdown() {
  cancelAll();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 4000).unref();
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
