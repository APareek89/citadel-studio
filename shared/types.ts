export type Provider =
  "gemini" | "openai" | "anthropic" | "groq" | "openrouter";
export type NodeRole =
  | "orchestrator"
  | "agent"
  | "tool"
  | "validator"
  | "guardrail"
  | "output"
  | "resource"
  | "opaque";
export type NodeState =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "blocked"
  | "skipped"
  | "cancelled";
export interface SourceRef {
  path: string;
  line?: number;
  symbol?: string;
}
export interface GraphNode {
  id: string;
  label: string;
  role: NodeRole;
  description?: string;
  prompt?: string;
  code?: string;
  schema?: Record<string, unknown>;
  hidden?: boolean;
  source?: SourceRef;
  rules?: { required?: string[]; forbidden?: string[]; maxLength?: number };
  tool?: "uppercase" | "word-count" | "json-format" | "code";
  modelFixed?: boolean;
  sourceRefs?: SourceRef[];
  mappingCandidateIds?: string[];
  position?: { x: number; y: number };
}
export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  label: string;
  kind: "data" | "feedback" | "dependency";
  instruction?: string;
  inputMapping?: "previous" | "original" | "all";
  provenance?: "declared" | "inferred" | "observed";
}
export interface Graph {
  id: string;
  revision: number;
  name: string;
  description: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  limits: {
    maxCalls: number;
    maxRevisions: number;
    timeoutMs: number;
    maxOutputTokens: number;
    maxCostUsd?: number;
  };
}
export interface Alignment {
  summary: string;
  users: string;
  input: string;
  output: string;
  successCriteria: string[];
  assumptions: string[];
  questions: string[];
  graph: Graph;
}
export interface Project {
  example?: { kind: "source" | "cached-workflow" };
  id: string;
  name: string;
  brief: string;
  graph: Graph;
  alignment?: Alignment;
  repo?: RepoInfo;
  createdAt: string;
  updatedAt: string;
}
export interface Credential {
  id: string;
  label: string;
  provider: Provider;
  source: "session" | "local-file" | "configured" | "example";
  valid: boolean;
  validatedAt?: string;
  error?: string;
}
export interface Model {
  id: string;
  name: string;
  provider: Provider;
  text: boolean;
  structured: boolean;
  tools: boolean;
  context?: number;
  available: boolean;
  verified: boolean;
  reason?: string;
}
export interface ModelConfig {
  credentialId: string;
  model: string;
  temperature?: number;
}
export interface Usage {
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd?: number;
}
export interface RunEvent {
  id: string;
  time: string;
  type:
    | "run.started"
    | "node.started"
    | "node.completed"
    | "node.failed"
    | "node.blocked"
    | "run.completed"
    | "run.failed"
    | "run.cancelled"
    | "run.interrupted"
    | "feedback";
  nodeId?: string;
  invocation?: number;
  input?: string;
  output?: string;
  message?: string;
  latencyMs?: number;
  usage?: Usage;
}
export interface Run {
  id: string;
  projectId: string;
  graph: Graph;
  input: string;
  config: ModelConfig;
  status:
    | "queued"
    | "running"
    | "completed"
    | "failed"
    | "blocked"
    | "cancelled"
    | "interrupted";
  mode: "build" | "compare" | "eval" | "redteam" | "import";
  events: RunEvent[];
  output?: string;
  error?: string;
  createdAt: string;
  finishedAt?: string;
  usage: Usage;
  parentId?: string;
  external?: {
    kind: "workbench" | "langfuse";
    traceId: string;
    namespace: string;
    partial: boolean;
    spans: ObservedSpan[];
  };
}
export interface ObservedSpan {
  id: string;
  name: string;
  parentId?: string;
  nodeId?: string;
  role?: NodeRole;
  status: "running" | "completed" | "failed";
  startTime: string;
  endTime?: string;
  input?: unknown;
  output?: unknown;
  error?: string;
  model?: string;
  usage?: Usage;
  source?: SourceRef;
}
export interface Preflight {
  ok: boolean;
  issues: { code: string; message: string; nodeId?: string }[];
  warnings: string[];
}
export interface RepoInfo {
  sourceBundle?: { ownerId: string; key: string; versionId: string; sha256: string; bytes: number };
  executionAvailable?: boolean;
  executionUnavailableReason?: string;
  sourceKind?: "upload";
  path: string;
  name: string;
  revision: string;
  adapter: "learning-studio" | "discovery-only";
  coverage: string[];
  limitations: string[];
  sources: { path: string; category: string }[];
  mapping?: {
    method: "ai" | "static";
    model?: string;
    discoveredFiles: number;
    candidates: number;
    mappedCandidates: number;
    unresolvedCandidates: number;
    sourceFilesRead: number;
    truncated: boolean;
    notes: string[];
    error?: string;
  };
}
export interface Comparison {
  id: string;
  projectId: string;
  input: string;
  strategy: "node" | "workflow";
  nodeId?: string;
  createdAt: string;
  slots: {
    id: string;
    label: string;
    config: ModelConfig;
    runId?: string;
    error?: string;
  }[];
}
export interface EvalCase {
  id: string;
  input: string;
  expected?: string;
  assertions: {
    type: "contains" | "not-contains" | "regex" | "json" | "max-length";
    value: string;
  }[];
  sourceRunId?: string;
}
export interface EvalSuite {
  id: string;
  projectId: string;
  name: string;
  version: number;
  cases: EvalCase[];
  judge?: { rubric: string; config: ModelConfig };
  createdAt: string;
}
export interface EvalReport {
  id: string;
  suite: EvalSuite;
  graphRevision: number;
  createdAt: string;
  status: "running" | "completed";
  baselineId?: string;
  results: {
    caseId: string;
    runId?: string;
    verdict: "pending" | "pass" | "fail" | "error" | "unscored";
    reasons: string[];
    regression?: boolean;
  }[];
}
export interface RedPlan {
  /** Missing on historical records, which used behavioral execution. */
  mode?: "source-review" | "behavioral";
  targetFingerprint?: string;
  targetName?: string;
  graphRevision?: number;
  review?: {
    digest: string;
    files: number;
    inventoryFiles: number;
    characters: number;
    truncated: boolean;
    notes: string[];
    sources: {
      path: string;
      hash: string;
      ranges: { start: number; end: number }[];
    }[];
    maxCalls: number;
    maxCostUsd: number;
    summary?: string;
    rejectedFindings?: number;
    model?: string;
    usage?: Usage;
  };
  id: string;
  projectId: string;
  target: "manifest" | "import";
  scope: string;
  brandRules: string;
  maxProbes: number;
  createdAt: string;
  status: "proposed" | "running" | "completed";
  probes: {
    id: string;
    specialist: string;
    input: string;
    forbidden: string;
    description: string;
  }[];
  findings: {
    id: string;
    title: string;
    severity: "high" | "medium" | "low";
    evidenceType: "reproduced" | "suspected" | "inconclusive" | "passed";
    description: string;
    runId?: string;
    nodeId?: string;
    source?: SourceRef;
    input?: string;
    category?: "security" | "brand" | "customer-experience";
    quote?: string;
    recommendation?: string;
  }[];
}
