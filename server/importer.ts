import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import type {
  Graph,
  GraphEdge,
  GraphNode,
  RepoInfo,
  RedPlan,
} from "../shared/types.js";

const execFileAsync = promisify(execFile);
export const LEARNING_REVISION = "5968d231fae50fa3364470fbf0377968630aff6d";
export const LEARNING_REPO = "APareek89/agentic-learning-studio";
const MAX_FILE_BYTES = 900_000;
const excluded =
  /(^|\/)(?:\.git|node_modules|dist|build|coverage|\.next|\.env[^/]*|[^/]*(?:secret|credential)[^/]*)(\/|$)/i;
const supported = /\.(?:[cm]?[jt]sx?|json|md|css|html|sql)$/i;

/** Metadata only: never read .env, credentials, git configuration or symlink targets as source. */
export async function sourceFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  const walk = async (directory: string, depth = 0): Promise<void> => {
    if (depth > 6 || files.length >= 500) return;
    for (const entry of (
      await readdir(directory, { withFileTypes: true })
    ).sort((a, b) => a.name.localeCompare(b.name))) {
      if (files.length >= 500) break;
      const relative = path
        .relative(root, path.join(directory, entry.name))
        .split(path.sep)
        .join("/");
      if (entry.isSymbolicLink() || excluded.test(relative)) continue;
      if (entry.isDirectory())
        await walk(path.join(directory, entry.name), depth + 1);
      else if (entry.isFile() && supported.test(entry.name))
        files.push(relative);
    }
  };
  await walk(root);
  return files;
}

export async function readSource(
  root: string,
  relative: string,
): Promise<string> {
  if (
    excluded.test(relative) ||
    path.isAbsolute(relative) ||
    relative.split(/[\\/]/).includes("..")
  )
    throw new Error("Source path is not allowed.");
  const candidate = path.resolve(root, relative);
  const resolved = await realpath(candidate);
  if (
    !resolved.startsWith(root + path.sep) ||
    (await lstat(candidate)).isSymbolicLink()
  )
    throw new Error("Source symlinks are not imported.");
  const stat = await lstat(candidate);
  if (!stat.isFile() || stat.size > MAX_FILE_BYTES)
    throw new Error("Source file exceeds import limits.");
  return readFile(candidate, "utf8");
}

async function git(root: string, args: string[]): Promise<string> {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
  );
  const { stdout } = await execFileAsync(
    "git",
    ["--no-replace-objects", "-c", "core.fsmonitor=false", "-C", root, ...args],
    { env, maxBuffer: 2_000_000, timeout: 10_000 },
  );
  return stdout.trim();
}

function category(file: string): string {
  if (/^public\//.test(file)) return "UI";
  if (/\.md$/i.test(file)) return "Documentation";
  if (/auth/i.test(file)) return "Authentication";
  if (/^(?:supabase|src\/rag)\/|\/db\./.test(file)) return "Data / retrieval";
  if (/^src\/agent\//.test(file)) return "Agent workflow";
  if (/^src\/render\//.test(file)) return "Rendering";
  return "Supporting code";
}

function lineOf(text: string, symbol: string): number {
  const lines = text.split("\n");
  const i = lines.findIndex((line) =>
    new RegExp(`(?:function|const)\\s+${symbol}\\b`).test(line),
  );
  return i < 0 ? 1 : i + 1;
}

export async function discoverRepo(
  inputPath: string,
): Promise<{ graph: Graph; repo: RepoInfo }> {
  if (/^https?:\/\//i.test(inputPath))
    throw new Error(
      "Connect the existing local checkout first. Automatic URL cloning is not enabled.",
    );
  const root = await realpath(path.resolve(inputPath));
  if (!(await lstat(root)).isDirectory())
    throw new Error("Choose a local repository directory.");
  const files = await sourceFiles(root);
  if (!files.length) throw new Error("No supported source files found.");
  const revision = await git(root, ["rev-parse", "HEAD"]).catch(
    () => "unversioned",
  );
  const packageText = files.includes("package.json")
    ? await readSource(root, "package.json")
    : "{}";
  let packageName = path.basename(root);
  try {
    packageName = JSON.parse(packageText).name || packageName;
  } catch {
    /* discovery can retain malformed source */
  }
  const isLearning =
    packageName === "agentic-learning-studio" &&
    [
      "src/agent/orchestrator.ts",
      "src/agent/nodes.ts",
      "src/render/schema.ts",
    ].every((p) => files.includes(p));
  const limitations = [
    "Static source relationships are inferred; no execution has been observed yet.",
    "Hidden resources remain part of the app graph. File discovery excludes secrets, symlinks, dependencies and generated directories; capped at 500 files and depth 6.",
    "Dynamic dispatch and external service internals cannot be reconstructed exhaustively.",
  ];
  if (isLearning)
    limitations.push(
      "Live adapter executes only the original overview path at the inspected pinned revision, under macOS sandbox-exec. Full lesson build is mapped but not executed.",
      "Database/retrieval are disabled; artifact persistence uses isolated memory; production authentication, billing and Langfuse are not contacted. Output is explicitly ungrounded.",
      "Changed source or unsupported platforms remain discovery-only until a trusted execution adapter is available.",
    );
  else
    limitations.push(
      "No execution adapter exists for this repository. Source map only; arbitrary imported code is not run.",
    );
  const repo: RepoInfo = {
    path: root,
    name: packageName,
    revision,
    adapter: isLearning ? "learning-studio" : "discovery-only",
    coverage: isLearning
      ? [
          "Current overview/build source paths",
          "Legacy LangGraph distinguished",
          "Original overview functions executable through a pinned adapter",
          "Supporting source resources",
        ]
      : ["Source resource inventory"],
    limitations,
    sources: files.map((p) => ({ path: p, category: category(p) })),
  };
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const sourceNode = async (
    id: string,
    label: string,
    role: GraphNode["role"],
    file: string,
    symbol: string,
    description: string,
    hidden = false,
  ) => {
    const text = await readSource(root, file);
    nodes.push({
      id,
      label,
      role,
      hidden,
      description,
      source: { path: file, line: lineOf(text, symbol), symbol },
      modelFixed: role === "agent" ? false : undefined,
    });
  };
  const connect = (
    source: string,
    target: string,
    label: string,
    kind: GraphEdge["kind"] = "data",
    provenance: GraphEdge["provenance"] = "inferred",
  ) =>
    edges.push({
      id: `${source}:${target}:${edges.length}`,
      source,
      target,
      label,
      kind,
      provenance,
    });
  if (isLearning) {
    await sourceNode(
      "overview",
      "Overview orchestrator",
      "orchestrator",
      "src/agent/orchestrator.ts",
      "runOverviewJob",
      "Original current overview entry. Runs profiler and retrieval in parallel, then the reviewed outline.",
    );
    await sourceNode(
      "profiler",
      "Learner profiler",
      "agent",
      "src/agent/nodes.ts",
      "profiler",
      "Original prompt, model schema, profile precedence and deterministic profile assembly.",
    );
    await sourceNode(
      "retriever",
      "Retrieve evidence",
      "tool",
      "src/agent/nodes.ts",
      "retriever",
      "Original retriever; isolated adapter disables external DB and uploads, returning disclosed empty evidence.",
    );
    await sourceNode(
      "coverageBrief",
      "Coverage brief + schema",
      "agent",
      "src/agent/nodes.ts",
      "coverageBrief",
      "Original two parallel model calls; combines and bounds results, then validates the real BlueprintSchema.",
    );
    await sourceNode(
      "render",
      "Render overview HTML",
      "output",
      "src/render/index.ts",
      "renderArtifact",
      "Original renderer; returns a real preview-only HTML artifact.",
    );
    nodes.push({
      id: "artifact",
      label: "Isolated artifact store",
      role: "resource",
      hidden: true,
      description:
        "Adapter side-effect boundary: temporary in-memory persistence, never the source app database.",
      source: { path: "src/lib/artifacts.ts", symbol: "registerArtifact" },
    });
    await sourceNode(
      "build",
      "Full lesson build · discovery only",
      "orchestrator",
      "src/agent/orchestrator.ts",
      "runBuildJob",
      "Not executed by this MVP adapter: approved draft → plan → skeleton → parallel module bodies.",
    );
    await sourceNode(
      "planner",
      "Structural planner",
      "agent",
      "src/agent/nodes.ts",
      "planner",
      "Build-stage structural plan. Discovered; outside the overview execution adapter.",
    );
    await sourceNode(
      "architect",
      "Skeleton architect",
      "agent",
      "src/agent/nodes.ts",
      "architect",
      "Build-stage parsed skeleton with deterministic repair and validation.",
    );
    await sourceNode(
      "moduleWriter",
      "Module writer + repairs",
      "agent",
      "src/agent/nodes.ts",
      "runDeepDive",
      "Dynamic module instances, optional density and code repairs; bounded provider attempts.",
    );
    await sourceNode(
      "overviewProse",
      "Glossary + synthesis",
      "agent",
      "src/agent/nodes.ts",
      "writeOverviewProse",
      "Runs alongside generated module bodies in the full build.",
    );
    nodes.push({
      id: "dynamic",
      label: "Other routes / dynamic paths",
      role: "opaque",
      hidden: true,
      description:
        "Hands-on, skill generation and dynamic module calls are outside executable adapter coverage. Source references are available; execution remains unknown.",
    });
    connect("overview", "profiler", "parallel branch");
    connect("overview", "retriever", "parallel branch");
    connect("profiler", "coverageBrief", "profile / intent");
    connect("retriever", "coverageBrief", "evidence");
    connect("coverageBrief", "render", "validated Blueprint");
    connect("render", "artifact", "save isolated preview");
    connect("artifact", "build", "human approval · not executed");
    connect("build", "planner", "conditional full build");
    connect("planner", "architect", "plan");
    connect("architect", "moduleWriter", "dynamic worker pool");
    connect("architect", "overviewProse", "parallel prose");
    connect("architect", "architect", "bounded parse retry", "feedback");
  }
  const represented = new Set(
    nodes.flatMap((n) => (n.source ? [n.source.path] : [])),
  );
  for (const file of files) {
    const id = `file:${file}`;
    nodes.push({
      id,
      label: path.basename(file),
      role: "resource",
      hidden: true,
      description: `${category(file)} · supporting source file`,
      source: { path: file },
    });
    for (const node of nodes.filter(
      (n) => n.id !== id && n.source?.path === file,
    ))
      connect(node.id, id, "implemented_by", "dependency", "declared");
    if (isLearning && /src\/lib\/(?:auth|db|credits|langfuse)\.ts/.test(file))
      connect(
        "overview",
        id,
        "depends_on · isolated/disabled in adapter",
        "dependency",
      );
  }
  if (!isLearning)
    nodes.unshift({
      id: "unknown-entry",
      label: "Execution entry unresolved",
      role: "opaque",
      description:
        "Choose or implement a supported adapter before execution. Source inventory is not an executable graph.",
    });
  if (
    isLearning &&
    represented.has("src/agent/orchestrator.ts") &&
    files.includes("HANDOFF.md")
  )
    connect(
      "overview",
      "file:HANDOFF.md",
      "documented_by · not prompt context",
      "dependency",
    );
  const graph: Graph = {
    id: `repo-${createHash("sha256").update(root).digest("hex").slice(0, 12)}`,
    revision: 1,
    name: repo.name,
    description: isLearning
      ? "Source-linked application map. Overview can execute at the inspected revision; build and other routes are discovery only."
      : "Read-only source map; execution adapter unavailable.",
    nodes,
    edges,
    limits: {
      maxCalls: 6,
      maxRevisions: 1,
      timeoutMs: 120_000,
      maxOutputTokens: 3000,
    },
  };
  return { graph, repo };
}

export async function staticFindings(
  repo: RepoInfo,
): Promise<RedPlan["findings"]> {
  if (repo.adapter !== "learning-studio") return [];
  const nodes = await readSource(repo.path, "src/agent/nodes.ts");
  const matches = nodes.split("\n");
  const line =
    matches.findIndex((l) => l.includes("never block a build on the gate")) + 1;
  return line
    ? [
        {
          id: "source-codegate-advisory",
          title: "Code-integrity gate does not block publication",
          severity: "medium",
          evidenceType: "suspected",
          description:
            "The inspected source catches code-gate failure and continues the build. This is a documented design choice, not a reproduced exploit. Probe malformed generated snippets in an isolated test to evaluate your required release policy.",
          source: { path: "src/agent/nodes.ts", line, symbol: "runDeepDive" },
        },
      ]
    : [];
}

/** Read committed source without checking it out or invoking repository scripts/hooks. */
export async function committedSource(
  repo: RepoInfo,
  file: string,
): Promise<string> {
  if (repo.revision !== LEARNING_REVISION)
    throw new Error(
      "Execution is restricted to the inspected learning-studio revision.",
    );
  if (
    excluded.test(file) ||
    !file.startsWith("src/") ||
    !file.endsWith(".ts") ||
    file.includes("..")
  )
    throw new Error("Unapproved executable source file.");
  const original = await git(repo.path, [
    "show",
    `${LEARNING_REVISION}:${file}`,
  ]);
  const current = (await readSource(repo.path, file)).trim();
  if (current !== original)
    throw new Error(`Modified imported source is discovery-only: ${file}`);
  return original;
}
