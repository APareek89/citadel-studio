import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, access } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { discoverRepo, sourceFiles } from "../server/importer.js";
import { mapGenericSources } from "../server/source-map.js";
import type { GraphNode } from "../shared/types.js";

async function fixture(
  files: Record<string, string>,
  work: (directory: string) => Promise<void>,
) {
  const directory = await mkdtemp(path.join(tmpdir(), "workbench-source-map-"));
  try {
    for (const [relative, content] of Object.entries(files)) {
      const target = path.join(directory, relative);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, content);
    }
    await work(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
const symbol = (nodes: GraphNode[], file: string, name: string) =>
  nodes.find(
    (node) =>
      !node.hidden && node.source?.path === file && node.source.symbol === name,
  );

test("TypeScript routes resolve aliases, model calls and checks while infrastructure stays hidden", async () => {
  await fixture(
    {
      "package.json": '{"name":"route-fixture"}',
      "app/api/generate/route.ts":
        'import { orchestrate as run } from "../../workflow"; import { requireUser } from "@/lib/auth"; export async function POST(req) { requireUser(req); return run(req); }',
      "app/workflow.ts":
        'import { draft } from "./model"; import { validate } from "./checks"; export async function orchestrate(input) { return validate(await draft(input)); }',
      "app/model.ts":
        "export async function draft(input) { return client.messages.create({input}); }",
      "app/checks.ts":
        'export function validate(value) { if (!value) throw Error("invalid"); return value; }',
      "lib/auth.ts": "export function requireUser(req) { return req.user; }",
      "app/page.tsx":
        "export function Page(){ return <button>generateContent()</button> }",
    },
    async (directory) => {
      const { graph, repo } = await discoverRepo(directory);
      const route = symbol(graph.nodes, "app/api/generate/route.ts", "POST")!;
      const workflow = symbol(graph.nodes, "app/workflow.ts", "orchestrate")!;
      const model = symbol(graph.nodes, "app/model.ts", "draft")!;
      const check = symbol(graph.nodes, "app/checks.ts", "validate")!;
      assert.ok(route && workflow && model && check);
      assert.equal(route.role, "orchestrator");
      assert.equal(model.role, "agent");
      assert.equal(check.role, "validator");
      assert.ok(
        graph.edges.some(
          (edge) => edge.source === route.id && edge.target === workflow.id,
        ),
      );
      assert.ok(
        graph.edges.some(
          (edge) => edge.source === workflow.id && edge.target === model.id,
        ),
      );
      assert.ok(
        graph.edges.some(
          (edge) => edge.source === workflow.id && edge.target === check.id,
        ),
      );
      assert.ok(
        graph.edges.some(
          (edge) =>
            edge.source === route.id &&
            edge.target === "file:lib/auth.ts" &&
            edge.kind === "dependency",
        ),
      );
      assert.ok(
        graph.nodes
          .filter((node) => /auth|page/.test(node.source?.path || ""))
          .every((node) => node.hidden),
      );
      assert.equal(repo.adapter, "discovery-only");
      assert.ok(graph.edges.every((edge) => edge.provenance !== "observed"));
      assert.ok(repo.coverage.some((item) => item.includes("candidate")));
    },
  );
});

test("JavaScript recognizes HTTP model calls but excludes endpoint strings in comments and metadata checks", async () => {
  const source = `
    // await fetch("https://provider/v1/chat/completions") is only an example.
    export function GET() { return methods.includes("generateContent"); }
    export async function POST(req) {
      const url = \`https://provider/models/\${req.model}:generateContent\`;
      return fetch(url, { method: "POST" });
    }
    export function other(url) { return fetch(url); }
  `;
  const result = await mapGenericSources(
    ["app/api/grade/route.js"],
    async () => source,
  );
  assert.equal(
    result.nodes.filter((node) => node.label.startsWith("Model call")).length,
    1,
  );
  assert.ok(
    !result.nodes.some(
      (node) =>
        node.source?.symbol === "includes" || node.source?.symbol === "GET",
    ),
  );
  assert.ok(
    !result.nodes.some(
      (node) => node.label.startsWith("Model call") && node.source?.line === 8,
    ),
  );
});

test("Python AST recovers declared graph loops and branches without executing source or import hooks", async () => {
  await fixture(
    {
      "sitecustomize.py":
        'raise RuntimeError("repository import hook must never run")',
      "server/graph.py": `
from langgraph.graph import StateGraph, START, END
open("SOURCE_WAS_EXECUTED", "w").write("bad")
def reason(state):
    return client.messages.create(input=state)
def validate(state):
    return state
def build_graph():
    g = StateGraph(dict)
    for name, fn in (("reason", reason), ("validate", validate)):
        g.add_node(name, fn)
    g.add_edge(START, "reason")
    g.add_conditional_edges("reason", lambda s: "validate", {"safe": "validate"})
    g.add_edge("validate", END)
    return g
graph = build_graph().compile()
def run_turn(state):
    return graph.invoke(state)
`,
      "server/app.py": `from .graph import run_turn
@app.post("/api/turn")
def turn(req):
    return run_turn(req)
`,
    },
    async (directory) => {
      const { graph, repo } = await discoverRepo(directory);
      const reason = symbol(graph.nodes, "server/graph.py", "reason")!;
      const validate = symbol(graph.nodes, "server/graph.py", "validate")!;
      const build = symbol(graph.nodes, "server/graph.py", "build_graph")!;
      const turn = symbol(graph.nodes, "server/app.py", "turn")!;
      const run = symbol(graph.nodes, "server/graph.py", "run_turn")!;
      assert.ok(reason && validate && build && turn && run);
      assert.ok(
        graph.edges.some(
          (edge) =>
            edge.source === reason.id &&
            edge.target === validate.id &&
            edge.provenance === "declared",
        ),
      );
      assert.ok(
        graph.edges.some(
          (edge) =>
            edge.source === build.id &&
            edge.target === reason.id &&
            edge.label === "declared graph entry",
        ),
      );
      assert.ok(
        graph.edges.some(
          (edge) => edge.source === turn.id && edge.target === run.id,
        ),
      );
      assert.ok(
        graph.edges.some(
          (edge) => edge.source === run.id && edge.target === build.id,
        ),
      );
      assert.ok(
        graph.nodes.every(
          (node) => node.source?.line === undefined || node.source.line > 0,
        ),
      );
      assert.equal(repo.adapter, "discovery-only");
      await assert.rejects(access(path.join(directory, "SOURCE_WAS_EXECUTED")));
    },
  );
});

test("literal Python graph-like text and syntax failures remain inventory, not invented workflow", async () => {
  await fixture(
    {
      "app.py":
        '"""def fake():\n    g.add_node("agent", fake)\n    client.messages.create()\n"""\nvalue=1\n',
      "broken.py": 'def invalid(:\n  g.add_node("fake", fake)\n',
    },
    async (directory) => {
      const { graph, repo } = await discoverRepo(directory);
      assert.equal(graph.nodes.filter((node) => !node.hidden).length, 1);
      assert.equal(graph.nodes[0].id, "unknown-entry");
      assert.ok(
        repo.limitations.some((item) =>
          item.includes("1 source files had parse errors"),
        ),
      );
      assert.ok(
        graph.nodes.some((node) => node.id === "file:broken.py" && node.hidden),
      );
    },
  );
});

test("mapper IDs survive whitespace changes and declaration headers remove literal credentials", async () => {
  const key = "sk-" + "z".repeat(35);
  const original = `export async function POST(token="${key}") { return client.messages.create({token}); }`;
  const first = await mapGenericSources(
    ["app/api/generate/route.ts"],
    async () => original,
  );
  const shifted = await mapGenericSources(
    ["app/api/generate/route.ts"],
    async () => "\n\n" + original,
  );
  assert.deepEqual(
    first.nodes.map((node) => node.id),
    shifted.nodes.map((node) => node.id),
  );
  assert.deepEqual(
    first.edges.map((edge) => edge.id),
    shifted.edges.map((edge) => edge.id),
  );
  assert.ok(!JSON.stringify(first).includes(key));
  assert.equal(first.nodes[0].source?.line, 1);
  assert.equal(shifted.nodes[0].source?.line, 3);
});

test("function parameters do not become false cross-file call relationships", async () => {
  const files: Record<string, string> = {
    "app/api/generate/route.ts":
      'import { run } from "../../worker"; export function POST(run) { return run(); }',
    "app/worker.ts":
      "export function run() { return client.messages.create({}); }",
  };
  const result = await mapGenericSources(
    Object.keys(files),
    async (file) => files[file],
  );
  const route = symbol(result.nodes, "app/api/generate/route.ts", "POST")!;
  const worker = symbol(result.nodes, "app/worker.ts", "run")!;
  assert.ok(route && worker);
  assert.ok(
    !result.edges.some(
      (edge) => edge.source === route.id && edge.target === worker.id,
    ),
  );
});

test("an unrelated add_node method is not reported as a declared LangGraph workflow", async () => {
  const source = `from custom_library import StateGraph
def actor(state):
    return state
def build_graph():
    g = StateGraph()
    g.add_node("actor", actor)
    g.add_edge("actor", "actor")
`;
  const result = await mapGenericSources(["graph.py"], async () => source);
  assert.ok(
    !result.edges.some(
      (edge) => edge.kind === "data" && edge.provenance === "declared",
    ),
  );
  assert.ok(!result.nodes.some((node) => node.label === "actor"));
});

test("file cap prioritizes backend code over bulk documentation and excludes virtual environments", async () => {
  const files: Record<string, string> = {
    "server/agent.py": "def run(x):\n return client.messages.create(input=x)\n",
    ".venv/site.py": "not source",
    "output/old.py": "not source",
  };
  for (let index = 0; index < 510; index++)
    files[`docs/${String(index).padStart(3, "0")}.md`] = "Documentation";
  await fixture(files, async (directory) => {
    const discovered = await sourceFiles(directory);
    assert.equal(discovered.length, 500);
    assert.ok(discovered.includes("server/agent.py"));
    assert.ok(
      !discovered.some(
        (file) => file.startsWith(".venv/") || file.startsWith("output/"),
      ),
    );
  });
});

test("an unversioned application nested beneath a Git checkout does not inherit the parent's identity", async () => {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const git = promisify(execFile);
  await fixture(
    {
      "README.md": "Parent repository fixture",
      "uploaded-app/src/agent.ts":
        "export async function answer(input) { return client.responses.create({ input }); }",
    },
    async (directory) => {
      await git("git", ["-C", directory, "init", "--quiet"]);
      await git("git", [
        "-C",
        directory,
        "remote",
        "add",
        "origin",
        "https://github.com/fixture/inherited-parent.git",
      ]);
      await git("git", ["-C", directory, "add", "README.md"]);
      await git("git", [
        "-C",
        directory,
        "-c",
        "user.name=Fixture",
        "-c",
        "user.email=fixture@example.invalid",
        "-c",
        "commit.gpgsign=false",
        "commit",
        "--quiet",
        "-m",
        "Synthetic fixture",
      ]);
      const parent = await discoverRepo(directory);
      const nested = await discoverRepo(path.join(directory, "uploaded-app"));
      assert.equal(parent.repo.name, "inherited-parent");
      assert.match(parent.repo.revision, /^[a-f0-9]{40}$/);
      assert.equal(nested.repo.name, "uploaded-app");
      assert.equal(nested.repo.revision, "unversioned");
      assert.equal(nested.repo.adapter, "discovery-only");
      assert.deepEqual(
        nested.repo.sources.map((source) => source.path),
        ["src/agent.ts"],
      );
    },
  );
});
