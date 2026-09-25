import { test } from "node:test";
import assert from "node:assert/strict";
import { defaultGraph, validateGraph } from "../server/graph.js";
import { executeGraph, BlockedError } from "../server/runtime.js";
import type { RunEvent, Graph } from "../shared/types.js";
const signal = () => new AbortController().signal;
function runner(outputs: string[]) {
  const events: Omit<RunEvent, "id" | "time">[] = [];
  const calls: { system: string; input: string }[] = [];
  return {
    events,
    calls,
    executor: {
      signal: signal(),
      emit: (e: Omit<RunEvent, "id" | "time">) => events.push(e),
      generate: async (system: string, input: string) => {
        calls.push({ system, input });
        return {
          text: outputs.shift() || "",
          usage: { inputTokens: 1, outputTokens: 1 },
        };
      },
    },
  };
}
test("real mapping edits change runtime input and snapshots stay immutable", async () => {
  const graph = defaultGraph();
  const previous = structuredClone(graph);
  graph.nodes.splice(2, 0, {
    id: "second",
    role: "agent",
    label: "Second agent",
    prompt: "Return only input",
  });
  graph.edges = graph.edges.filter((e) => e.id !== "e2");
  graph.edges.push(
    {
      id: "to2",
      source: "writer",
      target: "second",
      kind: "data",
      label: "map original",
      inputMapping: "original",
    },
    {
      id: "from2",
      source: "second",
      target: "review",
      kind: "data",
      label: "check",
    },
  );
  const r = runner(["rewritten", "original"]);
  assert.equal(await executeGraph(graph, "original", r.executor), "original");
  assert.equal(r.calls[1].input, "original");
  assert.equal(previous.nodes.length, 6);
  assert.equal(previous.edges.find((e) => e.id === "e2")?.source, "writer");
});
test("bounded reflection delivers feedback and releases only corrected output", async () => {
  const g = defaultGraph();
  g.nodes.find((n) => n.id === "review")!.rules = { required: ["approved"] };
  const r = runner(["draft", "approved draft"]);
  assert.equal(await executeGraph(g, "write", r.executor), "approved draft");
  assert.equal(r.calls.length, 2);
  assert.match(r.calls[1].input, /Revision feedback/);
  assert.equal(r.events.filter((e) => e.type === "node.blocked").length, 1);
  assert.equal(
    r.events.filter((e) => e.nodeId === "output" && e.type === "node.completed")
      .length,
    1,
  );
});
test("exhausted reflection withholds final response", async () => {
  const g = defaultGraph();
  g.nodes.find((n) => n.id === "review")!.rules = {
    required: ["never-present"],
  };
  const r = runner(["bad", "still bad"]);
  await assert.rejects(executeGraph(g, "write", r.executor), BlockedError);
  assert.equal(r.calls.length, 2);
  assert.ok(!r.events.some((e) => e.nodeId === "output"));
});
test("hidden policy cannot bypass execution and malformed graph stops before calls", async () => {
  const g = defaultGraph();
  g.nodes.find((n) => n.id === "review")!.hidden = true;
  const r = runner(["bad"]);
  assert.equal(validateGraph(g).ok, false);
  await assert.rejects(
    executeGraph(g, "x", r.executor),
    /Only supporting resource/,
  );
  assert.equal(r.calls.length, 0);
});
test("data cycles fail but feedback edges remain bounded", () => {
  const g = defaultGraph();
  g.edges.push({
    id: "loop",
    source: "review",
    target: "writer",
    kind: "data",
    label: "bad cycle",
  });
  assert.ok(validateGraph(g).issues.some((i) => i.code === "cycle"));
});
test("schema mismatch fails without releasing invalid output", async () => {
  const g = defaultGraph();
  g.nodes.find((n) => n.id === "writer")!.schema = {
    type: "object",
    required: ["answer"],
    properties: { answer: { type: "string" } },
  };
  const r = runner(['{"wrong":123}']);
  await assert.rejects(executeGraph(g, "x", r.executor), /Schema mismatch/);
  assert.ok(!r.events.some((e) => e.nodeId === "output"));
});
test("cancel preserves prior evidence and blocks release", async () => {
  const controller = new AbortController();
  const r = runner(["answer"]);
  r.executor.signal = controller.signal;
  r.executor.generate = async () => {
    controller.abort(new Error("cancelled"));
    return { text: "answer", usage: { inputTokens: 1, outputTokens: 1 } };
  };
  await assert.rejects(
    executeGraph(defaultGraph(), "x", r.executor),
    /cancelled/,
  );
  assert.ok(
    r.events.some((e) => e.nodeId === "entry" && e.type === "node.completed"),
  );
  assert.ok(!r.events.some((e) => e.nodeId === "output"));
});
test("built-in code-free tools execute without a model", async () => {
  const g = defaultGraph();
  g.nodes.find((n) => n.id === "writer")!.role = "tool";
  g.nodes.find((n) => n.id === "writer")!.tool = "uppercase";
  g.edges = g.edges.filter((e) => e.kind !== "feedback");
  const r = runner([]);
  assert.equal(await executeGraph(g, "hello", r.executor), "HELLO");
  assert.equal(r.calls.length, 0);
});
