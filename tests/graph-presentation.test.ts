import test from "node:test";
import assert from "node:assert/strict";
import type { Graph, GraphEdge, GraphNode } from "../shared/types.js";
import {
  layoutGraph,
  recordedGraph,
  selectPresentationEdges,
} from "../web/graph-presentation.js";

const node = (
  id: string,
  role: GraphNode["role"] = "agent",
  extra: Partial<GraphNode> = {},
): GraphNode => ({ id, label: id, role, ...extra });
const edge = (
  id: string,
  source: string,
  target: string,
  extra: Partial<GraphEdge> = {},
): GraphEdge => ({
  id,
  source,
  target,
  label: id,
  kind: "data",
  provenance: "inferred",
  ...extra,
});
const graph = (nodes: GraphNode[], edges: GraphEdge[]): Graph => ({
  id: "fixture",
  revision: 1,
  name: "Fixture",
  description: "",
  nodes,
  edges,
  limits: {
    maxCalls: 1,
    maxRevisions: 0,
    timeoutMs: 1000,
    maxOutputTokens: 128,
  },
});
function noOverlap(
  positions: Record<string, { x: number; y: number }>,
  width = 244,
  height = 160,
) {
  const entries = Object.entries(positions);
  for (let i = 0; i < entries.length; i++)
    for (let j = i + 1; j < entries.length; j++) {
      const [a, p] = entries[i],
        [b, q] = entries[j];
      assert.ok(
        p.x + width <= q.x ||
          q.x + width <= p.x ||
          p.y + height <= q.y ||
          q.y + height <= p.y,
        `${a} overlaps ${b}`,
      );
    }
}
function componentMembership(ids: string[], edges: GraphEdge[]) {
  const groups: string[][] = [],
    unseen = new Set(ids);
  while (unseen.size) {
    const queue = [[...unseen][0]],
      members: string[] = [];
    for (let i = 0; i < queue.length; i++) {
      const current = queue[i];
      if (!unseen.delete(current)) continue;
      members.push(current);
      for (const e of edges) {
        if (e.source === current && unseen.has(e.target)) queue.push(e.target);
        if (e.target === current && unseen.has(e.source)) queue.push(e.source);
      }
    }
    groups.push(members.sort());
  }
  return groups.sort((a, b) => a[0].localeCompare(b[0]));
}
function demoTopology() {
  const agents = [
    "Align",
    "Author",
    "Coach",
    "Deck",
    "Pitch",
    "Plan",
    "QA",
    "Rehearsal",
    "Translation",
    "Understanding",
    "Voice",
  ];
  const nodes = [
    node("Gateway", "orchestrator"),
    node("Router", "orchestrator"),
    node("Runtime", "orchestrator"),
    ...agents.map((id) => node(id)),
    node("Providers", "tool", { label: "LLM Providers & Client Wrappers" }),
    node("Validation", "validator"),
  ];
  const edges: GraphEdge[] = [];
  const add = (source: string, target: string, declared = false) =>
    edges.push(
      edge(`edge-${edges.length}`, source, target, {
        provenance: declared ? "declared" : "inferred",
        label: declared
          ? "declared route"
          : target === "Providers"
            ? "calls claude.structured"
            : `calls ${target}`,
      }),
    );
  for (const agent of agents.filter((name) => name !== "Voice"))
    add(agent, "Providers");
  add("Author", "Validation");
  add("Author", "Understanding");
  add("Coach", "Validation");
  add("Rehearsal", "QA");
  add("Voice", "Translation");
  for (const target of [
    "Validation",
    "Rehearsal",
    "QA",
    "Router",
    "Runtime",
    "Pitch",
    "Translation",
  ])
    add("Gateway", target);
  for (const target of [
    "Align",
    "Understanding",
    "Coach",
    "Plan",
    "Author",
    "Deck",
    "QA",
    "Voice",
    "Rehearsal",
    "Validation",
  ])
    add("Router", target);
  add("Validation", "Providers");
  add("Runtime", "Validation");
  add("Runtime", "Providers");
  add("Validation", "Runtime");
  add("Runtime", "Pitch");
  add("Runtime", "Validation", true);
  add("Validation", "Runtime", true);
  return graph(nodes, edges);
}

test("source overview reduces the Demo Studio topology without hiding workflow nodes or changing evidence", () => {
  const original = demoTopology(),
    before = structuredClone(original),
    result = layoutGraph(original);
  assert.equal(Object.keys(result.positions).length, 16);
  assert.equal(result.totalEdgeCount, 39);
  assert.equal(result.displayedEdges.length, 37);
  assert.equal(result.primaryEdgeIds.size, 16);
  assert.equal(result.secondaryEdgeCount, 21);
  assert.deepEqual(original, before);
  assert.ok(
    result.displayedEdges.every((representative) =>
      original.edges.includes(representative),
    ),
    "Every displayed relationship is an original edge, not a synthesized chain.",
  );
  const primary = result.displayedEdges.filter((e) =>
    result.primaryEdgeIds.has(e.id),
  );
  assert.deepEqual(
    componentMembership(
      original.nodes.map((n) => n.id),
      primary,
    ),
    componentMembership(
      original.nodes.map((n) => n.id),
      original.edges,
    ),
  );
  assert.ok(primary.filter((e) => e.provenance === "declared").length === 2);
  assert.equal(
    primary.filter((e) => e.target === "Providers").length,
    1,
    "Shared provider fan-in is secondary except the connection needed to retain its node.",
  );
  assert.ok(
    Math.max(...Object.values(result.positions).map((p) => p.y)) + 160 <= 835,
  );
  assert.ok(
    Math.max(...Object.values(result.positions).map((p) => p.x)) + 244 <= 1800,
  );
  noOverlap(result.positions);
});

test("parallel relationships retain all original IDs and choose observed over declared or inferred representatives", () => {
  const original = graph(
    [node("a"), node("b")],
    [
      edge("inferred", "a", "b"),
      edge("declared", "a", "b", { provenance: "declared" }),
      edge("observed", "a", "b", { provenance: "observed" }),
    ],
  );
  const result = layoutGraph(original);
  assert.deepEqual(
    result.displayedEdges.map((e) => e.id),
    ["observed"],
  );
  assert.deepEqual(result.relationshipGroups.observed, [
    "observed",
    "declared",
    "inferred",
  ]);
  assert.equal(result.totalEdgeCount, 3);
  assert.equal(result.secondaryEdgeCount, 0);
  assert.ok(result.primaryEdgeIds.has("observed"));
});

test("observed span hierarchy takes precedence without inventing an observed static feedback cycle", () => {
  const original = graph(
    [node("root", "orchestrator"), node("a"), node("b"), node("c")],
    [
      edge("source-root-a", "root", "a", { provenance: "declared" }),
      edge("source-a-b", "a", "b", { provenance: "declared" }),
      edge("source-b-c", "b", "c", { provenance: "declared" }),
      edge("observed-root-b", "root", "b", { provenance: "observed" }),
      edge("observed-b-a", "b", "a", { provenance: "observed" }),
      edge("observed-a-c", "a", "c", { provenance: "observed" }),
    ],
  );
  const result = layoutGraph(original);
  assert.deepEqual(
    [...result.primaryEdgeIds].sort(),
    ["observed-root-b", "observed-b-a", "observed-a-c"].sort(),
  );
  assert.ok(
    result.positions.root.x < result.positions.b.x &&
      result.positions.b.x < result.positions.a.x &&
      result.positions.a.x < result.positions.c.x,
  );
  assert.equal(result.components.filter((c) => c.cyclic).length, 0);
});

test("cycles stay explicit while descendants remain to the right of their entire component", () => {
  const original = graph(
    [
      node("entry", "orchestrator"),
      node("a"),
      node("b"),
      node("c"),
      node("end", "output"),
    ],
    [
      edge("entry-a", "entry", "a", { provenance: "declared" }),
      edge("a-b", "a", "b", { provenance: "declared" }),
      edge("b-c", "b", "c", { provenance: "declared" }),
      edge("c-a", "c", "a", { provenance: "declared", kind: "feedback" }),
      edge("c-end", "c", "end", { provenance: "declared" }),
    ],
  );
  const result = layoutGraph(original),
    loop = result.components.find((c) => c.cyclic)!;
  assert.deepEqual([...loop.nodeIds].sort(), ["a", "b", "c"]);
  assert.ok(
    loop.nodeIds.every(
      (id) =>
        result.positions[id].x > result.positions.entry.x &&
        result.positions[id].x < result.positions.end.x,
    ),
  );
  assert.ok(result.feedbackEdgeIds.has("c-a"));
  assert.ok(result.primaryEdgeIds.has("c-a"));
  noOverlap(result.positions);
});

test("parallel branches use at most four peer rows inside one logical band without fictitious connections", () => {
  const children = Array.from({ length: 14 }, (_, index) =>
    node(`branch-${index}`),
  );
  const original = graph(
    [node("root", "orchestrator"), ...children],
    children.map((n) =>
      edge(`root-${n.id}`, "root", n.id, { provenance: "declared" }),
    ),
  );
  const result = layoutGraph(original),
    ranks = new Set(children.map((n) => result.rankByNode[n.id]));
  assert.equal(ranks.size, 1);
  assert.equal(new Set(children.map((n) => result.positions[n.id].y)).size, 4);
  assert.equal(new Set(children.map((n) => result.positions[n.id].x)).size, 4);
  assert.ok(
    result.columns.find((column) => column.nodeIds.length === 14)?.parallel,
  );
  assert.ok(result.displayedEdges.every((e) => e.source === "root"));
  noOverlap(result.positions);
});

test("long directed chains never wrap back to an earlier horizontal column", () => {
  const nodes = Array.from({ length: 30 }, (_, index) => node(`node-${index}`));
  const original = graph(
    nodes,
    nodes.slice(1).map((n, index) =>
      edge(`flow-${index}`, nodes[index].id, n.id, {
        provenance: "declared",
      }),
    ),
  );
  const result = layoutGraph(original);
  assert.ok(
    original.edges.every(
      (e) => result.positions[e.source].x < result.positions[e.target].x,
    ),
  );
  assert.equal(result.columns.length, 30);
  noOverlap(result.positions);
});

test("disconnected workflows remain separate, hidden resources are optional, and explicit positions are opt-in", () => {
  const original = graph(
    [
      node("a", "agent", { position: { x: -13, y: 27 } }),
      node("b"),
      node("separate"),
      node("hidden", "resource", { hidden: true }),
    ],
    [
      edge("a-b", "a", "b"),
      edge("dependency", "a", "hidden", {
        kind: "dependency",
        provenance: "declared",
      }),
    ],
  );
  const automatic = layoutGraph(original);
  assert.deepEqual(Object.keys(automatic.positions).sort(), [
    "a",
    "b",
    "separate",
  ]);
  assert.equal(automatic.displayedEdges.length, 1);
  assert.ok(
    automatic.displayedEdges.every(
      (e) => e.source !== "separate" && e.target !== "separate",
    ),
  );
  const preserved = layoutGraph(original, {
    preservePositions: true,
    includeHidden: true,
  });
  assert.deepEqual(preserved.positions.a, { x: -13, y: 27 });
  assert.ok(preserved.positions.hidden);
  assert.equal(preserved.displayedEdges.length, 2);
  noOverlap(automatic.positions);
});

test("presentation is stable across input permutations and handles empty/self-loop graphs", () => {
  const original = demoTopology(),
    before = layoutGraph(original);
  const after = layoutGraph({
    ...original,
    nodes: [...original.nodes].reverse(),
    edges: [...original.edges].reverse(),
  });
  assert.deepEqual(after, before);
  assert.deepEqual(layoutGraph(graph([], [])).positions, {});
  const self = layoutGraph(
    graph(
      [node("self")],
      [edge("loop", "self", "self", { provenance: "declared" })],
    ),
  );
  assert.equal(self.components[0].cyclic, true);
  assert.ok(self.primaryEdgeIds.has("loop"));
  assert.ok(self.feedbackEdgeIds.has("loop"));
});

test("custom card dimensions and gaps keep automatic nodes separated", () => {
  const result = layoutGraph(demoTopology(), {
    nodeWidth: 300,
    nodeHeight: 210,
    horizontalGap: 80,
    verticalGap: 50,
    parallelRows: 3,
  });
  noOverlap(result.positions, 300, 210);
  assert.ok(
    Object.values(result.positions).every(
      (point) => Number.isFinite(point.x) && Number.isFinite(point.y),
    ),
  );
});

test("All connections returns every visible original edge, including parallel relationships", () => {
  const original = graph(
    [node("a"), node("b"), node("hidden", "resource", { hidden: true })],
    [
      edge("declared", "a", "b", { provenance: "declared" }),
      edge("parallel-inference", "a", "b"),
      edge("feedback", "b", "a", { kind: "feedback" }),
      edge("resource", "a", "hidden", { kind: "dependency" }),
      edge("dangling", "a", "missing"),
    ],
  );
  const presentation = layoutGraph(original);
  assert.equal(presentation.displayedEdges.length, 2);
  for (const imported of [true, false]) {
    const selected = selectPresentationEdges(
      original,
      presentation,
      "all",
      imported,
    );
    assert.deepEqual(
      selected.map((e) => e.id),
      ["declared", "parallel-inference", "feedback"],
    );
    assert.ok(selected.every((e) => original.edges.includes(e)));
  }
});

test("owned executable manifests and recorded executions never lose connections in Overview", () => {
  for (const provenance of ["declared", "observed"] as const) {
    const original = graph(
      [node("a"), node("b"), node("c")],
      [
        edge("a-b", "a", "b", { provenance }),
        edge("second-a-b", "a", "b", { provenance }),
        edge("b-c", "b", "c", { provenance }),
        edge("a-c", "a", "c", { provenance }),
        edge("retry-1", "c", "a", { provenance, kind: "feedback" }),
        edge("retry-2", "c", "b", { provenance, kind: "feedback" }),
      ],
    );
    const presentation = layoutGraph(original);
    assert.ok(presentation.primaryEdgeIds.size < original.edges.length);
    const selected = selectPresentationEdges(
      original,
      presentation,
      "overview",
      false,
    );
    assert.deepEqual(selected, original.edges);
  }
});

test("only an imported source Overview reduces connections, and every explicit feedback edge survives", () => {
  const original = graph(
    [node("a"), node("b"), node("c")],
    [
      edge("a-b", "a", "b", { provenance: "declared" }),
      edge("b-c", "b", "c", { provenance: "declared" }),
      edge("secondary-a-c", "a", "c"),
      edge("feedback-a-b", "a", "b", { kind: "feedback" }),
      edge("feedback-c-a", "c", "a", { kind: "feedback" }),
      edge("feedback-c-b", "c", "b", { kind: "feedback" }),
    ],
  );
  const before = structuredClone(original),
    presentation = layoutGraph(original);
  const selected = selectPresentationEdges(
    original,
    presentation,
    "overview",
    true,
  );
  assert.ok(selected.length < original.edges.length);
  for (const e of original.edges.filter((e) => e.kind === "feedback"))
    assert.ok(selected.includes(e), e.id);
  assert.ok(
    selected.every(
      (e) => e.kind === "feedback" || presentation.primaryEdgeIds.has(e.id),
    ),
  );
  assert.deepEqual(original, before);
  assert.deepEqual(
    selectPresentationEdges(
      graph([], []),
      { primaryEdgeIds: new Set() },
      "overview",
      true,
    ),
    [],
  );
});

test("external recorded path keeps only event-backed nodes and observed relationships", () => {
  const original = graph(
    [
      node("entry", "orchestrator"),
      node("agent"),
      node("support", "resource", { hidden: true }),
      node("not-run"),
      node("endpoint-only"),
    ],
    [
      edge("observed-first", "entry", "agent", { provenance: "observed" }),
      edge("observed-support", "agent", "support", { provenance: "observed" }),
      edge("source-shortcut", "entry", "support", { provenance: "declared" }),
      edge("inferred-return", "support", "agent", { provenance: "inferred" }),
      edge("source-branch", "agent", "not-run", { provenance: "declared" }),
      edge("observed-without-node-events", "agent", "endpoint-only", {
        provenance: "observed",
      }),
    ],
  );
  const before = structuredClone(original);
  const result = recordedGraph(original, [
    { nodeId: "entry" },
    { nodeId: "agent" },
    { nodeId: "agent" },
    { nodeId: "support" },
    { nodeId: "unknown" },
    {},
  ]);
  assert.deepEqual(
    result.nodes.map((n) => n.id),
    ["entry", "agent", "support"],
  );
  assert.ok(result.nodes.every((n) => n.hidden === false));
  assert.deepEqual(
    result.edges.map((e) => e.id),
    ["observed-first", "observed-support"],
  );
  assert.deepEqual(original, before);
  assert.equal(result.id, original.id);
  assert.equal(result.revision, original.revision);
  const visible = selectPresentationEdges(
    result,
    layoutGraph(result),
    "overview",
    false,
  );
  assert.deepEqual(visible, result.edges);
});

test("recorded path preserves every observed parallel and self-loop edge with its real ID", () => {
  const original = graph(
    [node("a"), node("b")],
    [
      edge("first-call", "a", "b", { provenance: "observed" }),
      edge("second-call", "a", "b", { provenance: "observed" }),
      edge("self-call", "a", "a", { provenance: "observed" }),
      edge("return", "b", "a", { provenance: "observed", kind: "feedback" }),
      edge("unobserved-feedback", "b", "a", {
        provenance: "declared",
        kind: "feedback",
      }),
    ],
  );
  const result = recordedGraph(original, [{ nodeId: "a" }, { nodeId: "b" }]);
  assert.deepEqual(
    result.edges.map((e) => e.id),
    ["first-call", "second-call", "self-call", "return"],
  );
  assert.deepEqual(
    selectPresentationEdges(result, layoutGraph(result), "all", false),
    result.edges,
  );
});

test("empty, node-less or unknown execution evidence yields an empty recorded graph", () => {
  const original = graph(
    [node("a"), node("b")],
    [edge("observed", "a", "b", { provenance: "observed" })],
  );
  for (const events of [[], [{}], [{ nodeId: "unknown" }]]) {
    const result = recordedGraph(original, events);
    assert.deepEqual(result.nodes, []);
    assert.deepEqual(result.edges, []);
  }
  const isolated = recordedGraph(original, [{ nodeId: "a" }]);
  assert.deepEqual(
    isolated.nodes.map((n) => n.id),
    ["a"],
  );
  assert.deepEqual(isolated.edges, []);
});

test("recorded presentation metadata is an independent copy of immutable source evidence", () => {
  const original = graph(
    [
      node("executed", "agent", {
        sourceRefs: [{ path: "src/run.ts", line: 12 }],
        position: { x: 10, y: 20 },
      }),
    ],
    [edge("loop", "executed", "executed", { provenance: "observed" })],
  );
  const before = structuredClone(original);
  const result = recordedGraph(original, [{ nodeId: "executed" }]);
  result.nodes[0].sourceRefs![0].path = "presentation-only.ts";
  result.nodes[0].position!.x = 99;
  result.edges[0].label = "presentation-only";
  result.limits.maxCalls = 999;
  assert.deepEqual(original, before);
});
