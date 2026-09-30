import { state, id, now, save } from "./store.js";
import { defaultGraph } from "./graph.js";
import { discoverRepo } from "./importer.js";
import { importUploadedFolder } from "./uploads.js";
import { tenantValue } from "./tenant.js";
import type { Project } from "../shared/types.js";

export const exampleInput = "Explain how this example reviews a support request.";
export const exampleOutput = "Cached workflow example: the coordinator passes a support request to the response agent, the quality check validates it, and the final response is released. This recorded fixture demonstrates the scheduler and trace; no model or imported repository code was executed.";
export const exampleConfig = { credentialId: "cached-example", model: "cached-example" };
const files = [
  { path: "README.md", content: "# Support review example\nA small LangGraph source repository declares intake, draft and quality-check steps. Citadel inspects the Python AST and source references without executing or installing this repository. The separate cached workflow demonstrates Citadel's scheduler.\n" },
  { path: "requirements.txt", content: "langgraph\nfastapi\n" },
  { path: "server/__init__.py", content: "\"\"\"Read-only source example.\"\"\"\n" },
  { path: "server/graph.py", content: `from langgraph.graph import StateGraph, START, END

def intake(state):
    return {**state, "request": state.get("request", "").strip()}

def draft_response(state):
    return {**state, "draft": "Review request: " + state["request"]}

def quality_check(state):
    return {**state, "approved": bool(state.get("draft"))}

def build_graph():
    g = StateGraph(dict)
    g.add_node("intake", intake)
    g.add_node("draft_response", draft_response)
    g.add_node("quality_check", quality_check)
    g.add_edge(START, "intake")
    g.add_edge("intake", "draft_response")
    g.add_edge("draft_response", "quality_check")
    g.add_edge("quality_check", END)
    return g

graph = build_graph().compile()

def run_turn(state):
    return graph.invoke(state)
` },
  { path: "server/app.py", content: `from fastapi import FastAPI
from .graph import run_turn

app = FastAPI()

@app.post("/api/review")
def review(request: dict):
    return run_turn(request)
` },
];
export async function examples() {
  const slot = tenantValue("examples-lock", () => ({ pending: undefined as Promise<unknown> | undefined }));
  if (slot.pending) return slot.pending;
  slot.pending = (async () => {
    let project = state.projects.find(p => p.example?.kind === "source");
    let runnableProject = state.projects.find(p => p.example?.kind === "cached-workflow");
    if (state.projects.length + Number(!project) + Number(!runnableProject) > 40) throw new Error("Workspace project limit reached.");
    if (!project) {
      const upload = await importUploadedFolder({ name: "Support review source", files });
      const found = await discoverRepo(upload.rootPath);
      found.repo.sourceKind = "upload"; found.repo.sourceBundle = upload.sourceBundle;
      project = { id: id("project"), name: "Example source · read only", brief: "Inspect the bundled repository, its source map and review plan. Repository code does not execute.", ...found,
        example: { kind: "source" }, createdAt: now(), updatedAt: now() };
      state.projects.unshift(project);
    }
    if (!runnableProject) {
      runnableProject = { id: id("project"), name: "Cached workflow · scheduler example", brief: "Run the separate manifest with a recorded response. No API key or model call is required.",
        graph: defaultGraph("Cached workflow example"), example: { kind: "cached-workflow" }, createdAt: now(), updatedAt: now() };
      state.projects.unshift(runnableProject);
    }
    save(); return { project, runnableProject, config: exampleConfig, input: exampleInput };
  })();
  try { return await slot.pending; } finally { slot.pending = undefined; }
}
