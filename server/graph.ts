import { z } from "zod";
import Ajv from "ajv";
import type { Graph, GraphNode, Preflight } from "../shared/types.js";
import { randomUUID } from "node:crypto";
const id = (prefix = "id") => `${prefix}_${randomUUID().slice(0, 12)}`;
const ajv = new Ajv({ allErrors: true, strict: false, validateFormats: false });
const rules = z.object({
  required: z.array(z.string().max(200)).max(20).optional(),
  forbidden: z.array(z.string().max(200)).max(20).optional(),
  maxLength: z.number().int().positive().max(100000).optional(),
});
export const graphSchema = z.object({
  id: z.string().min(1),
  revision: z.number().int().min(1),
  name: z.string().min(1).max(120),
  description: z.string().max(4000),
  nodes: z
    .array(
      z.object({
        id: z.string().regex(/^[a-zA-Z0-9_-]+$/),
        label: z.string().min(1).max(100),
        role: z.enum([
          "orchestrator",
          "agent",
          "tool",
          "validator",
          "guardrail",
          "output",
          "resource",
          "opaque",
        ]),
        description: z.string().max(3000).optional(),
        prompt: z.string().max(24000).optional(),
        code: z.string().max(24000).optional(),
        schema: z.record(z.unknown()).optional(),
        hidden: z.boolean().optional(),
        source: z
          .object({
            path: z.string(),
            line: z.number().optional(),
            symbol: z.string().optional(),
          })
          .optional(),
        rules: rules.optional(),
        tool: z
          .enum(["uppercase", "word-count", "json-format", "code"])
          .optional(),
        modelFixed: z.boolean().optional(),
        position: z.object({ x: z.number(), y: z.number() }).optional(),
      }),
    )
    .min(1)
    .max(80),
  edges: z
    .array(
      z.object({
        id: z.string(),
        source: z.string(),
        target: z.string(),
        label: z.string().max(200),
        kind: z.enum(["data", "feedback", "dependency"]),
        instruction: z.string().max(4000).optional(),
        inputMapping: z.enum(["previous", "original", "all"]).optional(),
        provenance: z.enum(["declared", "inferred", "observed"]).optional(),
      }),
    )
    .max(160),
  limits: z.object({
    maxCalls: z.number().int().min(1).max(30),
    maxRevisions: z.number().int().min(0).max(3),
    timeoutMs: z.number().int().min(1000).max(180000),
    maxOutputTokens: z.number().int().min(64).max(16000),
    maxCostUsd: z.number().min(0.001).max(3).optional(),
  }),
});
export function orderedNodes(graph: Graph): GraphNode[] {
  const active = graph.nodes.filter((n) => !n.hidden && n.role !== "resource");
  const ids = new Set(active.map((n) => n.id));
  const edges = graph.edges.filter(
    (e) => e.kind === "data" && ids.has(e.source) && ids.has(e.target),
  );
  const completed = new Set<string>();
  const order: GraphNode[] = [];
  while (order.length < active.length) {
    const ready = active.filter(
      (n) =>
        !completed.has(n.id) &&
        edges
          .filter((e) => e.target === n.id)
          .every((e) => completed.has(e.source)),
    );
    if (!ready.length)
      throw new Error(
        "Data edges contain a cycle. Use a bounded feedback edge for reflection.",
      );
    for (const node of ready) {
      completed.add(node.id);
      order.push(node);
    }
  }
  return order;
}
export function validateGraph(graph: Graph): Preflight {
  const issues: Preflight["issues"] = [];
  const parsed = graphSchema.safeParse(graph);
  if (!parsed.success)
    return {
      ok: false,
      issues: parsed.error.issues.map((i) => ({
        code: "invalid_graph",
        message: `${i.path.join(".")}: ${i.message}`,
      })),
      warnings: [],
    };
  const ids = new Set<string>();
  for (const node of graph.nodes) {
    if (ids.has(node.id))
      issues.push({
        code: "duplicate_node",
        message: "Node IDs must be unique",
        nodeId: node.id,
      });
    ids.add(node.id);
    if (node.schema) {
      try {
        if (JSON.stringify(node.schema).length > 10000)
          throw new Error("Schema too large");
        ajv.compile(node.schema);
      } catch {
        issues.push({
          code: "invalid_schema",
          message: "Output schema is not valid JSON Schema",
          nodeId: node.id,
        });
      }
    }
    if (node.hidden && node.role !== "resource")
      issues.push({
        code: "hidden_execution",
        message:
          "Only supporting resource nodes may be hidden. Executable policy nodes must remain in the workflow.",
        nodeId: node.id,
      });
    if (node.role === "tool" && !node.tool)
      issues.push({
        code: "missing_tool",
        message: "Select a supported tool before running",
        nodeId: node.id,
      });
  }
  if (new Set(graph.edges.map((e) => e.id)).size !== graph.edges.length)
    issues.push({ code: "duplicate_edge", message: "Edge IDs must be unique" });
  for (const edge of graph.edges) {
    if (
      edge.kind === "data" &&
      [edge.source, edge.target].some((id) => {
        const n = graph.nodes.find((n) => n.id === id);
        return n?.hidden || n?.role === "resource";
      })
    )
      issues.push({
        code: "resource_data_edge",
        message:
          "Supporting resources use dependency edges. Data edges must connect executable nodes.",
      });
    if (!ids.has(edge.source) || !ids.has(edge.target))
      issues.push({
        code: "missing_node",
        message: `Edge ${edge.label} references a missing node`,
      });
    if (
      edge.kind === "feedback" &&
      graph.nodes.find((n) => n.id === edge.source)?.role !== "validator"
    )
      issues.push({
        code: "feedback_source",
        message: "Only a validator can send bounded feedback",
      });
  }
  for (const node of graph.nodes)
    if (
      graph.edges.filter((e) => e.source === node.id && e.kind === "feedback")
        .length > 1
    )
      issues.push({
        code: "ambiguous_feedback",
        message: "A validator may have one feedback target.",
        nodeId: node.id,
      });
  const outputs = graph.nodes.filter((n) => n.role === "output" && !n.hidden);
  if (outputs.length !== 1)
    issues.push({
      code: "output_count",
      message: "Use exactly one visible output node",
    });
  try {
    const order = orderedNodes(graph);
    const out = order.findIndex((n) => n.role === "output");
    if (out !== order.length - 1)
      issues.push({
        code: "output_order",
        message: "The output node must be the final executable node",
      });
    for (const edge of graph.edges.filter((e) => e.kind === "feedback")) {
      if (
        order.findIndex((n) => n.id === edge.target) >=
        order.findIndex((n) => n.id === edge.source)
      )
        issues.push({
          code: "feedback_order",
          message: "Feedback must target an earlier agent",
        });
      if (graph.nodes.find((n) => n.id === edge.target)?.role !== "agent")
        issues.push({
          code: "feedback_target",
          message: "Feedback must target an agent node",
        });
    }
    for (const n of order.filter((n) => n.role !== "orchestrator"))
      if (!graph.edges.some((e) => e.kind === "data" && e.target === n.id))
        issues.push({
          code: "disconnected_node",
          message: `${n.label} needs an incoming data edge`,
          nodeId: n.id,
        });
  } catch (e) {
    issues.push({ code: "cycle", message: (e as Error).message });
  }
  return { ok: issues.length === 0, issues, warnings: [] };
}
export function validateOutput(node: GraphNode, output: string): string[] {
  const reasons: string[] = [];
  for (const phrase of node.rules?.required || [])
    if (!output.toLowerCase().includes(phrase.toLowerCase()))
      reasons.push(`Missing required text: ${phrase}`);
  for (const phrase of node.rules?.forbidden || [])
    if (output.toLowerCase().includes(phrase.toLowerCase()))
      reasons.push(`Contains forbidden text: ${phrase}`);
  if (node.rules?.maxLength && output.length > node.rules.maxLength)
    reasons.push(`Exceeds ${node.rules.maxLength} characters`);
  if (node.schema) {
    try {
      const validate = ajv.compile(node.schema);
      const data = JSON.parse(output.replace(/^```(?:json)?\s*|\s*```$/g, ""));
      if (!validate(data))
        reasons.push("Schema mismatch: " + ajv.errorsText(validate.errors));
    } catch {
      reasons.push("Output must be valid JSON matching the schema");
    }
  }
  return reasons;
}
export function defaultGraph(name = "New agent app"): Graph {
  return {
    id: id("graph"),
    revision: 1,
    name,
    description:
      "A controlled text workflow. Edit instructions and checks before running.",
    limits: {
      maxCalls: 6,
      maxRevisions: 1,
      timeoutMs: 45000,
      maxOutputTokens: 1536,
    },
    nodes: [
      {
        id: "entry",
        label: "Coordinator",
        role: "orchestrator",
        description: "Passes the request into the workflow.",
      },
      {
        id: "writer",
        label: "Response agent",
        role: "agent",
        prompt:
          "Help the user with their request. Be accurate, concise, and explicit about uncertainty.",
      },
      {
        id: "review",
        label: "Quality check",
        role: "validator",
        description: "Checks required and prohibited phrases before release.",
        rules: { forbidden: ["WORKBENCH_TEST_SECRET"] },
      },
      { id: "output", label: "Final response", role: "output" },
      {
        id: "ui",
        label: "App interface",
        role: "resource",
        hidden: true,
        description: "Generated minimal browser interface.",
      },
      {
        id: "docs",
        label: "README.md",
        role: "resource",
        hidden: true,
        description: "Setup and runtime instructions.",
      },
    ],
    edges: [
      {
        id: "e1",
        source: "entry",
        target: "writer",
        kind: "data",
        label: "Delegate request",
        inputMapping: "previous",
        provenance: "declared",
      },
      {
        id: "e2",
        source: "writer",
        target: "review",
        kind: "data",
        label: "Validate answer",
        inputMapping: "previous",
        provenance: "declared",
      },
      {
        id: "e3",
        source: "review",
        target: "output",
        kind: "data",
        label: "Release if accepted",
        inputMapping: "previous",
        provenance: "declared",
      },
      {
        id: "e4",
        source: "review",
        target: "writer",
        kind: "feedback",
        label: "Revise once",
        instruction: "Address validation feedback.",
        provenance: "declared",
      },
      {
        id: "d1",
        source: "ui",
        target: "entry",
        kind: "dependency",
        label: "Collects input",
        provenance: "declared",
      },
    ],
  };
}
