import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Graph, RepoInfo } from "../shared/types.js";

const directory = await mkdtemp(
  path.join(tmpdir(), "workbench-semantic-map-test-"),
);
process.env.WORKBENCH_DATA_DIR = directory;
process.env.WORKBENCH_SECRETS_FILE = path.join(directory, "absent-secrets");
process.env.WORKBENCH_SPEND_LIMIT_USD = "0";
const { applySemanticProposal, scrubSource, mappingEvidence } =
  await import("../server/semantic-map.js");
after(() => rm(directory, { recursive: true, force: true }));

function fixture() {
  const graph: Graph = {
    id: "fixture",
    revision: 1,
    name: "Fixture",
    description: "Static candidate evidence",
    nodes: [
      {
        id: "candidate_draft",
        role: "agent",
        label: "draft",
        source: { path: "workflow.py", line: 21, symbol: "draft" },
      },
      {
        id: "candidate_check",
        role: "validator",
        label: "check",
        source: { path: "workflow.py", line: 24, symbol: "check" },
      },
      {
        id: "file:workflow.py",
        role: "resource",
        label: "workflow.py",
        hidden: true,
        source: { path: "workflow.py" },
      },
      {
        id: "file:auth.py",
        role: "resource",
        label: "auth.py",
        hidden: true,
        source: { path: "auth.py" },
      },
    ],
    edges: [
      {
        id: "flow",
        source: "candidate_draft",
        target: "candidate_check",
        label: "check candidate",
        kind: "data",
        provenance: "declared",
      },
      {
        id: "implementation",
        source: "candidate_draft",
        target: "file:workflow.py",
        label: "implemented_by",
        kind: "dependency",
        provenance: "declared",
      },
    ],
    limits: {
      maxCalls: 3,
      maxRevisions: 1,
      maxOutputTokens: 1024,
      timeoutMs: 30000,
    },
  };
  const repo: RepoInfo = {
    name: "fixture",
    path: directory,
    revision: "fixture-revision",
    adapter: "discovery-only",
    coverage: ["Deterministic candidates"],
    limitations: ["No execution adapter"],
    sources: [
      { path: "workflow.py", category: "Agent workflow" },
      { path: "auth.py", category: "Authentication" },
    ],
  };
  const evidence = {
    candidates: graph.nodes.filter((node) => !node.hidden),
    sources: [
      {
        path: "workflow.py",
        totalLines: 100,
        startLine: 20,
        text: "# Source excerpt\ndef draft():\n    return model()\n\ndef check():\n    return True\n",
      },
    ],
    truncated: true,
  };
  const proposal = {
    nodes: [
      {
        key: "drafting",
        label: "Draft response",
        role: "agent",
        description: "Source-backed interpretation",
        path: "workflow.py",
        line: 21,
        symbol: "draft",
        candidateIds: ["candidate_draft"],
      },
    ],
    edges: [],
    notes: ["Checks require further interpretation."],
  };
  return { graph, repo, evidence, proposal };
}

test("semantic grouping retains unassigned candidates, hidden resources and their evidence edges", () => {
  const { graph, repo, evidence, proposal } = fixture();
  const before = JSON.stringify(graph);
  const result = applySemanticProposal(
    graph,
    repo,
    evidence,
    proposal,
    "fixture-model",
  );
  const interpreted = result.graph.nodes.find(
    (node) => node.label === "Draft response",
  )!;
  const unresolved = result.graph.nodes.find(
    (node) => node.id === "candidate_check",
  )!;
  assert.equal(unresolved.role, "opaque");
  assert.match(unresolved.label, /Unresolved/);
  assert.deepEqual(
    result.graph.nodes.filter((node) => node.hidden),
    graph.nodes.filter((node) => node.hidden),
  );
  assert.ok(
    result.graph.edges.some(
      (edge) =>
        edge.source === interpreted.id &&
        edge.target === unresolved.id &&
        edge.provenance === "declared",
    ),
  );
  assert.ok(
    result.graph.edges.some(
      (edge) =>
        edge.source === interpreted.id &&
        edge.target === "file:workflow.py" &&
        edge.kind === "dependency",
    ),
  );
  assert.deepEqual(interpreted.sourceRefs, [graph.nodes[0].source]);
  assert.equal(result.repo.mapping?.mappedCandidates, 1);
  assert.equal(result.repo.mapping?.unresolvedCandidates, 1);
  assert.equal(result.repo.mapping?.truncated, true);
  assert.equal(result.repo.adapter, "discovery-only");
  assert.equal(
    JSON.stringify(graph),
    before,
    "Interpreting a proposal must not mutate original source evidence.",
  );
});

test("semantic proposals reject forged paths and lines outside the supplied excerpt", () => {
  for (const overrides of [
    { path: "../../private.py" },
    { path: "auth.py" },
    { line: 1 },
    { line: 101 },
    { line: 50 },
  ]) {
    const { graph, repo, evidence, proposal } = fixture();
    Object.assign(proposal.nodes[0], overrides);
    assert.throws(
      () => applySemanticProposal(graph, repo, evidence, proposal, "fixture"),
      /outside its supplied evidence/,
    );
  }
});

test("semantic proposals reject invented, multiply assigned and repeated candidate IDs", () => {
  for (const candidateIds of [
    ["invented"],
    ["candidate_draft", "candidate_draft"],
  ]) {
    const { graph, repo, evidence, proposal } = fixture();
    proposal.nodes[0].candidateIds = candidateIds;
    assert.throws(
      () => applySemanticProposal(graph, repo, evidence, proposal, "fixture"),
      /candidate|duplicate/i,
    );
  }
  const { graph, repo, evidence, proposal } = fixture();
  proposal.nodes.push({ ...proposal.nodes[0], key: "second" });
  assert.throws(
    () => applySemanticProposal(graph, repo, evidence, proposal, "fixture"),
    /candidate|duplicate/i,
  );
});

test("semantic proposals reject duplicate node IDs and dangling or self relationships", () => {
  const { graph, repo, evidence, proposal } = fixture();
  assert.throws(
    () =>
      applySemanticProposal(
        graph,
        repo,
        evidence,
        {
          ...proposal,
          nodes: [
            ...proposal.nodes,
            { ...proposal.nodes[0], candidateIds: ["candidate_check"] },
          ],
        },
        "fixture",
      ),
    /duplicate node IDs/,
  );
  for (const edge of [
    { source: "drafting", target: "missing", label: "invented" },
    { source: "drafting", target: "drafting", label: "self" },
  ])
    assert.throws(
      () =>
        applySemanticProposal(
          graph,
          repo,
          evidence,
          { ...proposal, edges: [edge] },
          "fixture",
        ),
      /invalid relationship/,
    );
});

test("semantic source scrubber removes common credential literals while preserving structure", () => {
  const synthetic = "synthetic-opaque-secret-12345";
  for (const source of [
    `api_key = "${synthetic}"`,
    `const config = {"api_key": "${synthetic}", safe: true};`,
    `config = {'access_token': '${synthetic}', 'safe': True}`,
    `password: '${synthetic}'`,
    `Authorization = "Bearer ${synthetic}"`,
  ]) {
    const cleaned = scrubSource(source);
    assert.ok(
      !cleaned.includes(synthetic),
      "A literal credential must not be sent as mapping evidence.",
    );
    assert.match(cleaned, /REDACTED/);
  }
});

test("mapping evidence scrubs whole-file multiline secrets before selecting numbered windows", async () => {
  const { graph, repo } = fixture();
  const values = [
    "opaque-api-value-8675309",
    "opaque-password-value-24680",
    "PRIVATE_MATERIAL_13579",
    "opaque-token-line-97531",
  ];
  const source = [
    "const config = {",
    " api_key:",
    ` \"${values[0]}\",`,
    ' "password":',
    ` \"${values[1]}\"`,
    "};",
    "const private_key = `-----BEGIN PRIVATE KEY-----",
    values[2],
    "-----END PRIVATE KEY-----`;",
    "const access_token = `",
    values[3],
    "`;",
    "export async function workflow() { return config; }",
  ].join("\n");
  const file = "multiline-workflow.ts";
  await writeFile(path.join(directory, file), source);
  repo.path = await realpath(directory);
  repo.sources = [{ path: file, category: "Agent workflow" }];
  graph.nodes = [
    {
      id: "workflow",
      label: "Workflow",
      role: "orchestrator",
      source: { path: file, line: 13, symbol: "workflow" },
    },
  ];
  graph.edges = [];
  const evidence = await mappingEvidence(graph, repo);
  assert.equal(evidence.sources.length, 1);
  const excerpt = evidence.sources[0];
  for (const value of values)
    assert.ok(
      !excerpt.text.includes(value),
      "Model evidence must not include multiline credential material.",
    );
  assert.equal(excerpt.totalLines, 13);
  assert.match(excerpt.text, /L13: export async function workflow/);
  assert.equal(
    scrubSource(source).split("\n").length,
    source.split("\n").length,
  );
  assert.match(excerpt.text, /REDACTED/);
});

test("Python triple-quoted credential literals are removed with source line positions preserved", () => {
  for (const delimiter of ['\"\"\"', "'''"]) {
    const value = "opaque-python-token-material-86420";
    const source = `api_key = ${delimiter}\n${value}\n${delimiter}\ndef run():\n    return api_key\n`;
    const result = scrubSource(source);
    assert.ok(!result.includes(value));
    assert.equal(result.split("\n").length, source.split("\n").length);
    assert.equal(result.split("\n")[3], "def run():");
  }
});

test("multiple unassigned candidates collapse into one coverage node without losing source or declared topology", () => {
  const { graph, repo, evidence, proposal } = fixture();
  const extras: Graph["nodes"] = [
    {
      id: "candidate_ship",
      role: "tool",
      label: "ship",
      source: { path: "workflow.py", line: 60, symbol: "ship" },
    },
    {
      id: "candidate_audit",
      role: "validator",
      label: "audit",
      source: { path: "audit.py", line: 8, symbol: "audit" },
    },
  ];
  graph.nodes.push(...extras);
  evidence.candidates.push(...extras);
  graph.edges.push(
    {
      id: "internal",
      source: "candidate_check",
      target: "candidate_ship",
      kind: "data",
      label: "dispatch",
      provenance: "declared",
    },
    {
      id: "retry",
      source: "candidate_ship",
      target: "candidate_draft",
      kind: "feedback",
      label: "retry drafting",
      provenance: "declared",
    },
    {
      id: "audit-source",
      source: "candidate_audit",
      target: "file:auth.py",
      kind: "dependency",
      label: "implementation",
      provenance: "declared",
    },
  );
  const original = structuredClone(graph);
  const result = applySemanticProposal(
    graph,
    repo,
    evidence,
    proposal,
    "fixture-model",
  );
  const unresolved = result.graph.nodes.filter(
    (node) => !node.hidden && node.role === "opaque",
  );
  assert.equal(unresolved.length, 1);
  const group = unresolved[0];
  assert.equal(group.label, "Unresolved workflow candidates (3)");
  const omitted = evidence.candidates.filter(
    (node) => node.id !== "candidate_draft",
  );
  assert.deepEqual(
    group.mappingCandidateIds,
    omitted.map((node) => node.id),
  );
  assert.deepEqual(
    group.sourceRefs,
    omitted.map((node) => node.source),
  );
  const draft = result.graph.nodes.find(
    (node) => node.label === "Draft response",
  )!;
  assert.equal(result.graph.nodes.filter((node) => !node.hidden).length, 2);
  assert.ok(
    result.graph.edges.some(
      (edge) =>
        edge.source === draft.id &&
        edge.target === group.id &&
        edge.provenance === "declared",
    ),
  );
  assert.ok(
    result.graph.edges.some(
      (edge) =>
        edge.source === group.id &&
        edge.target === draft.id &&
        edge.kind === "feedback" &&
        edge.label === "retry drafting" &&
        edge.provenance === "declared",
    ),
  );
  assert.ok(
    result.graph.edges.some(
      (edge) =>
        edge.source === group.id &&
        edge.target === "file:auth.py" &&
        edge.kind === "dependency",
    ),
  );
  const nodeIds = new Set(result.graph.nodes.map((node) => node.id));
  assert.ok(
    result.graph.edges.every(
      (edge) =>
        edge.source !== edge.target &&
        nodeIds.has(edge.source) &&
        nodeIds.has(edge.target),
    ),
    "Projection must not leave self-edges or dangling source IDs.",
  );
  assert.equal(result.repo.mapping?.candidates, 4);
  assert.equal(result.repo.mapping?.mappedCandidates, 1);
  assert.equal(result.repo.mapping?.unresolvedCandidates, 3);
  assert.deepEqual(graph, original);
});

test("an assigned candidate declaration header can back a node outside the bounded body excerpt", () => {
  const { graph, repo, evidence, proposal } = fixture();
  graph.nodes[0].source!.line = 80;
  proposal.nodes[0].line = 80;
  const result = applySemanticProposal(
    graph,
    repo,
    evidence,
    proposal,
    "fixture-model",
  );
  const interpreted = result.graph.nodes.find(
    (node) => node.label === "Draft response",
  )!;
  assert.deepEqual(interpreted.source, {
    path: "workflow.py",
    line: 80,
    symbol: "draft",
  });
  assert.deepEqual(interpreted.sourceRefs, [
    { path: "workflow.py", line: 80, symbol: "draft" },
  ]);
  for (const node of [
    { ...proposal.nodes[0], line: 79 },
    { ...proposal.nodes[0], line: 80, candidateIds: ["candidate_check"] },
    { ...proposal.nodes[0], line: 80, path: "unrelated.py" },
  ])
    assert.throws(
      () =>
        applySemanticProposal(
          graph,
          repo,
          evidence,
          { ...proposal, nodes: [node] },
          "fixture-model",
        ),
      /outside its supplied evidence/,
      "An unrelated location cannot borrow another candidate's declaration evidence.",
    );
});

test("a visible disjoint source window permits its exact line but not an omitted gap", () => {
  const { graph, repo, evidence, proposal } = fixture();
  const numbered = {
    ...evidence,
    sources: [
      {
        path: "workflow.py",
        totalLines: 100,
        startLine: 20,
        ranges: [
          { start: 20, end: 22 },
          { start: 60, end: 62 },
        ],
        text: "L20: # header\nL21: def draft():\nL22: return model()\nL60: graph.add_edge('draft', 'check')\nL61: # finish\nL62: graph.compile()",
      },
    ],
  };
  proposal.nodes[0].candidateIds = [];
  proposal.nodes[0].line = 60;
  assert.doesNotThrow(() =>
    applySemanticProposal(graph, repo, numbered, proposal, "fixture-model"),
  );
  proposal.nodes[0].line = 40;
  assert.throws(
    () =>
      applySemanticProposal(graph, repo, numbered, proposal, "fixture-model"),
    /outside its supplied evidence/,
  );
});

test("semantic proposals allow 20 workflow stages but reject a 21st", () => {
  const { graph, repo, evidence, proposal } = fixture();
  const nodes = Array.from({ length: 20 }, (_, index) => ({
    ...proposal.nodes[0],
    key: `stage_${index}`,
    label: `Stage ${index}`,
    candidateIds: [],
  }));
  const result = applySemanticProposal(
    graph,
    repo,
    evidence,
    { ...proposal, nodes },
    "fixture-model",
  );
  assert.equal(
    result.graph.nodes.filter((node) => node.label.startsWith("Stage ")).length,
    20,
  );
  assert.throws(
    () =>
      applySemanticProposal(
        graph,
        repo,
        evidence,
        { ...proposal, nodes: [...nodes, { ...nodes[0], key: "stage_20" }] },
        "fixture-model",
      ),
    /at most 20/,
  );
});
