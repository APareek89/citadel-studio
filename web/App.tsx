import { useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  Controls,
  Handle,
  Position,
  ReactFlow,
  type Connection,
  type NodeProps,
  type Node as FlowNode,
} from "@xyflow/react";
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Blocks,
  Braces,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  CircleHelp,
  Clock3,
  Code2,
  FileCode2,
  FlaskConical,
  GitBranch,
  KeyRound,
  Layers3,
  Loader2,
  Moon,
  MoreHorizontal,
  Play,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  Square,
  Sun,
  TerminalSquare,
  Trash2,
  Workflow,
  X,
} from "lucide-react";
import type {
  Alignment,
  Comparison,
  Credential,
  EvalCase,
  EvalReport,
  EvalSuite,
  Graph,
  GraphEdge,
  GraphNode,
  Model,
  ModelConfig,
  Preflight,
  Project,
  Provider,
  RedPlan,
  Run,
  RunEvent,
} from "../shared/types";

type Mode = "build" | "connect" | "redteam" | "models" | "evals";
type Bootstrap = {
  projects: Project[];
  credentials: Credential[];
  runs: Run[];
  comparisons: Comparison[];
  suites: EvalSuite[];
  reports: EvalReport[];
  redPlans: RedPlan[];
  system: {
    docker: boolean | { available: boolean };
    localSecretsAvailable: boolean;
  };
};
const EMPTY: Bootstrap = {
  projects: [],
  credentials: [],
  runs: [],
  comparisons: [],
  suites: [],
  reports: [],
  redPlans: [],
  system: { docker: false, localSecretsAvailable: false },
};
const MODES: {
  id: Mode;
  label: string;
  icon: typeof Workflow;
  description: string;
  steps: string[];
}[] = [
  {
    id: "build",
    label: "Build",
    icon: Blocks,
    description: "From an idea to a working agent.",
    steps: ["Align", "Review", "Run & Test", "Launch"],
  },
  {
    id: "connect",
    label: "Connect & Debug",
    icon: GitBranch,
    description: "Understand what your application actually does.",
    steps: ["Connect", "Map", "Observe", "Diagnose"],
  },
  {
    id: "redteam",
    label: "Red Team",
    icon: ShieldCheck,
    description: "Find the edges before your users do.",
    steps: ["Scope", "Test Plan", "Run", "Findings"],
  },
  {
    id: "models",
    label: "Model Lab",
    icon: FlaskConical,
    description: "Same task. Different models. Visible tradeoffs.",
    steps: ["Configure", "Compare", "Graph Results"],
  },
  {
    id: "evals",
    label: "Evals",
    icon: CheckCircle2,
    description: "Turn expectations into repeatable checks.",
    steps: ["Dataset", "Criteria", "Run", "Results"],
  },
];
const PROVIDERS: Provider[] = [
  "gemini",
  "openai",
  "anthropic",
  "groq",
  "openrouter",
];
const ROLES: GraphNode["role"][] = [
  "orchestrator",
  "agent",
  "tool",
  "validator",
  "guardrail",
  "output",
  "resource",
  "opaque",
];
const uid = () => crypto.randomUUID();
const pretty = (x: unknown) => JSON.stringify(x, null, 2);
const preferredModel = (models: Model[]) =>
  models.find(
    (m) => m.available && m.text && m.id === "gemini-3.5-flash-lite",
  ) ||
  models.find((m) => m.available && m.text && m.id.includes("flash-lite")) ||
  models.find((m) => m.available && m.text);
const terminal = (r?: Run) => !!r && !["queued", "running"].includes(r.status);
const fmtDate = (s: string) =>
  new Date(s).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const duration = (r: Run) =>
  r.finishedAt
    ? `${((+new Date(r.finishedAt) - +new Date(r.createdAt)) / 1000).toFixed(1)}s`
    : "Running";
async function api<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let e;
    try {
      e = await res.json();
    } catch {
      e = { error: res.statusText };
    }
    throw new Error(e.message || e.error || `Request failed (${res.status})`);
  }
  return res.json();
}
function Status({ value }: { value: string }) {
  return (
    <span className={`status status-${value}`}>
      <span />
      {value.replaceAll("-", " ")}
    </span>
  );
}
function Empty({
  icon: Icon = Workflow,
  title,
  children,
  action,
}: {
  icon?: typeof Workflow;
  title: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="empty">
      <span className="empty-icon">
        <Icon size={25} />
      </span>
      <h3>{title}</h3>
      <p>{children}</p>
      {action}
    </div>
  );
}
function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}
function Modal({
  title,
  kicker,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  kicker?: string;
  children: React.ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const dialog = useRef<HTMLElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const focusable = () =>
      Array.from(
        dialog.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],[tabindex="0"]',
        ) || [],
      ).filter((el) => el.offsetParent !== null);
    const raf = requestAnimationFrame(() => {
      (
        dialog.current?.querySelector<HTMLElement>("[autofocus]") ||
        focusable()[0]
      )?.focus();
    });
    const fn = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
      if (e.key === "Tab") {
        const items = focusable();
        const first = items[0],
          last = items.at(-1);
        if (!first) {
          e.preventDefault();
          return;
        }
        if (
          e.shiftKey &&
          (document.activeElement === first ||
            !dialog.current?.contains(document.activeElement))
        ) {
          e.preventDefault();
          last?.focus();
        } else if (
          !e.shiftKey &&
          (document.activeElement === last ||
            !dialog.current?.contains(document.activeElement))
        ) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", fn);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("keydown", fn);
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <section
        ref={dialog}
        className={`modal ${wide ? "wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <button
          className="icon-button modal-close"
          onClick={onClose}
          aria-label="Close dialog"
        >
          <X size={19} />
        </button>
        {kicker && <span className="eyebrow">{kicker}</span>}
        <h2>{title}</h2>
        {children}
      </section>
    </div>
  );
}
function graphLayout(graph: Graph): Record<string, { x: number; y: number }> {
  const visible = graph.nodes.filter((n) => !n.hidden),
    ids = new Set(visible.map((n) => n.id)),
    flow = graph.edges.filter(
      (e) => e.kind === "data" && ids.has(e.source) && ids.has(e.target),
    ),
    ranks = new Map<string, number>();
  const remaining = new Set(visible.map((n) => n.id));
  for (let pass = 0; pass < visible.length; pass++) {
    let progressed = false;
    for (const node of visible) {
      if (!remaining.has(node.id)) continue;
      const incoming = flow.filter((e) => e.target === node.id);
      if (incoming.every((e) => ranks.has(e.source))) {
        ranks.set(
          node.id,
          incoming.length
            ? Math.max(...incoming.map((e) => ranks.get(e.source)!)) + 1
            : 0,
        );
        remaining.delete(node.id);
        progressed = true;
      }
    }
    if (!progressed) break;
  }
  for (const id of remaining) ranks.set(id, 0);
  const lanes = new Map<number, number>();
  return Object.fromEntries(
    visible.map((n) => {
      const rank = ranks.get(n.id) || 0,
        lane = lanes.get(rank) || 0;
      lanes.set(rank, lane + 1);
      return [n.id, { x: rank * 360, y: 75 + lane * 230 }];
    }),
  );
}
function AgentNode({
  data,
  selected,
}: NodeProps<FlowNode<{ node: GraphNode; state: string; count: number }>>) {
  const n = data.node;
  return (
    <div
      className={`agent-node role-${n.role} ${selected ? "selected" : ""} state-${data.state}`}
    >
      <Handle id="flow-in" type="target" position={Position.Left} />
      <Handle
        id="feedback-in"
        className="feedback-handle"
        type="target"
        position={Position.Top}
        style={{ left: "35%" }}
      />
      <div className="node-top">
        <span className="node-role">
          {n.role === "orchestrator" ? (
            <Workflow size={13} />
          ) : n.role === "guardrail" ? (
            <ShieldCheck size={13} />
          ) : n.role === "tool" ? (
            <TerminalSquare size={13} />
          ) : (
            <Blocks size={13} />
          )}{" "}
          {n.role}
        </span>
        {data.state === "running" ? (
          <Loader2 size={13} className="spin" />
        ) : (
          <MoreHorizontal size={15} />
        )}
      </div>
      <strong>{n.label}</strong>
      <p>{n.description || n.source?.path || "Select to configure"}</p>
      <div className="node-bottom">
        <span>
          {data.count
            ? `${data.count} invocation${data.count === 1 ? "" : "s"}`
            : n.source
              ? "Source linked"
              : n.modelFixed
                ? "Fixed model"
                : "Graph definition"}
        </span>
        {data.state !== "pending" && <span>{data.state}</span>}
      </div>
      <Handle id="flow-out" type="source" position={Position.Right} />
      <Handle
        id="feedback-out"
        className="feedback-handle"
        type="source"
        position={Position.Top}
        style={{ left: "65%" }}
      />
    </div>
  );
}
const NODE_TYPES = { agent: AgentNode };

export default function App() {
  const [data, setData] = useState<Bootstrap>(EMPTY),
    [booting, setBooting] = useState(true),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState("");
  const [mode, setMode] = useState<Mode>("build"),
    [step, setStep] = useState("Align"),
    [projectId, setProjectId] = useState(""),
    [theme, setTheme] = useState(
      () => localStorage.getItem("workbench-theme") || "system",
    );
  const [credentialModal, setCredentialModal] = useState(false),
    [newModal, setNewModal] = useState(false),
    [hiddenModal, setHiddenModal] = useState(false),
    [searchModal, setSearchModal] = useState(false),
    [search, setSearch] = useState("");
  const [models, setModels] = useState<Record<string, Model[]>>({}),
    [config, setConfig] = useState<ModelConfig>({
      credentialId: "",
      model: "",
      temperature: 0.3,
    });
  const [brief, setBrief] = useState(""),
    [alignment, setAlignment] = useState<Alignment | null>(null),
    [graph, setGraph] = useState<Graph | null>(null),
    [dirty, setDirty] = useState(false),
    [selection, setSelection] = useState<{
      type: "node" | "edge";
      id: string;
    } | null>(null),
    [inspectorTab, setInspectorTab] = useState("Configuration");
  const [runId, setRunId] = useState(""),
    [view, setView] = useState<"design" | "observed">("design"),
    [input, setInput] = useState(""),
    [preflight, setPreflight] = useState<Preflight | null>(null),
    [eventId, setEventId] = useState("");
  const [repoPath, setRepoPath] = useState(""),
    [repoDefault, setRepoDefault] = useState("");
  const [redScope, setRedScope] = useState("local-test"),
    [brandRules, setBrandRules] = useState(
      "Be clear, accurate and respectful. State uncertainty. Never claim a tool action succeeded without evidence.",
    ),
    [maxProbes, setMaxProbes] = useState(4),
    [redId, setRedId] = useState(""),
    [confirmed, setConfirmed] = useState(false);
  const [slots, setSlots] = useState<
      { id: string; label: string; config: ModelConfig }[]
    >([]),
    [strategy, setStrategy] = useState<"node" | "workflow">("workflow"),
    [compareNode, setCompareNode] = useState(""),
    [comparisonId, setComparisonId] = useState("");
  const [suiteId, setSuiteId] = useState(""),
    [suiteName, setSuiteName] = useState("Core behavior"),
    [casesText, setCasesText] = useState(
      pretty([
        {
          id: "case-1",
          input: "Explain what this assistant can help with.",
          expected: "A clear, relevant response.",
          assertions: [{ type: "not-contains", value: "API_KEY" }],
        },
      ]),
    ),
    [judgeEnabled, setJudgeEnabled] = useState(false),
    [rubric, setRubric] = useState(
      "Assess whether the response satisfies the expected behavior. Use only the supplied evidence.",
    ),
    [baselineId, setBaselineId] = useState(""),
    [reportId, setReportId] = useState("");
  const project = data.projects.find((p) => p.id === projectId),
    activeMode = MODES.find((m) => m.id === mode)!;
  const run = data.runs.find((r) => r.id === runId),
    red = data.redPlans.find((r) => r.id === redId),
    comparison = data.comparisons.find((c) => c.id === comparisonId),
    report = data.reports.find((r) => r.id === reportId);
  const projectRuns = data.runs.filter((r) => r.projectId === projectId),
    projectSuites = data.suites.filter((s) => s.projectId === projectId),
    projectReports = data.reports.filter(
      (r) => r.suite.projectId === projectId,
    );
  const isImported = !!project?.repo,
    docker =
      typeof data.system.docker === "object"
        ? data.system.docker.available
        : data.system.docker;
  const running = !!run && !terminal(run),
    selectedNode = graph?.nodes.find(
      (n) => selection?.type === "node" && n.id === selection.id,
    ),
    selectedEdge = (view === "observed" && run ? run.graph : graph)?.edges.find(
      (e) => selection?.type === "edge" && e.id === selection.id,
    );
  const observedGraph = view === "observed" && run ? run.graph : graph;
  async function refresh() {
    const b = await api<Bootstrap>("/bootstrap");
    setData(b);
    setProjectId((p) => p || b.projects[0]?.id || "");
    return b;
  }
  useEffect(() => {
    refresh()
      .catch((e) => setError(e.message))
      .finally(() => setBooting(false));
    api<{ path: string }>("/repos/default")
      .then((r) => {
        setRepoDefault(r.path);
        setRepoPath(r.path);
      })
      .catch(() => {});
  }, []);
  useEffect(() => {
    if (!project) return;
    setBrief(project.brief);
    setAlignment(project.alignment || null);
    setGraph(structuredClone(project.graph));
    setDirty(false);
    setSelection(
      project.graph.nodes[0]
        ? { type: "node", id: project.graph.nodes[0].id }
        : null,
    );
    setRunId("");
    setView("design");
    setPreflight(null);
    setSuiteId("");
    setReportId("");
    setRedId("");
    setComparisonId("");
    if (project.repo) {
      setMode("connect");
      setStep("Map");
    }
  }, [projectId]);
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () =>
      (document.documentElement.dataset.theme =
        theme === "system" ? (media.matches ? "dark" : "light") : theme);
    apply();
    media.addEventListener("change", apply);
    localStorage.setItem("workbench-theme", theme);
    return () => media.removeEventListener("change", apply);
  }, [theme]);
  useEffect(() => {
    const f = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setSearchModal((s) => !s);
      }
    };
    document.addEventListener("keydown", f);
    return () => document.removeEventListener("keydown", f);
  }, []);
  useEffect(() => {
    if (!config.credentialId) {
      const c = data.credentials.find((c) => c.valid);
      if (c) setConfig((v) => ({ ...v, credentialId: c.id }));
    }
  }, [data.credentials, config.credentialId]);
  const hasActive =
    data.runs.some((r) => !terminal(r)) ||
    data.redPlans.some((p) => p.status === "running") ||
    data.reports.some((r) => r.status === "running");
  useEffect(() => {
    if (!hasActive) return;
    const timer = setInterval(() => refresh().catch(() => {}), 1500);
    return () => clearInterval(timer);
  }, [hasActive]);
  useEffect(() => {
    if (!config.credentialId || models[config.credentialId]) return;
    api<Model[]>(`/credentials/${config.credentialId}/models`)
      .then((m) => {
        setModels((v) => ({ ...v, [config.credentialId]: m }));
        if (!config.model)
          setConfig((c) => ({ ...c, model: preferredModel(m)?.id || "" }));
      })
      .catch(() => {});
  }, [config.credentialId]);
  useEffect(() => {
    if (notice) {
      const t = setTimeout(() => setNotice(""), 6000);
      return () => clearTimeout(t);
    }
  }, [notice]);
  async function act(label: string, fn: () => Promise<void>) {
    if (busy) return;
    setBusy(label);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  function navigate(m: Mode, s?: string) {
    setMode(m);
    setStep(s || MODES.find((x) => x.id === m)!.steps[0]);
    setPreflight(null);
  }
  function syncProject(p: Project) {
    setData((d) => ({
      ...d,
      projects: [p, ...d.projects.filter((x) => x.id !== p.id)],
    }));
    setProjectId(p.id);
    setGraph(structuredClone(p.graph));
    setBrief(p.brief);
    setAlignment(p.alignment || null);
    setDirty(false);
  }
  function requireConfig(c = config) {
    if (!c.credentialId || !c.model) {
      setCredentialModal(true);
      throw new Error(
        "Choose a validated credential and compatible model before continuing.",
      );
    }
    return c;
  }
  function updateGraph(updater: (g: Graph) => Graph) {
    if (!graph) return;
    setGraph(updater(graph));
    setDirty(true);
    setPreflight(null);
  }
  async function saveGraph() {
    if (!project || !graph) return;
    const p = await api<Project>(`/projects/${project.id}`, "PUT", { graph });
    syncProject(p);
    setNotice(
      `Saved graph revision ${p.graph.revision}. Earlier runs keep their original graph.`,
    );
  }
  async function checkReady() {
    if (!project) throw new Error("Create or connect a project first.");
    if (dirty) throw new Error("Save your graph changes before running.");
    const p = await api<Preflight>("/preflight", "POST", {
      projectId,
      config: requireConfig(),
      input,
    });
    setPreflight(p);
    return p;
  }
  async function startRun(importRun = false) {
    if (!input.trim()) throw new Error("Add sample input before running.");
    const p = await checkReady();
    if (!p.ok) return;
    const r = await api<Run>(
      importRun ? `/projects/${projectId}/import-run` : "/runs",
      "POST",
      { projectId, config, input },
    );
    setData((d) => ({
      ...d,
      runs: [r, ...d.runs.filter((x) => x.id !== r.id)],
    }));
    setRunId(r.id);
    setView("observed");
    setInspectorTab("Output");
    setEventId("");
    setNotice("Run started. Trace events will appear as each step executes.");
  }
  function inspectRun(r: Run) {
    setInput(r.input);
    setRunId(r.id);
    setView("observed");
    setInspectorTab("Output");
    setEventId("");
    if (r.graph.nodes[0])
      setSelection({ type: "node", id: r.graph.nodes[0].id });
  }
  function promoteCase(inputText: string, expected = "", sourceRunId?: string) {
    let cases: EvalCase[] = [];
    try {
      cases = JSON.parse(casesText);
    } catch {}
    cases.push({
      id: `case-${cases.length + 1}`,
      input: inputText,
      expected,
      assertions: [],
      sourceRunId,
    });
    setCasesText(pretty(cases));
    navigate("evals", "Criteria");
    setNotice(
      "Case added as a draft. Review its expected outcome and assertions before saving.",
    );
  }
  async function selectCredential(id: string) {
    setConfig((c) => ({ ...c, credentialId: id, model: "" }));
    if (!id) return;
    try {
      const list = await api<Model[]>(`/credentials/${id}/models`);
      setModels((m) => ({ ...m, [id]: list }));
      const first = preferredModel(list);
      if (first) setConfig((c) => ({ ...c, model: first.id }));
    } catch (e) {
      setError((e as Error).message);
    }
  }
  function ModelFields({
    value,
    onChange,
    compact = false,
  }: {
    value: ModelConfig;
    onChange: (c: ModelConfig) => void;
    compact?: boolean;
  }) {
    const options = models[value.credentialId] || [];
    return (
      <div className={`model-fields ${compact ? "compact" : ""}`}>
        <label>
          <span className="sr-only">Credential</span>
          <select
            aria-label="Credential"
            value={value.credentialId}
            onChange={(e) => {
              const id = e.target.value;
              onChange({
                ...value,
                credentialId: id,
                model: preferredModel(models[id] || [])?.id || "",
              });
              if (id && !models[id])
                api<Model[]>(`/credentials/${id}/models`)
                  .then((list) => {
                    setModels((m) => ({ ...m, [id]: list }));
                    const first = preferredModel(list);
                    if (first)
                      onChange({ ...value, credentialId: id, model: first.id });
                  })
                  .catch((e) => setError(e.message));
            }}
          >
            <option value="">Select credential</option>
            {data.credentials.map((c) => (
              <option key={c.id} value={c.id} disabled={!c.valid}>
                {c.label} · {c.provider}
                {!c.valid ? " · validate first" : ""}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="sr-only">Model</span>
          <select
            aria-label="Model"
            value={value.model}
            disabled={!value.credentialId}
            onChange={(e) => onChange({ ...value, model: e.target.value })}
          >
            <option value="">Select compatible model</option>
            {options.map((m) => (
              <option
                key={m.id}
                value={m.id}
                disabled={!m.available || !m.text}
              >
                {m.name || m.id}
                {!m.available
                  ? ` · ${m.reason || "unavailable"}`
                  : m.verified
                    ? ""
                    : " · advertised"}
              </option>
            ))}
          </select>
        </label>
        {!compact && (
          <button
            className="button subtle"
            onClick={() => setCredentialModal(true)}
          >
            <KeyRound size={14} /> Manage keys
          </button>
        )}
      </div>
    );
  }
  const nodes = useMemo(() => {
    if (!observedGraph) return [];
    const visible = observedGraph.nodes.filter((n) => !n.hidden),
      layout = graphLayout(observedGraph);
    return visible.map((n, i) => {
      const events =
        run && view === "observed"
          ? run.events.filter((e) => e.nodeId === n.id)
          : [];
      const last = events.at(-1);
      const state =
        last?.type === "node.started"
          ? "running"
          : last?.type === "node.failed"
            ? "failed"
            : last?.type === "node.blocked"
              ? "blocked"
              : last?.type === "node.completed"
                ? "completed"
                : "pending";
      return {
        id: n.id,
        type: "agent",
        position: n.position || layout[n.id],
        data: {
          node: n,
          state,
          count: events.filter((e) => e.type === "node.started").length,
        },
        selected: selection?.type === "node" && selection.id === n.id,
      };
    });
  }, [observedGraph, run, view, selection]);
  const edges = useMemo(() => {
    if (!observedGraph) return [];
    const ids = new Set(nodes.map((n) => n.id));
    return observedGraph.edges
      .filter((e) => ids.has(e.source) && ids.has(e.target))
      .map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        sourceHandle: e.kind === "feedback" ? "feedback-out" : "flow-out",
        targetHandle: e.kind === "feedback" ? "feedback-in" : "flow-in",
        label: e.label.length > 23 ? e.label.slice(0, 22) + "…" : e.label,
        ariaLabel: e.label,
        type: "smoothstep",
        animated: view === "observed" && running,
        style: {
          stroke: e.kind === "feedback" ? "var(--purple)" : "var(--edge)",
          strokeDasharray: e.kind === "feedback" ? "5 4" : undefined,
        },
        labelStyle: { fill: "var(--muted)", fontSize: 12 },
        labelBgStyle: { fill: "var(--canvas)" },
        selected: selection?.type === "edge" && selection.id === e.id,
      }));
  }, [observedGraph, nodes, view, running, selection]);
  function connectEdge(c: Connection) {
    if (isImported || view === "observed" || !c.source || !c.target) return;
    updateGraph((g) => ({
      ...g,
      edges: [
        ...g.edges,
        {
          id: uid(),
          source: c.source!,
          target: c.target!,
          label: "pass output",
          kind: "data",
          inputMapping: "previous",
          provenance: "declared",
        },
      ],
    }));
  }
  const graphPanel = (
    <div className="graph-panel">
      <div className="graph-toolbar">
        <div className="segmented">
          <button
            className={view === "design" ? "active" : ""}
            onClick={() => setView("design")}
          >
            {isImported ? "Source map" : "Graph"}
          </button>
          <button
            className={view === "observed" ? "active" : ""}
            disabled={!run}
            onClick={() => setView("observed")}
          >
            Observed run
          </button>
        </div>
        <div className="toolbar-actions">
          <button
            className="button subtle small"
            onClick={() => setHiddenModal(true)}
          >
            <Layers3 size={14} /> Hidden nodes{" "}
            <span className="count">
              {graph?.nodes.filter((n) => n.hidden).length || 0}
            </span>
          </button>
          {!isImported && view === "design" && (
            <button
              className="icon-button"
              aria-label="Add graph node"
              onClick={() => {
                const id = uid();
                updateGraph((g) => ({
                  ...g,
                  nodes: [
                    ...g.nodes,
                    {
                      id,
                      label: "New agent",
                      role: "agent",
                      prompt:
                        "Describe this agent’s task, constraints and output.",
                      position: {
                        x: 50 + (g.nodes.length % 3) * 280,
                        y: Math.floor(g.nodes.length / 3) * 190,
                      },
                    },
                  ],
                }));
                setSelection({ type: "node", id });
                setInspectorTab("Configuration");
              }}
            >
              <Plus size={16} />
            </button>
          )}
        </div>
      </div>
      <div className="graph-caption">
        {view === "observed" && run ? (
          <>
            Recorded graph r{run.graph.revision} · {run.events.length} events ·{" "}
            <Status value={run.status} />
          </>
        ) : isImported ? (
          <>
            Source revision {project?.repo?.revision.slice(0, 8)} ·
            relationships labelled by evidence
          </>
        ) : (
          <>
            Application graph{" "}
            <span>
              r{graph?.revision} {dirty ? "· unsaved changes" : ""}
            </span>
          </>
        )}
      </div>
      <div className="flow-wrap">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={NODE_TYPES}
          onNodeClick={(_, n) => {
            setSelection({ type: "node", id: n.id });
            setEventId("");
          }}
          onEdgeClick={(_, e) => setSelection({ type: "edge", id: e.id })}
          onNodesChange={(changes) => {
            const selected = changes.find(
              (c) => c.type === "select" && c.selected,
            );
            if (selected?.type === "select")
              setSelection((current) =>
                current?.type === "node" && current.id === selected.id
                  ? current
                  : { type: "node", id: selected.id },
              );
          }}
          onNodeDrag={(_, n) => {
            if (!isImported && view === "design")
              updateGraph((g) => ({
                ...g,
                nodes: g.nodes.map((x) =>
                  x.id === n.id ? { ...x, position: n.position } : x,
                ),
              }));
          }}
          onNodeDragStop={(_, n) => {
            if (!isImported && view === "design")
              updateGraph((g) => ({
                ...g,
                nodes: g.nodes.map((x) =>
                  x.id === n.id ? { ...x, position: n.position } : x,
                ),
              }));
          }}
          onConnect={connectEdge}
          nodesDraggable={!isImported && view === "design"}
          nodesConnectable={!isImported && view === "design"}
          defaultViewport={{ x: 35, y: 45, zoom: 1 }}
          minZoom={0.5}
          maxZoom={1.5}
          fitView={false}
          proOptions={{ hideAttribution: true }}
        >
          <Background color="var(--dots)" gap={22} size={1} />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
      <div className="graph-bottom">
        <span>
          <span className="dot" />{" "}
          {view === "observed"
            ? "Observed activity"
            : "Declared application structure"}
        </span>
        <span>
          {nodes.length} workflow nodes · {edges.length} connections
        </span>
      </div>
    </div>
  );
  function RunPanel() {
    return (
      <section className="run-panel">
        <div className="section-header">
          <div>
            <span className="eyebrow">PLAYGROUND</span>
            <h3>
              {isImported ? "Observe an application run" : "Try a real input"}
            </h3>
          </div>
          <div className="run-select">
            <select
              aria-label="Recorded run"
              value={runId}
              onChange={(e) => {
                const r = data.runs.find((r) => r.id === e.target.value);
                if (r) inspectRun(r);
                else {
                  setRunId("");
                  setView("design");
                }
              }}
            >
              <option value="">New run</option>
              {projectRuns.map((r) => (
                <option key={r.id} value={r.id}>
                  {fmtDate(r.createdAt)} · r{r.graph.revision} · {r.status}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="playground-grid">
          <div>
            <textarea
              aria-label="Sample input"
              className="sample-input"
              placeholder={
                isImported
                  ? "Describe a lesson or learning goal for the connected application…"
                  : "Give this application an input to work with…"
              }
              value={input}
              onChange={(e) => setInput(e.target.value)}
            />
            <div className="row spread">
              <span className="muted small">
                {config.model
                  ? `Using ${config.model}`
                  : "Choose a model above"}
              </span>
              <div className="row">
                <button
                  className="button small"
                  disabled={!!busy || running}
                  onClick={() =>
                    act("Checking preflight", async () => {
                      await checkReady();
                    })
                  }
                >
                  Check setup
                </button>
                {running ? (
                  <button
                    className="button small danger"
                    onClick={() =>
                      act("Stopping run", async () => {
                        await api(`/runs/${runId}/cancel`, "POST");
                        await refresh();
                      })
                    }
                  >
                    <Square size={13} /> Stop
                  </button>
                ) : (
                  <button
                    className="button primary small"
                    disabled={!!busy}
                    onClick={() =>
                      act("Starting run", () => startRun(isImported))
                    }
                  >
                    <Play size={13} /> Run
                  </button>
                )}
              </div>
            </div>
          </div>
          <div className="response">
            <div className="row spread">
              <span className="eyebrow">RESPONSE</span>
              {run && <Status value={run.status} />}
            </div>
            {run ? (
              <>
                <div className="response-text">
                  {run.output ||
                    run.error ||
                    (running
                      ? "Working through the graph. Select a node to inspect its activity."
                      : "This run produced no final response.")}
                </div>
                <div className="response-meta">
                  <span>
                    {duration(run)} ·{" "}
                    {run.usage.inputTokens + run.usage.outputTokens} tokens
                    {run.usage.estimatedCostUsd !== undefined
                      ? ` · ~$${run.usage.estimatedCostUsd.toFixed(4)}`
                      : ""}
                  </span>
                  <button
                    className="text-button"
                    onClick={() => promoteCase(run.input, "", run.id)}
                  >
                    Add eval case <ArrowUpRight size={12} />
                  </button>
                </div>
              </>
            ) : (
              <p className="muted">
                The response will appear here. Intermediate inputs, outputs and
                failures stay attached to their nodes.
              </p>
            )}
          </div>
        </div>
        {preflight && (
          <div className={`preflight ${preflight.ok ? "pass" : "fail"}`}>
            <strong>
              {preflight.ok ? "Ready to run" : "Resolve before running"}
            </strong>
            {preflight.issues.map((i, k) => (
              <p key={k}>{i.message}</p>
            ))}
            {preflight.warnings.map((w, k) => (
              <p key={k}>{w}</p>
            ))}
          </div>
        )}
      </section>
    );
  }
  function Inspector() {
    if (!graph || !selection)
      return (
        <aside className="inspector">
          <Empty title="Every detail, in reach">
            Select a node or connection to inspect its configuration and
            evidence.
          </Empty>
        </aside>
      );
    const historicalNode = run?.graph.nodes.find((n) => n.id === selection.id),
      node =
        view === "observed" && historicalNode ? historicalNode : selectedNode;
    const events = run?.events.filter((e) => e.nodeId === selection.id) || [];
    const invocations = events.filter(
      (e) =>
        e.output !== undefined ||
        e.type === "node.failed" ||
        e.type === "node.blocked",
    );
    const evt =
      events.find((e) => e.id === eventId) ||
      invocations.at(-1) ||
      events.at(-1);
    const locked = isImported || view === "observed";
    const patchNode = (p: Partial<GraphNode>) =>
      updateGraph((g) => ({
        ...g,
        nodes: g.nodes.map((n) => (n.id === selection.id ? { ...n, ...p } : n)),
      }));
    const patchEdge = (p: Partial<GraphEdge>) =>
      updateGraph((g) => ({
        ...g,
        edges: g.edges.map((e) => (e.id === selection.id ? { ...e, ...p } : e)),
      }));
    return (
      <aside className="inspector">
        <div className="inspector-head">
          <span className="eyebrow">
            {selection.type === "edge" ? "CONNECTION" : "NODE"} INSPECTOR
          </span>
          <Settings2 size={15} />
          <h2>
            {node?.label || selectedEdge?.label || "Historical component"}
          </h2>
          <p>
            {node?.description ||
              (selectedEdge
                ? `${selectedEdge.source} → ${selectedEdge.target}`
                : "")}
          </p>
        </div>
        <div className="inspector-tabs">
          {["Configuration", "Output", "Activity"].map((t) => (
            <button
              key={t}
              className={inspectorTab === t ? "active" : ""}
              onClick={() => setInspectorTab(t)}
            >
              {t}
            </button>
          ))}
        </div>
        <div className="inspector-body">
          {inspectorTab === "Configuration" ? (
            <>
              {locked && (
                <div className="callout small">
                  {isImported
                    ? "This application owns its source. Configuration is read-only here; inspect the source location and adapter coverage."
                    : `You are inspecting immutable run revision ${run?.graph.revision}. Switch to Graph to edit the current draft.`}
                </div>
              )}
              {node ? (
                <>
                  <div className="row spread">
                    <span className={`role-pill role-${node.role}`}>
                      {node.role}
                    </span>
                    {node.hidden && (
                      <span className="muted small">Hidden resource</span>
                    )}
                  </div>
                  {node.source && (
                    <div className="source-ref">
                      <FileCode2 size={14} />
                      <code>
                        {node.source.path}
                        {node.source.line ? `:${node.source.line}` : ""}
                      </code>
                    </div>
                  )}
                  <Field label="Name">
                    <input
                      value={node.label}
                      disabled={locked}
                      onChange={(e) => patchNode({ label: e.target.value })}
                    />
                  </Field>
                  <Field label="Role">
                    <select
                      value={node.role}
                      disabled={locked}
                      onChange={(e) =>
                        patchNode({ role: e.target.value as GraphNode["role"] })
                      }
                    >
                      {ROLES.map((r) => (
                        <option key={r}>{r}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Description">
                    <textarea
                      rows={2}
                      value={node.description || ""}
                      disabled={locked}
                      onChange={(e) =>
                        patchNode({ description: e.target.value })
                      }
                    />
                  </Field>
                  <Field label="System instructions">
                    <textarea
                      className="code-input"
                      rows={8}
                      value={node.prompt || ""}
                      placeholder="Describe the task, constraints and response shape."
                      disabled={locked}
                      onChange={(e) => patchNode({ prompt: e.target.value })}
                    />
                  </Field>
                  <JsonEditor
                    key={`${node.id}-schema-${locked}`}
                    label="Output schema"
                    value={node.schema || {}}
                    disabled={locked}
                    onSave={(schema) => patchNode({ schema })}
                  />
                  {(node.role === "tool" || node.code) && (
                    <>
                      <Field label="Tool implementation">
                        <select
                          value={node.tool || "code"}
                          disabled={locked}
                          onChange={(e) =>
                            patchNode({
                              tool: e.target.value as GraphNode["tool"],
                            })
                          }
                        >
                          <option value="uppercase">Uppercase text</option>
                          <option value="word-count">Word count</option>
                          <option value="json-format">Format JSON</option>
                          <option value="code">Isolated code</option>
                        </select>
                      </Field>
                      <Field
                        label="Code"
                        hint={
                          docker
                            ? "Docker is available for isolated code execution."
                            : "Docker is unavailable. Built-in tools still work; arbitrary code cannot run."
                        }
                      >
                        <textarea
                          rows={8}
                          className="code-input"
                          value={node.code || ""}
                          disabled={locked}
                          onChange={(e) => patchNode({ code: e.target.value })}
                        />
                      </Field>
                    </>
                  )}
                  {node.role === "guardrail" && (
                    <JsonEditor
                      key={`${node.id}-rules`}
                      label="Policy rules"
                      value={node.rules || { forbidden: [], required: [] }}
                      disabled={locked}
                      onSave={(rules) => patchNode({ rules })}
                    />
                  )}
                  <div className="inspector-related">
                    <span className="eyebrow">CONNECTIONS</span>
                    {graph.edges
                      .filter(
                        (e) => e.source === node.id || e.target === node.id,
                      )
                      .map((e) => (
                        <button
                          key={e.id}
                          onClick={() =>
                            setSelection({ type: "edge", id: e.id })
                          }
                        >
                          <GitBranch size={13} />
                          {e.label}
                          <ChevronRight size={12} />
                        </button>
                      ))}
                  </div>
                  {!locked && (
                    <button
                      className="text-button danger-text"
                      onClick={() => {
                        updateGraph((g) => ({
                          ...g,
                          nodes: g.nodes.filter((n) => n.id !== node.id),
                          edges: g.edges.filter(
                            (e) => e.source !== node.id && e.target !== node.id,
                          ),
                        }));
                        setSelection(null);
                      }}
                    >
                      <Trash2 size={13} /> Remove node
                    </button>
                  )}
                </>
              ) : selectedEdge ? (
                <>
                  <Field label="Label">
                    <input
                      value={selectedEdge.label}
                      disabled={locked}
                      onChange={(e) => patchEdge({ label: e.target.value })}
                    />
                  </Field>
                  <Field label="Relationship">
                    <select
                      value={selectedEdge.kind}
                      disabled={locked}
                      onChange={(e) =>
                        patchEdge({ kind: e.target.value as GraphEdge["kind"] })
                      }
                    >
                      <option value="data">Data flow</option>
                      <option value="feedback">Feedback / revision</option>
                      <option value="dependency">Dependency</option>
                    </select>
                  </Field>
                  <Field label="Instruction">
                    <textarea
                      rows={7}
                      value={selectedEdge.instruction || ""}
                      disabled={locked}
                      onChange={(e) =>
                        patchEdge({ instruction: e.target.value })
                      }
                    />
                  </Field>
                  <Field label="Input passed to target">
                    <select
                      value={selectedEdge.inputMapping || "previous"}
                      disabled={locked}
                      onChange={(e) =>
                        patchEdge({
                          inputMapping: e.target
                            .value as GraphEdge["inputMapping"],
                        })
                      }
                    >
                      <option value="previous">Previous node output</option>
                      <option value="original">Original request</option>
                      <option value="all">All preceding outputs</option>
                    </select>
                  </Field>
                  <div className="callout small">
                    Provenance: {selectedEdge.provenance || "declared"}.
                    Revision cycles are capped by the graph’s maximum revisions.
                  </div>
                  {!locked && (
                    <button
                      className="text-button danger-text"
                      onClick={() => {
                        updateGraph((g) => ({
                          ...g,
                          edges: g.edges.filter(
                            (e) => e.id !== selectedEdge.id,
                          ),
                        }));
                        setSelection(null);
                      }}
                    >
                      <Trash2 size={13} /> Remove connection
                    </button>
                  )}
                </>
              ) : null}
            </>
          ) : inspectorTab === "Output" ? (
            run ? (
              <>
                {invocations.length > 1 && (
                  <div className="invocations">
                    {invocations.map((e, i) => (
                      <button
                        key={e.id}
                        className={evt?.id === e.id ? "active" : ""}
                        onClick={() => setEventId(e.id)}
                      >
                        Attempt {e.invocation || i + 1}
                      </button>
                    ))}
                  </div>
                )}
                {evt ? (
                  <>
                    <div className="row spread">
                      <Status value={evt.type.replace("node.", "")} />
                      <span className="muted small">
                        {evt.latencyMs !== undefined
                          ? `${evt.latencyMs}ms`
                          : fmtDate(evt.time)}
                      </span>
                    </div>
                    <p className="muted small">
                      Recorded evidence · graph r{run.graph.revision}
                    </p>
                    <span className="eyebrow">INPUT</span>
                    <pre>
                      {evt.input || "No input captured for this event."}
                    </pre>
                    <span className="eyebrow">OUTPUT</span>
                    <pre>
                      {evt.output || evt.message || "No output captured yet."}
                    </pre>
                  </>
                ) : (
                  <Empty icon={Clock3} title="No invocation">
                    This node was not observed in the selected run.
                  </Empty>
                )}
              </>
            ) : (
              <Empty icon={Play} title="Run to see evidence">
                Real invocation inputs and outputs appear here after execution.
              </Empty>
            )
          ) : (
            <div className="event-list">
              {events.length ? (
                events.map((e) => (
                  <button
                    key={e.id}
                    onClick={() => {
                      setEventId(e.id);
                      setInspectorTab("Output");
                    }}
                  >
                    <span
                      className={`event-dot ${e.type.includes("failed") ? "failed" : ""}`}
                    />
                    <div>
                      <strong>{e.type.replaceAll(".", " · ")}</strong>
                      <small>
                        {e.message || `Invocation ${e.invocation || 1}`}
                      </small>
                    </div>
                    <time>{fmtDate(e.time)}</time>
                  </button>
                ))
              ) : (
                <p className="muted">No recorded activity for this node.</p>
              )}
            </div>
          )}
        </div>
        {inspectorTab === "Configuration" && !locked && (
          <div className="inspector-footer">
            <span className="muted small">
              {dirty ? "Unsaved draft changes" : `Revision ${graph.revision}`}
            </span>
            <button
              className="button primary small"
              disabled={!dirty || !!busy}
              onClick={() => act("Saving graph", saveGraph)}
            >
              Save changes
            </button>
          </div>
        )}
      </aside>
    );
  }
  function AlignmentView() {
    return (
      <div className="page-content align-page">
        <div className="page-intro">
          <span className="eyebrow">BUILD / ALIGN</span>
          <h1>Start with the outcome.</h1>
          <p>
            Describe who this is for, what it should do, and what a good result
            looks like. We’ll make the workflow explicit.
          </p>
        </div>
        <div className="align-grid">
          <section className="card brief-card">
            <div className="card-heading">
              <span className="number">01</span>
              <h3>Your application brief</h3>
            </div>
            <textarea
              className="brief-input"
              aria-label="Application brief"
              value={brief}
              onChange={(e) => setBrief(e.target.value)}
              placeholder="Build a support assistant that answers from approved knowledge, checks evidence, and escalates when it is unsure…"
            />
            <div className="brief-suggestions">
              {["Research & evidence", "Support triage", "Document review"].map(
                (label, i) => (
                  <button
                    key={label}
                    onClick={() =>
                      setBrief(
                        [
                          "Build a research assistant that gives concise answers, identifies uncertainty and checks that its claims follow from the supplied evidence.",
                          "Build a support triage assistant that classifies the issue, suggests a helpful response and escalates requests needing human review. Never promise a refund or claim an action was taken.",
                          "Build a document review assistant that summarizes supplied text, identifies missing information and returns structured recommendations.",
                        ][i],
                      )
                    }
                  >
                    {label}
                  </button>
                ),
              )}
            </div>
            <div className="card-footer">
              <span className="muted small">
                One real planning call · your selected model
              </span>
              <button
                className="button primary"
                disabled={!!busy || !brief.trim()}
                onClick={() =>
                  act("Drafting a plan", async () => {
                    requireConfig();
                    const a = await api<Alignment>(
                      `/projects/${projectId}/align`,
                      "POST",
                      { brief, config },
                    );
                    setAlignment(a);
                    setNotice(
                      "Plan ready. Review the assumptions and open questions before accepting.",
                    );
                    await refresh();
                  })
                }
              >
                {busy === "Drafting a plan" ? (
                  <Loader2 size={15} className="spin" />
                ) : (
                  <ArrowRight size={15} />
                )}{" "}
                Draft plan
              </button>
            </div>
          </section>
          <section className="alignment-result">
            {alignment ? (
              <>
                <div className="row spread">
                  <span className="eyebrow">PROPOSED PLAN</span>
                  <Status value="review" />
                </div>
                <h2>{alignment.summary}</h2>
                <dl className="definition-list">
                  <dt>For</dt>
                  <dd>{alignment.users}</dd>
                  <dt>Input</dt>
                  <dd>{alignment.input}</dd>
                  <dt>Output</dt>
                  <dd>{alignment.output}</dd>
                </dl>
                <h4>Success looks like</h4>
                <ul className="check-list">
                  {alignment.successCriteria.map((s, i) => (
                    <li key={i}>
                      <Check size={14} />
                      {s}
                    </li>
                  ))}
                </ul>
                {alignment.questions.length > 0 && (
                  <div className="callout">
                    <strong>Before you accept</strong>
                    <ul>
                      {alignment.questions.map((q, i) => (
                        <li key={i}>{q}</li>
                      ))}
                    </ul>
                    <small>
                      Add your answers to the brief, then draft the plan again.
                    </small>
                  </div>
                )}
                {alignment.assumptions.length > 0 && (
                  <details>
                    <summary>
                      Assumptions · {alignment.assumptions.length}
                    </summary>
                    <ul>
                      {alignment.assumptions.map((a, i) => (
                        <li key={i}>{a}</li>
                      ))}
                    </ul>
                  </details>
                )}
                <button
                  className="button primary"
                  disabled={!!busy}
                  onClick={() =>
                    act("Accepting plan", async () => {
                      const p = await api<Project>(
                        `/projects/${projectId}/accept`,
                        "POST",
                        { alignment },
                      );
                      syncProject(p);
                      setStep("Review");
                      setNotice(
                        "Plan accepted. Inspect and refine your application graph.",
                      );
                    })
                  }
                >
                  Accept & review graph <ArrowRight size={15} />
                </button>
              </>
            ) : (
              <>
                <span className="soft-icon">
                  <Workflow size={30} />
                </span>
                <h2>A plan you can inspect.</h2>
                <p className="muted">
                  The planner turns your goal into a small graph: agents, tools,
                  policies and explicit relationships. Nothing runs until you
                  choose to run it.
                </p>
                <div className="principles">
                  <div>
                    <CheckCircle2 size={17} />
                    <strong>Clear responsibilities</strong>
                    <span>Each node has one purpose.</span>
                  </div>
                  <div>
                    <GitBranch size={17} />
                    <strong>Explicit connections</strong>
                    <span>Follow the data and decision paths.</span>
                  </div>
                  <div>
                    <ShieldCheck size={17} />
                    <strong>Bounded execution</strong>
                    <span>Checks and limits belong in the graph.</span>
                  </div>
                </div>
              </>
            )}
          </section>
        </div>
      </div>
    );
  }
  function GraphWorkspace({ playground = false }: { playground?: boolean }) {
    return (
      <div className="workspace">
        <div className="workspace-main">
          {graphPanel}
          {playground && RunPanel()}
          {!playground && (
            <div className="graph-guidance">
              <div>
                <strong>
                  {isImported
                    ? "A map of the source, with coverage made explicit."
                    : "Less wiring. More control."}
                </strong>
                <p>
                  {isImported
                    ? "Inferred relationships describe source structure. Start an instrumented run to see the path actually taken."
                    : "Select a node to edit its instructions, schema or code. Drag between node handles to add a data connection."}
                </p>
              </div>
              {!isImported ? (
                <button
                  className="button"
                  onClick={() => setStep("Run & Test")}
                >
                  Try in playground <ArrowRight size={15} />
                </button>
              ) : (
                <button className="button" onClick={() => setStep("Observe")}>
                  Observe a run <ArrowRight size={15} />
                </button>
              )}
            </div>
          )}
        </div>
        {Inspector()}
      </div>
    );
  }
  function Limits() {
    if (!graph) return null;
    return (
      <div className="limits-grid">
        {(
          [
            { key: "maxCalls", label: "Model calls", min: 1, max: 40 },
            { key: "maxRevisions", label: "Revision attempts", min: 0, max: 5 },
            { key: "timeoutMs", label: "Timeout (ms)", min: 1000, max: 300000 },
            {
              key: "maxOutputTokens",
              label: "Output token limit",
              min: 128,
              max: 8192,
            },
          ] as const
        ).map((x) => (
          <Field key={x.key} label={x.label}>
            <input
              type="number"
              min={x.min}
              max={x.max}
              disabled={isImported}
              value={graph.limits[x.key]}
              onChange={(e) =>
                updateGraph((g) => ({
                  ...g,
                  limits: { ...g.limits, [x.key]: Number(e.target.value) },
                }))
              }
            />
          </Field>
        ))}
      </div>
    );
  }
  function Launch() {
    const passed = projectRuns.find(
      (r) => r.status === "completed" && r.graph.revision === graph?.revision,
    );
    return (
      <div className="page-content">
        <div className="page-intro">
          <span className="eyebrow">BUILD / LAUNCH</span>
          <h1>Your application. Your code.</h1>
          <p>
            Download the exact graph revision as a runnable local project.
            Hosted deployment comes later.
          </p>
        </div>
        <div className="launch-grid">
          <section className="card">
            <span className="soft-icon">
              <ArrowDownToLine size={25} />
            </span>
            <h2>Project export</h2>
            <p className="muted">
              Source, graph, prompts, runtime dependencies, tests and setup
              instructions. Credentials and private run data are excluded.
            </p>
            <div className="export-list">
              {[
                "Versioned application graph",
                "Node instructions and implementation",
                "Runnable local service and package manifest",
                "Setup README and environment template",
              ].map((s) => (
                <div key={s}>
                  <Check size={15} />
                  {s}
                </div>
              ))}
            </div>
            <div className="callout">
              {passed
                ? `A completed run exists for revision ${graph?.revision}. The export endpoint performs its own readiness checks.`
                : "Run the current graph successfully before exporting. This makes the code handoff reviewable."}
            </div>
            <button
              className="button primary"
              disabled={!!busy || !passed || dirty || isImported}
              onClick={() =>
                act("Preparing export", async () => {
                  const res = await fetch(`/api/projects/${projectId}/export`);
                  if (!res.ok) {
                    let e;
                    try {
                      e = await res.json();
                    } catch {
                      e = { error: "Export failed" };
                    }
                    throw new Error(e.message || e.error);
                  }
                  const blob = await res.blob();
                  const url = URL.createObjectURL(blob),
                    a = document.createElement("a");
                  a.href = url;
                  a.download = `${project?.name.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "agent-app"}.zip`;
                  a.click();
                  URL.revokeObjectURL(url);
                  setNotice(
                    "Project ZIP downloaded. Follow its README to configure fresh credentials and run locally.",
                  );
                })
              }
            >
              <ArrowDownToLine size={15} /> Download project ZIP
            </button>
            {isImported && (
              <p className="muted small">
                Connected repositories stay source-owned. Export is for
                applications created in this workbench.
              </p>
            )}
          </section>
          <section className="card">
            <span className="eyebrow">EXECUTION CONTRACT</span>
            <h2>Limits travel with the graph.</h2>
            <p className="muted">
              The local runtime enforces these values. Saving a change creates a
              new graph revision.
            </p>
            {Limits()}
            {dirty && (
              <button
                className="button"
                disabled={!!busy}
                onClick={() => act("Saving limits", saveGraph)}
              >
                Save limits
              </button>
            )}
            <div className="readiness">
              <div>
                <span>Current revision</span>
                <strong>r{graph?.revision}</strong>
              </div>
              <div>
                <span>Latest matching run</span>
                {passed ? (
                  <Status value="completed" />
                ) : (
                  <Status value="not tested" />
                )}
              </div>
              <div>
                <span>Code isolation</span>
                <strong>
                  {docker ? "Docker available" : "Docker unavailable"}
                </strong>
              </div>
              <div>
                <span>Delivery</span>
                <strong>Local project ZIP</strong>
              </div>
            </div>
          </section>
        </div>
      </div>
    );
  }
  function Connect() {
    if (step === "Map")
      return (
        <>
          <div className="coverage-bar">
            <GitBranch size={16} />
            <strong>
              {project?.repo?.adapter || "No repository connected"}
            </strong>
            <span>{project?.repo?.coverage.join(" · ")}</span>
            <button className="text-button" onClick={() => setStep("Connect")}>
              Coverage details
            </button>
          </div>
          {GraphWorkspace({})}
        </>
      );
    if (step === "Observe") return GraphWorkspace({ playground: true });
    if (step === "Diagnose")
      return (
        <div className="page-content">
          <div className="page-intro">
            <span className="eyebrow">CONNECT / DIAGNOSE</span>
            <h1>Start from the evidence.</h1>
            <p>
              Inspect a failed invocation and its source location. Imported code
              remains read-only.
            </p>
          </div>
          {projectRuns.length ? (
            <div className="diagnosis-grid">
              {projectRuns.map((r) => (
                <section className="card" key={r.id}>
                  <div className="row spread">
                    <Status value={r.status} />
                    <span className="muted small">
                      {fmtDate(r.createdAt)} · r{r.graph.revision}
                    </span>
                  </div>
                  <h3>{r.input.slice(0, 110)}</h3>
                  <p className="muted">
                    {r.error ||
                      `${r.events.length} recorded events. Inspect individual node inputs and outputs.`}
                  </p>
                  {r.events
                    .filter(
                      (e) =>
                        e.type === "node.failed" || e.type === "node.blocked",
                    )
                    .map((e) => {
                      const n = r.graph.nodes.find((n) => n.id === e.nodeId);
                      return (
                        <div className="finding-snippet" key={e.id}>
                          <strong>{n?.label || e.nodeId}</strong>
                          <p>{e.message || e.output}</p>
                          {n?.source && (
                            <code>
                              {n.source.path}:{n.source.line}
                            </code>
                          )}
                        </div>
                      );
                    })}
                  <button
                    className="button small"
                    onClick={() => {
                      inspectRun(r);
                      setStep("Observe");
                    }}
                  >
                    Inspect trace <ArrowRight size={13} />
                  </button>
                </section>
              ))}
            </div>
          ) : (
            <Empty
              icon={GitBranch}
              title="No execution evidence yet"
              action={
                <button className="button" onClick={() => setStep("Observe")}>
                  Open Observe
                </button>
              }
            >
              Connect a compatible repository and run a bounded test before
              diagnosing its behavior.
            </Empty>
          )}
        </div>
      );
    return (
      <div className="page-content">
        <div className="page-intro">
          <span className="eyebrow">CONNECT & DEBUG</span>
          <h1>Bring the app you already have.</h1>
          <p>
            Map its source, understand adapter coverage, then observe a real
            execution. Your code remains yours.
          </p>
        </div>
        <div className="connect-grid">
          <section className="card">
            <div className="card-heading">
              <GitBranch size={20} />
              <h3>Local repository</h3>
            </div>
            <Field
              label="Checkout path"
              hint="Use a local checkout, or a supported GitHub repository URL. Private repositories require existing local access."
            >
              <input
                placeholder="/path/to/your/repository"
                value={repoPath}
                onChange={(e) => setRepoPath(e.target.value)}
              />
            </Field>
            {repoDefault && repoPath !== repoDefault && (
              <button
                className="text-button"
                onClick={() => setRepoPath(repoDefault)}
              >
                Use Learning Studio checkout
              </button>
            )}
            <button
              className="button primary"
              disabled={!!busy || !repoPath.trim()}
              onClick={() =>
                act("Mapping repository", async () => {
                  const p = await api<Project>("/repos/connect", "POST", {
                    path: repoPath,
                  });
                  syncProject(p);
                  setStep("Map");
                  setNotice(
                    "Source map created. Review coverage before observing a live run.",
                  );
                })
              }
            >
              Connect & map <ArrowRight size={15} />
            </button>
            <div className="callout small">
              Source discovery is separate from live instrumentation. Unknown
              paths remain opaque rather than becoming invented execution edges.
            </div>
          </section>
          <section className="card">
            <span className="eyebrow">ADAPTER COVERAGE</span>
            <h3>{project?.repo?.name || "What you can expect"}</h3>
            {project?.repo ? (
              <>
                <div className="source-ref">
                  <FileCode2 size={14} />
                  <code>{project.repo.path}</code>
                </div>
                <div className="row spread">
                  <span className="muted">Pinned revision</span>
                  <code>{project.repo.revision.slice(0, 12)}</code>
                </div>
                <h4>Covered paths</h4>
                <ul className="check-list">
                  {project.repo.coverage.map((x, i) => (
                    <li key={i}>
                      <Check size={14} />
                      {x}
                    </li>
                  ))}
                </ul>
                <h4>Limits of this integration</h4>
                <ul className="plain-list">
                  {project.repo.limitations.map((x, i) => (
                    <li key={i}>{x}</li>
                  ))}
                </ul>
                <button className="button" onClick={() => setStep("Map")}>
                  Open source map <ArrowRight size={14} />
                </button>
              </>
            ) : (
              <>
                <div className="coverage-item">
                  <span className="dot" />
                  <div>
                    <strong>Source map</strong>
                    <p>
                      Workflow entry points and supporting files, linked back to
                      source.
                    </p>
                  </div>
                </div>
                <div className="coverage-item">
                  <span className="dot purple" />
                  <div>
                    <strong>Real traces where supported</strong>
                    <p>
                      Learning Studio is the first adapter. Its overview and
                      build paths have distinct coverage.
                    </p>
                  </div>
                </div>
                <div className="coverage-item">
                  <CircleHelp size={15} />
                  <div>
                    <strong>Visible limitations</strong>
                    <p>
                      Unsupported behavior is labelled as discovery-only.
                      Credentials do not create instrumentation.
                    </p>
                  </div>
                </div>
              </>
            )}
          </section>
        </div>
      </div>
    );
  }
  function RedTeam() {
    const plans = data.redPlans.filter((p) => p.projectId === projectId);
    return (
      <div className="page-content">
        <div className="page-intro horizontal">
          <div>
            <span className="eyebrow">RED TEAM / {step.toUpperCase()}</span>
            <h1>
              {step === "Scope"
                ? "Test the boundaries."
                : step === "Test Plan"
                  ? "Review the probes."
                  : step === "Run"
                    ? "A controlled examination."
                    : "Findings with evidence."}
            </h1>
            <p>
              Bounded source review and behavioral testing against your local
              application.
            </p>
          </div>
          {plans.length > 0 && (
            <select
              aria-label="Red team plan"
              value={redId}
              onChange={(e) => setRedId(e.target.value)}
            >
              <option value="">Select a plan</option>
              {plans.map((p) => (
                <option key={p.id} value={p.id}>
                  {fmtDate(p.createdAt)} · {p.status} · {p.probes.length} probes
                </option>
              ))}
            </select>
          )}
        </div>
        {step === "Scope" ? (
          <div className="two-column">
            <section className="card">
              <Field
                label="Permitted target scope"
                hint="Use isolated test identities and storage, with billing disabled."
              >
                <select
                  value={redScope}
                  onChange={(e) => setRedScope(e.target.value)}
                >
                  <option value="local-test">Local test application</option>
                  <option value="owned-staging">
                    Owned, isolated staging application
                  </option>
                </select>
              </Field>
              <Field label="Brand and behavior rules">
                <textarea
                  rows={5}
                  value={brandRules}
                  onChange={(e) => setBrandRules(e.target.value)}
                />
              </Field>
              <Field label="Maximum behavioral probes">
                <input
                  type="number"
                  min={1}
                  max={6}
                  value={maxProbes}
                  onChange={(e) =>
                    setMaxProbes(
                      Math.max(1, Math.min(6, Number(e.target.value))),
                    )
                  }
                />
              </Field>
              <button
                className="button primary"
                disabled={!!busy}
                onClick={() =>
                  act("Preparing test plan", async () => {
                    requireConfig();
                    const p = await api<RedPlan>("/redteam/plan", "POST", {
                      projectId,
                      scope: redScope,
                      brandRules,
                      maxProbes,
                      config,
                    });
                    setData((d) => ({
                      ...d,
                      redPlans: [p, ...d.redPlans.filter((x) => x.id !== p.id)],
                    }));
                    setRedId(p.id);
                    setStep("Test Plan");
                    setConfirmed(false);
                  })
                }
              >
                Propose test plan <ArrowRight size={15} />
              </button>
            </section>
            <section className="card calm">
              <ShieldCheck size={26} />
              <h2>A test plan before a test run.</h2>
              <p>
                Specialists examine security, injection resistance, brand
                behavior and user experience. You review the actual probes
                before they execute.
              </p>
              <ul className="check-list">
                <li>
                  <Check size={14} />
                  Local or isolated test target
                </li>
                <li>
                  <Check size={14} />
                  Synthetic inputs and bounded calls
                </li>
                <li>
                  <Check size={14} />
                  Reproduced findings separate from suspicions
                </li>
                <li>
                  <Check size={14} />
                  Preserved inputs, outputs and trace evidence
                </li>
              </ul>
              <div className="callout small">
                For imported apps, inference coverage follows the adapter.
                Source-only findings are never presented as reproduced failures.
              </div>
            </section>
          </div>
        ) : !red ? (
          <Empty
            icon={ShieldCheck}
            title="Start with a scoped plan"
            action={
              <button className="button" onClick={() => setStep("Scope")}>
                Define scope
              </button>
            }
          >
            There is no selected red-team plan. Describe what may be tested
            first.
          </Empty>
        ) : step === "Test Plan" || step === "Run" ? (
          <>
            <div className="summary-strip">
              <div>
                <span>Target</span>
                <strong>{project?.name}</strong>
              </div>
              <div>
                <span>Probe cap</span>
                <strong>{red.maxProbes}</strong>
              </div>
              <div>
                <span>Status</span>
                <Status value={red.status} />
              </div>
              <div>
                <span>Scope</span>
                <strong>
                  {red.target === "import"
                    ? "Connected application"
                    : "Manifest application"}
                </strong>
              </div>
            </div>
            <div className="probe-grid">
              {red.probes.map((p, i) => (
                <section className="card" key={p.id}>
                  <span className="eyebrow">
                    {String(i + 1).padStart(2, "0")} / {p.specialist}
                  </span>
                  <h3>{p.description}</h3>
                  <pre>{p.input}</pre>
                  <p className="muted small">
                    <strong>Failure signal:</strong>{" "}
                    {p.forbidden || "Evaluated from evidence"}
                  </p>
                </section>
              ))}
            </div>
            <div className="action-card">
              <div>
                <h3>
                  {red.status === "completed"
                    ? "Test evidence is ready"
                    : red.status === "running"
                      ? "Testing in progress"
                      : "Ready to run these probes?"}
                </h3>
                {red.status === "proposed" && (
                  <label className="checkbox">
                    <input
                      type="checkbox"
                      checked={confirmed}
                      onChange={(e) => setConfirmed(e.target.checked)}
                    />
                    I approve this finite plan against my isolated local/test
                    application.
                  </label>
                )}
                {red.status === "running" && (
                  <p className="muted">
                    Results appear as probes finish. You can inspect the
                    underlying runs.
                  </p>
                )}
              </div>
              {red.status === "completed" ? (
                <button
                  className="button primary"
                  onClick={() => setStep("Findings")}
                >
                  Review findings <ArrowRight size={14} />
                </button>
              ) : (
                <button
                  className="button primary"
                  disabled={!!busy || !confirmed || red.status === "running"}
                  onClick={() =>
                    act("Starting red team", async () => {
                      const p = await api<RedPlan>(
                        `/redteam/${red.id}/run`,
                        "POST",
                        { config: requireConfig(), confirmed: true },
                      );
                      setData((d) => ({
                        ...d,
                        redPlans: [
                          p,
                          ...d.redPlans.filter((x) => x.id !== p.id),
                        ],
                      }));
                      setStep("Run");
                      await refresh();
                    })
                  }
                >
                  {red.status === "running" ? (
                    <Loader2 size={15} className="spin" />
                  ) : (
                    <Play size={15} />
                  )}{" "}
                  Run approved plan
                </button>
              )}
            </div>
          </>
        ) : (
          <>
            {red.status !== "completed" && (
              <div className="callout">
                {red.status === "running"
                  ? "Testing is still in progress. Findings may be partial."
                  : "This plan has not been executed yet."}
              </div>
            )}
            {red.findings.length ? (
              <div className="findings-list">
                {red.findings.map((f) => (
                  <section className="card finding-card" key={f.id}>
                    <div className="row spread">
                      <span className={`severity ${f.severity}`}>
                        {f.severity} severity
                      </span>
                      <Status value={f.evidenceType} />
                    </div>
                    <h3>{f.title}</h3>
                    <p>{f.description}</p>
                    {f.source && (
                      <div className="source-ref">
                        <FileCode2 size={14} />
                        <code>
                          {f.source.path}:{f.source.line}
                        </code>
                      </div>
                    )}
                    {f.input && (
                      <details>
                        <summary>Reproduction input</summary>
                        <pre>{f.input}</pre>
                      </details>
                    )}
                    <div className="row">
                      {f.runId && (
                        <button
                          className="button small"
                          onClick={() => {
                            const r = data.runs.find((r) => r.id === f.runId);
                            if (r) {
                              inspectRun(r);
                              navigate(
                                isImported ? "connect" : "build",
                                isImported ? "Observe" : "Run & Test",
                              );
                            }
                          }}
                        >
                          Inspect trace <ArrowUpRight size={13} />
                        </button>
                      )}
                      {f.input && (
                        <button
                          className="button small"
                          onClick={() => promoteCase(f.input!, "", f.runId)}
                        >
                          Create regression case
                        </button>
                      )}
                    </div>
                  </section>
                ))}
              </div>
            ) : (
              <Empty
                icon={ShieldCheck}
                title={
                  red.status === "completed"
                    ? "No findings were returned"
                    : "No findings yet"
                }
              >
                A completed probe plan and its evidence will appear here. An
                empty report is not proof of complete safety.
              </Empty>
            )}
          </>
        )}
      </div>
    );
  }
  function ModelLab() {
    const comps = data.comparisons.filter((c) => c.projectId === projectId);
    if (step === "Graph Results")
      return (
        <>
          <div className="candidate-bar">
            <span className="eyebrow">CANDIDATE TRACE</span>
            {comparison?.slots.map((s) => (
              <button
                key={s.id}
                className={`button small ${s.runId === runId ? "active" : ""}`}
                disabled={!s.runId}
                onClick={() => {
                  const r = data.runs.find((r) => r.id === s.runId);
                  if (r) inspectRun(r);
                }}
              >
                {s.label}
                {s.error && " · error"}
              </button>
            ))}
            {!comparison && (
              <span className="muted">
                Run a comparison to inspect candidate graphs.
              </span>
            )}
          </div>
          {GraphWorkspace({ playground: false })}
        </>
      );
    return (
      <div className="page-content">
        <div className="page-intro horizontal">
          <div>
            <span className="eyebrow">MODEL LAB / {step.toUpperCase()}</span>
            <h1>
              {step === "Configure"
                ? "Make the comparison fair."
                : "Different models. Shared evidence."}
            </h1>
            <p>
              Up to five candidates. Isolated run state. Provider fallback stays
              off.
            </p>
          </div>
          {comps.length > 0 && (
            <select
              aria-label="Comparison"
              value={comparisonId}
              onChange={(e) => {
                setComparisonId(e.target.value);
                setStep("Compare");
              }}
            >
              <option value="">Select comparison</option>
              {comps.map((c) => (
                <option key={c.id} value={c.id}>
                  {fmtDate(c.createdAt)} · {c.slots.length} candidates ·{" "}
                  {c.strategy}
                </option>
              ))}
            </select>
          )}
        </div>
        {step === "Configure" ? (
          <>
            <div className="comparison-setup">
              <section className="card">
                <Field label="Experiment">
                  <select
                    value={strategy}
                    onChange={(e) =>
                      setStrategy(e.target.value as "node" | "workflow")
                    }
                  >
                    <option value="workflow">
                      Complete workflow · independent downstream paths
                    </option>
                    <option value="node">
                      Fixed-input node · identical input per candidate
                    </option>
                  </select>
                </Field>
                {strategy === "node" && (
                  <Field label="Model node to compare">
                    <select
                      value={compareNode}
                      onChange={(e) => setCompareNode(e.target.value)}
                    >
                      <option value="">Select node</option>
                      {graph?.nodes
                        .filter((n) =>
                          ["agent", "orchestrator", "validator"].includes(
                            n.role,
                          ),
                        )
                        .map((n) => (
                          <option
                            key={n.id}
                            value={n.id}
                            disabled={n.modelFixed}
                          >
                            {n.label}
                            {n.modelFixed ? " · fixed model" : ""}
                          </option>
                        ))}
                    </select>
                  </Field>
                )}
                <Field label="Shared input">
                  <textarea
                    rows={5}
                    value={input}
                    placeholder="The exact input each candidate starts with…"
                    onChange={(e) => setInput(e.target.value)}
                  />
                </Field>
                <p className="muted small">
                  {strategy === "workflow"
                    ? "Complete workflows can take different downstream paths. Compare the resulting behavior, not just the final text."
                    : "The selected node receives the same captured input. This is a narrower comparison of one responsibility."}
                </p>
                {graph?.nodes.some((n) => n.modelFixed) && (
                  <div className="callout small">
                    Fixed calls remain pinned:{" "}
                    {graph.nodes
                      .filter((n) => n.modelFixed)
                      .map((n) => n.label)
                      .join(", ")}
                  </div>
                )}
              </section>
              <section className="card">
                <div className="row spread">
                  <h3>
                    Candidates <span className="count">{slots.length} / 5</span>
                  </h3>
                  <button
                    className="button small"
                    disabled={slots.length >= 5}
                    onClick={() =>
                      setSlots((s) => [
                        ...s,
                        {
                          id: uid(),
                          label: `Candidate ${s.length + 1}`,
                          config: { ...config },
                        },
                      ])
                    }
                  >
                    <Plus size={14} /> Add
                  </button>
                </div>
                {slots.length === 0 ? (
                  <Empty
                    icon={FlaskConical}
                    title="Choose your candidates"
                    action={
                      <button
                        className="button"
                        onClick={() =>
                          setSlots([
                            {
                              id: uid(),
                              label: "Candidate A",
                              config: { ...config },
                            },
                            {
                              id: uid(),
                              label: "Candidate B",
                              config: { ...config },
                            },
                          ])
                        }
                      >
                        Start with two slots
                      </button>
                    }
                  >
                    A provider credential can be reused across its compatible
                    models.
                  </Empty>
                ) : (
                  slots.map((s, i) => (
                    <div className="candidate-editor" key={s.id}>
                      <div className="row">
                        <span className="candidate-index">
                          {String.fromCharCode(65 + i)}
                        </span>
                        <input
                          aria-label={`Candidate ${i + 1} label`}
                          value={s.label}
                          onChange={(e) =>
                            setSlots((sl) =>
                              sl.map((x) =>
                                x.id === s.id
                                  ? { ...x, label: e.target.value }
                                  : x,
                              ),
                            )
                          }
                        />
                        <button
                          className="icon-button"
                          aria-label={`Remove ${s.label}`}
                          onClick={() =>
                            setSlots((sl) => sl.filter((x) => x.id !== s.id))
                          }
                        >
                          <X size={15} />
                        </button>
                      </div>
                      {ModelFields({
                        value: s.config,
                        onChange: (c) =>
                          setSlots((sl) =>
                            sl.map((x) =>
                              x.id === s.id ? { ...x, config: c } : x,
                            ),
                          ),
                        compact: true,
                      })}
                    </div>
                  ))
                )}
              </section>
            </div>
            <div className="action-card">
              <div>
                <strong>
                  A comparison is an experiment, not a leaderboard.
                </strong>
                <p className="muted small">
                  One failed candidate keeps its error; successful results
                  remain available. Calls share the workbench’s execution
                  limits.
                </p>
              </div>
              <button
                className="button primary"
                disabled={!!busy || !slots.length || !input.trim() || dirty}
                onClick={() =>
                  act("Starting comparison", async () => {
                    if (strategy === "node" && !compareNode)
                      throw new Error(
                        "Select a model node for fixed-input comparison.",
                      );
                    slots.forEach((s) => requireConfig(s.config));
                    const c = await api<Comparison>("/comparisons", "POST", {
                      projectId,
                      input,
                      strategy,
                      nodeId: strategy === "node" ? compareNode : undefined,
                      slots: slots.map(({ label, config }) => ({
                        label,
                        config,
                      })),
                    });
                    setData((d) => ({
                      ...d,
                      comparisons: [c, ...d.comparisons],
                    }));
                    setComparisonId(c.id);
                    setStep("Compare");
                    await refresh();
                  })
                }
              >
                <Play size={15} /> Run comparison
              </button>
            </div>
          </>
        ) : !comparison ? (
          <Empty
            icon={FlaskConical}
            title="No comparison selected"
            action={
              <button className="button" onClick={() => setStep("Configure")}>
                Configure candidates
              </button>
            }
          >
            Choose candidate models and a shared input to start.
          </Empty>
        ) : (
          <>
            <div className="comparison-context">
              <span className="eyebrow">
                {comparison.strategy === "node"
                  ? "FIXED-INPUT NODE"
                  : "COMPLETE WORKFLOW"}
              </span>
              <p>{comparison.input}</p>
            </div>
            <div className="comparison-results">
              {comparison.slots.map((s, i) => {
                const r = data.runs.find((r) => r.id === s.runId);
                return (
                  <section className="card candidate-result" key={s.id}>
                    <div className="row spread">
                      <span className="candidate-index">
                        {String.fromCharCode(65 + i)}
                      </span>
                      <Status
                        value={s.error ? "error" : r?.status || "queued"}
                      />
                    </div>
                    <h3>{s.label}</h3>
                    <code className="model-name">{s.config.model}</code>
                    <div className="candidate-answer">
                      {s.error ||
                        r?.output ||
                        r?.error ||
                        (r
                          ? "Execution is in progress."
                          : "Waiting for run details.")}
                    </div>
                    <div className="metrics">
                      <div>
                        <span>Elapsed</span>
                        <strong>{r ? duration(r) : "—"}</strong>
                      </div>
                      <div>
                        <span>Tokens</span>
                        <strong>
                          {r ? r.usage.inputTokens + r.usage.outputTokens : "—"}
                        </strong>
                      </div>
                      <div>
                        <span>Est. cost</span>
                        <strong>
                          {r?.usage.estimatedCostUsd !== undefined
                            ? `$${r.usage.estimatedCostUsd.toFixed(4)}`
                            : "Unavailable"}
                        </strong>
                      </div>
                    </div>
                    <button
                      className="button small"
                      disabled={!r}
                      onClick={() => {
                        if (r) {
                          inspectRun(r);
                          setStep("Graph Results");
                        }
                      }}
                    >
                      Inspect graph <ArrowUpRight size={13} />
                    </button>
                  </section>
                );
              })}
            </div>
          </>
        )}
      </div>
    );
  }
  function loadSuite(id: string) {
    setSuiteId(id);
    const s = data.suites.find((x) => x.id === id);
    if (s) {
      setSuiteName(s.name);
      setCasesText(pretty(s.cases));
      setJudgeEnabled(!!s.judge);
      setRubric(s.judge?.rubric || rubric);
    }
  }
  async function saveSuite() {
    let cases: EvalCase[];
    try {
      cases = JSON.parse(casesText);
    } catch {
      throw new Error("Cases must be valid JSON.");
    }
    if (!Array.isArray(cases) || !cases.length)
      throw new Error("Add at least one evaluation case.");
    const s = await api<EvalSuite>(
      suiteId ? `/suites/${suiteId}` : "/suites",
      suiteId ? "PUT" : "POST",
      {
        projectId,
        name: suiteName,
        cases,
        judge: judgeEnabled ? { rubric, config: requireConfig() } : undefined,
      },
    );
    setData((d) => ({
      ...d,
      suites: [s, ...d.suites.filter((x) => x.id !== s.id)],
    }));
    setSuiteId(s.id);
    setNotice(`Saved ${s.name}, version ${s.version}.`);
    return s;
  }
  function Evals() {
    let parsed: EvalCase[] = [];
    try {
      const p = JSON.parse(casesText);
      if (Array.isArray(p)) parsed = p;
    } catch {}
    return (
      <div className="page-content">
        <div className="page-intro horizontal">
          <div>
            <span className="eyebrow">EVALS / {step.toUpperCase()}</span>
            <h1>
              {step === "Dataset"
                ? "Define what good looks like."
                : step === "Criteria"
                  ? "Make the criteria explicit."
                  : step === "Run"
                    ? "A repeatable test of behavior."
                    : "Track behavior, not impressions."}
            </h1>
            <p>
              Versioned cases, clear verdicts, and a trace behind every result.
            </p>
          </div>
          <select
            aria-label="Evaluation suite"
            value={suiteId}
            onChange={(e) => loadSuite(e.target.value)}
          >
            <option value="">New suite</option>
            {projectSuites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} · v{s.version}
              </option>
            ))}
          </select>
        </div>
        {step === "Dataset" || step === "Criteria" ? (
          <div className="eval-editor-grid">
            <section className="card">
              <Field label="Suite name">
                <input
                  value={suiteName}
                  onChange={(e) => setSuiteName(e.target.value)}
                />
              </Field>
              <div className="row spread">
                <h3>
                  {step === "Criteria" ? "Cases & assertions" : "Dataset"}{" "}
                  <span className="count">{parsed.length} cases</span>
                </h3>
                <label className="button small file-button">
                  <ArrowDownToLine size={13} /> Import JSON
                  <input
                    type="file"
                    accept="application/json,.json"
                    onChange={async (e) => {
                      const f = e.target.files?.[0];
                      if (f) {
                        try {
                          const text = await f.text();
                          const obj = JSON.parse(text);
                          setCasesText(
                            pretty(Array.isArray(obj) ? obj : obj.cases),
                          );
                          setNotice(
                            "Dataset loaded into the draft. Review it before saving.",
                          );
                        } catch {
                          setError(
                            "Could not import dataset. Choose a JSON array of evaluation cases.",
                          );
                        }
                      }
                    }}
                  />
                </label>
              </div>
              <textarea
                className="code-input case-editor"
                aria-label="Evaluation cases JSON"
                value={casesText}
                onChange={(e) => setCasesText(e.target.value)}
              />
              <div className="row spread">
                <span className="muted small">
                  Each case: id, input, expected, assertions[]
                </span>
                <button
                  className="button small"
                  onClick={() => {
                    setCasesText(
                      pretty([
                        ...parsed,
                        {
                          id: `case-${parsed.length + 1}`,
                          input: "",
                          expected: "",
                          assertions: [],
                        },
                      ]),
                    );
                  }}
                >
                  <Plus size={13} /> Add case
                </button>
              </div>
              <button
                className="button primary"
                disabled={!!busy}
                onClick={() =>
                  act("Saving evaluation suite", async () => {
                    await saveSuite();
                    setStep(step === "Dataset" ? "Criteria" : "Run");
                  })
                }
              >
                Save version & continue <ArrowRight size={14} />
              </button>
            </section>
            <section className="card">
              <span className="eyebrow">EVALUATION POLICY</span>
              <h3>Deterministic first. Judge when needed.</h3>
              <p className="muted">
                Assertions support <code>contains</code>,{" "}
                <code>not-contains</code>, <code>regex</code>, <code>json</code>{" "}
                and <code>max-length</code>. Each uses a string{" "}
                <code>value</code>.
              </p>
              <div className="callout small">
                An expected response is context for the judge. Add deterministic
                assertions or enable a judge to score behavior; otherwise cases
                can remain unscored.
              </div>
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={judgeEnabled}
                  onChange={(e) => setJudgeEnabled(e.target.checked)}
                />
                Use a model judge
              </label>
              {judgeEnabled && (
                <>
                  <Field label="Judge rubric">
                    <textarea
                      rows={7}
                      value={rubric}
                      onChange={(e) => setRubric(e.target.value)}
                    />
                  </Field>
                  <p className="muted small">
                    Judge uses the selected workbench model (
                    {config.model || "not configured"}). Judge calls count
                    toward the shared execution budget.
                  </p>
                </>
              )}
              <h4>Verdicts mean different things</h4>
              <div className="verdict-guide">
                <p>
                  <Status value="pass" /> The configured checks passed.
                </p>
                <p>
                  <Status value="fail" /> Execution completed; a check failed.
                </p>
                <p>
                  <Status value="error" /> Infrastructure or execution prevented
                  scoring.
                </p>
                <p>
                  <Status value="unscored" /> No applicable scoring criteria.
                </p>
              </div>
            </section>
          </div>
        ) : step === "Run" ? (
          <div className="two-column">
            <section className="card">
              <h2>
                {data.suites.find((s) => s.id === suiteId)?.name ||
                  "Choose a saved suite"}
              </h2>
              <p className="muted">
                A run pins the suite version, graph revision and model
                configuration. Earlier reports remain unchanged.
              </p>
              <div className="readiness">
                <div>
                  <span>Cases</span>
                  <strong>
                    {data.suites.find((s) => s.id === suiteId)?.cases.length ||
                      0}
                  </strong>
                </div>
                <div>
                  <span>Graph revision</span>
                  <strong>r{graph?.revision}</strong>
                </div>
                <div>
                  <span>Model</span>
                  <strong>{config.model || "Not selected"}</strong>
                </div>
              </div>
              <Field label="Compare against baseline">
                <select
                  value={baselineId}
                  onChange={(e) => setBaselineId(e.target.value)}
                >
                  <option value="">No baseline</option>
                  {projectReports
                    .filter((r) => r.status === "completed")
                    .map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.suite.name} v{r.suite.version} · r{r.graphRevision} ·{" "}
                        {fmtDate(r.createdAt)}
                      </option>
                    ))}
                </select>
              </Field>
              <button
                className="button primary"
                disabled={!!busy || !suiteId || dirty}
                onClick={() =>
                  act("Starting evaluation", async () => {
                    const r = await api<EvalReport>(
                      `/suites/${suiteId}/run`,
                      "POST",
                      {
                        config: requireConfig(),
                        baselineId: baselineId || undefined,
                      },
                    );
                    setData((d) => ({ ...d, reports: [r, ...d.reports] }));
                    setReportId(r.id);
                    setStep("Results");
                    await refresh();
                  })
                }
              >
                <Play size={15} /> Run suite
              </button>
            </section>
            <section className="card calm">
              <CheckCircle2 size={26} />
              <h2>Keep the failure that taught you something.</h2>
              <p>
                Promote a run or red-team finding into a case. Set its expected
                behavior, then use a baseline to catch the next regression.
              </p>
              <button className="button" onClick={() => setStep("Dataset")}>
                Review dataset
              </button>
            </section>
          </div>
        ) : (
          <>
            <div className="row spread section-header">
              <select
                aria-label="Evaluation report"
                value={reportId}
                onChange={(e) => setReportId(e.target.value)}
              >
                <option value="">Select report</option>
                {projectReports.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.suite.name} · v{r.suite.version} · {fmtDate(r.createdAt)}{" "}
                    · {r.status}
                  </option>
                ))}
              </select>
              {report && <Status value={report.status} />}
            </div>
            {!report ? (
              <Empty
                icon={CheckCircle2}
                title="No report selected"
                action={
                  <button className="button" onClick={() => setStep("Run")}>
                    Run a suite
                  </button>
                }
              >
                Completed and partial results will appear here, with their
                immutable suite version.
              </Empty>
            ) : (
              <>
                <div className="summary-strip">
                  <div>
                    <span>Suite</span>
                    <strong>
                      {report.suite.name} v{report.suite.version}
                    </strong>
                  </div>
                  <div>
                    <span>Graph</span>
                    <strong>r{report.graphRevision}</strong>
                  </div>
                  <div>
                    <span>Passed</span>
                    <strong>
                      {
                        report.results.filter((r) => r.verdict === "pass")
                          .length
                      }{" "}
                      / {report.results.length}
                    </strong>
                  </div>
                  <div>
                    <span>Regressions</span>
                    <strong>
                      {report.results.filter((r) => r.regression).length}
                    </strong>
                  </div>
                </div>
                <div className="eval-results">
                  {report.results.map((result) => {
                    const c = report.suite.cases.find(
                      (c) => c.id === result.caseId,
                    );
                    return (
                      <section className="card eval-result" key={result.caseId}>
                        <div className="row spread">
                          <div className="row">
                            <Status value={result.verdict} />
                            {result.regression && (
                              <span className="severity high">Regression</span>
                            )}
                          </div>
                          <code>{result.caseId}</code>
                        </div>
                        <h3>{c?.input || result.caseId}</h3>
                        <p className="muted">
                          Expected:{" "}
                          {c?.expected || "See deterministic assertions"}
                        </p>
                        <ul>
                          {result.reasons.map((r, i) => (
                            <li key={i}>{r}</li>
                          ))}
                        </ul>
                        {result.runId && (
                          <button
                            className="button small"
                            onClick={() => {
                              const r = data.runs.find(
                                (r) => r.id === result.runId,
                              );
                              if (r) {
                                inspectRun(r);
                                navigate(
                                  isImported ? "connect" : "build",
                                  isImported ? "Observe" : "Run & Test",
                                );
                              }
                            }}
                          >
                            Inspect case trace <ArrowUpRight size={13} />
                          </button>
                        )}
                      </section>
                    );
                  })}
                </div>
              </>
            )}
          </>
        )}
      </div>
    );
  }
  const graphStep =
    (mode === "build" && ["Review", "Run & Test"].includes(step)) ||
    (mode === "connect" && ["Map", "Observe"].includes(step)) ||
    (mode === "models" && step === "Graph Results");
  const content = booting ? (
    <div className="loading-page">
      <Loader2 size={25} className="spin" />
      <p>Opening your workbench…</p>
    </div>
  ) : !project && mode !== "connect" ? (
    <div className="welcome">
      <span className="soft-icon">
        <Workflow size={33} />
      </span>
      <span className="eyebrow">AGENT WORKBENCH</span>
      <h1>
        Build with intent.
        <br />
        Understand every step.
      </h1>
      <p>
        A workspace for creating, testing and improving agentic applications.
        Start with an idea, or bring an application you already have.
      </p>
      <div className="row">
        <button className="button primary" onClick={() => setNewModal(true)}>
          <Plus size={16} /> Create a project
        </button>
        <button className="button" onClick={() => navigate("connect")}>
          Connect existing app <ArrowRight size={15} />
        </button>
      </div>
      <div className="welcome-features">
        <div>
          <Blocks />
          <strong>Design the system</strong>
          <p>Readable graphs, precise instructions.</p>
        </div>
        <div>
          <FlaskConical />
          <strong>Test the behavior</strong>
          <p>Real runs, model comparisons and evals.</p>
        </div>
        <div>
          <Code2 />
          <strong>Keep control</strong>
          <p>Your code, credentials and execution.</p>
        </div>
      </div>
    </div>
  ) : mode === "build" && isImported ? (
    <div className="page-content">
      <Empty
        icon={GitBranch}
        title="This application is source-owned."
        action={
          <div className="row">
            <button
              className="button primary"
              onClick={() => navigate("connect", "Map")}
            >
              Open source map <ArrowRight size={14} />
            </button>
            <button className="button" onClick={() => setNewModal(true)}>
              Create a new application
            </button>
          </div>
        }
      >
        Use Connect & Debug to inspect the imported graph and observe supported
        paths. Build generates a new application and does not rewrite your
        existing repository.
      </Empty>
    </div>
  ) : mode === "build" ? (
    step === "Align" ? (
      AlignmentView()
    ) : step === "Launch" ? (
      Launch()
    ) : (
      GraphWorkspace({ playground: step === "Run & Test" })
    )
  ) : mode === "connect" ? (
    Connect()
  ) : mode === "redteam" ? (
    RedTeam()
  ) : mode === "models" ? (
    ModelLab()
  ) : (
    Evals()
  );
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            navigate("build");
          }}
        >
          <span className="brand-mark">
            <Workflow size={20} />
          </span>
          <span>
            Workbench<span className="brand-caption">AGENT SYSTEMS</span>
          </span>
        </a>
        <div className="workspace-label">
          PERSONAL WORKSPACE <span className="local-badge">LOCAL</span>
        </div>
        <div className="project-picker">
          <select
            aria-label="Current project"
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
          >
            <option value="">Choose a project</option>
            {data.projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <button
            className="icon-button"
            aria-label="New project"
            onClick={() => setNewModal(true)}
          >
            <Plus size={16} />
          </button>
        </div>
        <div className="nav-label">WORKSPACE</div>
        <nav className="main-nav" aria-label="Workspace modes">
          {MODES.map((m) => (
            <div className="nav-group" key={m.id}>
              <button
                aria-label={m.label}
                title={m.label}
                className={`nav-item ${mode === m.id ? "active" : ""}`}
                onClick={() => navigate(m.id)}
              >
                <m.icon size={18} />
                <span>{m.label}</span>
                {mode === m.id && <ChevronDown size={13} />}
              </button>
              {mode === m.id && (
                <div className="subnav">
                  {m.steps.map((s, i) => (
                    <button
                      key={s}
                      className={step === s ? "active" : ""}
                      onClick={() => setStep(s)}
                    >
                      <span className="step-number">{i + 1}</span>
                      {s}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <button
            className="sidebar-link"
            aria-label="Manage credentials"
            title="Manage credentials"
            onClick={() => setCredentialModal(true)}
          >
            <KeyRound size={16} />
            <span>Credentials</span>
            <span className="count">
              {data.credentials.filter((c) => c.valid).length}
            </span>
          </button>
          <div className="theme-switch" role="group" aria-label="Color theme">
            {[
              { value: "light", icon: Sun, label: "Light" },
              { value: "dark", icon: Moon, label: "Dark" },
              { value: "system", icon: Settings2, label: "System" },
            ].map((t) => (
              <button
                key={t.value}
                title={t.label}
                aria-label={`${t.label} theme`}
                className={theme === t.value ? "active" : ""}
                onClick={() => setTheme(t.value)}
              >
                <t.icon size={14} />
                <span>{t.label}</span>
              </button>
            ))}
          </div>
          <div className="local-status">
            <span className="dot" />
            <span>Local workspace</span>
            <span className="avatar">AP</span>
          </div>
        </div>
      </aside>
      <div className="app-main">
        <header className="topbar">
          <div className="breadcrumbs">
            <span>{activeMode.label}</span>
            <ChevronRight size={13} />
            <strong>{step}</strong>
          </div>
          <div className="topbar-actions">
            <button
              className="search-trigger"
              aria-label="Find anything"
              title="Find anything"
              onClick={() => setSearchModal(true)}
            >
              <Search size={14} />
              <span>Find anything</span>
              <kbd>⌘ K</kbd>
            </button>
            <span className="privacy-tag">
              <span className="dot" /> Local execution
            </span>
            <button
              className="icon-button mobile-credential"
              aria-label="Manage credentials"
              onClick={() => setCredentialModal(true)}
            >
              <KeyRound size={17} />
            </button>
          </div>
        </header>
        <div className="mobile-project-picker">
          <select
            aria-label="Switch project"
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
          >
            <option value="">Choose a project</option>
            {data.projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <button
            className="button small"
            aria-label="Create new project"
            onClick={() => setNewModal(true)}
          >
            <Plus size={14} /> New
          </button>
        </div>
        {project && (
          <div className="project-header">
            <div>
              <div className="eyebrow">
                {isImported ? "CONNECTED APPLICATION" : "APPLICATION"}{" "}
                <span className="version">
                  r{graph?.revision || project.graph.revision}
                </span>
                {dirty && <span className="unsaved">Unsaved</span>}
              </div>
              <h2>{project.name}</h2>
            </div>
            <div className="project-header-right">
              {ModelFields({
                value: config,
                onChange: setConfig,
                compact: true,
              })}
              <button
                className="icon-button"
                aria-label="Configure credentials"
                title="Configure credentials"
                onClick={() => setCredentialModal(true)}
              >
                <KeyRound size={16} />
              </button>
            </div>
          </div>
        )}
        <nav className="mobile-steps" aria-label="Current workflow steps">
          {activeMode.steps.map((s) => (
            <button
              key={s}
              className={step === s ? "active" : ""}
              onClick={() => setStep(s)}
            >
              {s}
            </button>
          ))}
        </nav>
        {error && (
          <div className="error-banner" role="alert">
            <span>
              <strong>Couldn’t complete that.</strong> {error}
            </span>
            <button
              className="icon-button"
              aria-label="Dismiss error"
              onClick={() => setError("")}
            >
              <X size={16} />
            </button>
          </div>
        )}
        <main className={`main-content ${graphStep ? "graph-content" : ""}`}>
          {content}
        </main>
        <footer className="app-footer">
          <span>
            <span className="dot" />
            {busy ||
              "Saved graphs and redacted run evidence stay on this device"}
          </span>
          <span>
            {project
              ? `${project.graph.nodes.length} components · revision ${project.graph.revision}`
              : "Agent Workbench"}
            <span className="footer-separator">·</span>
            {docker ? "Code sandbox ready" : "Built-in tools ready"}
          </span>
        </footer>
      </div>
      {notice && (
        <div className="toast" role="status">
          <CheckCircle2 size={17} />
          {notice}
          <button
            className="icon-button"
            aria-label="Dismiss notification"
            onClick={() => setNotice("")}
          >
            <X size={14} />
          </button>
        </div>
      )}
      {busy && (
        <div className="busy-pill" role="status">
          <Loader2 size={13} className="spin" />
          {busy}
        </div>
      )}
      {newModal && (
        <NewProjectModal
          onClose={() => setNewModal(false)}
          onCreate={async (name, brief) => {
            const p = await api<Project>("/projects", "POST", { name, brief });
            syncProject(p);
            setNewModal(false);
            navigate("build", "Align");
            setNotice(
              "Project created. Describe the outcome, then draft a plan.",
            );
          }}
        />
      )}
      {credentialModal && (
        <CredentialsModal
          credentials={data.credentials}
          localAvailable={data.system.localSecretsAvailable}
          onClose={() => setCredentialModal(false)}
          onUpdate={async (c, list) => {
            await refresh();
            if (list) setModels((m) => ({ ...m, [c.id]: list }));
            if (c.valid) {
              const usable = list ? preferredModel(list) : undefined;
              setConfig((v) => ({
                ...v,
                credentialId: c.id,
                model: usable?.id || "",
              }));
            }
          }}
        />
      )}
      {hiddenModal && (
        <Modal
          title="Supporting code, within reach."
          kicker="HIDDEN NODES"
          onClose={() => setHiddenModal(false)}
        >
          <p className="muted">
            UI, connections, authentication and instructions remain part of the
            application. They stay collapsed so the workflow is readable.
          </p>
          <div className="resource-list">
            {graph?.nodes
              .filter((n) => n.hidden)
              .map((n) => (
                <button
                  key={n.id}
                  onClick={() => {
                    setSelection({ type: "node", id: n.id });
                    setInspectorTab("Configuration");
                    setView("design");
                    setHiddenModal(false);
                    if (mode === "build") setStep("Review");
                    else if (mode === "connect") setStep("Map");
                    else
                      navigate(
                        isImported ? "connect" : "build",
                        isImported ? "Map" : "Review",
                      );
                  }}
                >
                  <FileCode2 size={19} />
                  <div>
                    <strong>{n.label}</strong>
                    <small>{n.source?.path || n.description || n.role}</small>
                  </div>
                  <ChevronRight size={15} />
                </button>
              ))}
          </div>
          {!graph?.nodes.some((n) => n.hidden) && (
            <p className="muted">
              No hidden resources are declared in this graph yet.
            </p>
          )}
          <div className="callout small">
            Hidden means collapsed, not exempt from policy or tracing. A
            supporting dependency failure must still appear in the affected
            execution.
          </div>
        </Modal>
      )}
      {searchModal && (
        <Modal
          title="Find in your application"
          kicker="QUICK FIND"
          onClose={() => {
            setSearchModal(false);
            setSearch("");
          }}
        >
          <div className="search-field">
            <Search size={18} />
            <input
              autoFocus
              aria-label="Search nodes or modes"
              placeholder="Node name, source file, or workspace mode…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="search-results">
            {MODES.filter((m) =>
              m.label.toLowerCase().includes(search.toLowerCase()),
            ).map((m) => (
              <button
                key={m.id}
                onClick={() => {
                  navigate(m.id);
                  setSearchModal(false);
                  setSearch("");
                }}
              >
                <m.icon size={17} />
                <span>{m.label}</span>
                <small>WORKSPACE</small>
              </button>
            ))}
            {graph?.nodes
              .filter((n) =>
                `${n.label} ${n.description} ${n.source?.path}`
                  .toLowerCase()
                  .includes(search.toLowerCase()),
              )
              .map((n) => (
                <button
                  key={n.id}
                  onClick={() => {
                    setSelection({ type: "node", id: n.id });
                    setInspectorTab("Configuration");
                    setView("design");
                    navigate(
                      isImported ? "connect" : "build",
                      isImported ? "Map" : "Review",
                    );
                    setSearchModal(false);
                    setSearch("");
                  }}
                >
                  <FileCode2 size={17} />
                  <span>
                    {n.label}
                    <small>{n.source?.path}</small>
                  </span>
                  <small>{n.hidden ? "HIDDEN" : n.role.toUpperCase()}</small>
                </button>
              ))}
          </div>
        </Modal>
      )}
    </div>
  );
}

function JsonEditor({
  label,
  value,
  disabled,
  onSave,
}: {
  label: string;
  value: Record<string, unknown>;
  disabled: boolean;
  onSave: (value: Record<string, unknown>) => void;
}) {
  const [text, setText] = useState(pretty(value)),
    [invalid, setInvalid] = useState("");
  useEffect(() => setText(pretty(value)), [JSON.stringify(value)]);
  return (
    <Field
      label={label}
      hint={invalid || "JSON · changes apply when you leave the editor"}
    >
      <textarea
        className={`code-input ${invalid ? "invalid" : ""}`}
        rows={6}
        value={text}
        disabled={disabled}
        onChange={(e) => {
          setText(e.target.value);
          setInvalid("");
        }}
        onBlur={() => {
          try {
            const parsed = JSON.parse(text);
            if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
              throw new Error();
            onSave(parsed);
            setInvalid("");
          } catch {
            setInvalid(
              "Enter a valid JSON object. The previous value is unchanged.",
            );
          }
        }}
      />
    </Field>
  );
}
function NewProjectModal({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (name: string, brief: string) => Promise<void>;
}) {
  const [name, setName] = useState(""),
    [brief, setBrief] = useState(""),
    [pending, setPending] = useState(false),
    [error, setError] = useState("");
  return (
    <Modal
      title="What are you building?"
      kicker="NEW PROJECT"
      onClose={onClose}
    >
      <p className="muted">
        Start with a name and a short goal. You can refine both with the
        alignment agent.
      </p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setPending(true);
          try {
            await onCreate(name, brief);
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setPending(false);
          }
        }}
      >
        <Field label="Project name">
          <input
            autoFocus
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Support research assistant"
          />
        </Field>
        <Field label="What should it do?">
          <textarea
            rows={5}
            value={brief}
            onChange={(e) => setBrief(e.target.value)}
            placeholder="Describe the outcome, users and constraints…"
          />
        </Field>
        {error && <p className="form-error">{error}</p>}
        <div className="modal-footer">
          <button type="button" className="button" onClick={onClose}>
            Cancel
          </button>
          <button className="button primary" disabled={pending || !name.trim()}>
            {pending ? (
              <Loader2 size={15} className="spin" />
            ) : (
              <Plus size={15} />
            )}
            Create project
          </button>
        </div>
      </form>
    </Modal>
  );
}
function CredentialsModal({
  credentials,
  localAvailable,
  onClose,
  onUpdate,
}: {
  credentials: Credential[];
  localAvailable: boolean;
  onClose: () => void;
  onUpdate: (credential: Credential, models?: Model[]) => Promise<void>;
}) {
  const [provider, setProvider] = useState<Provider>("gemini"),
    [label, setLabel] = useState(""),
    [key, setKey] = useState(""),
    [pending, setPending] = useState(""),
    [error, setError] = useState(""),
    [modelCount, setModelCount] = useState<Record<string, number>>({});
  async function action(id: string, fn: () => Promise<void>) {
    setPending(id);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPending("");
    }
  }
  async function validate(c: Credential) {
    const result = await api<{ credential: Credential; models: Model[] }>(
      `/credentials/${c.id}/validate`,
      "POST",
      {},
    );
    setModelCount((m) => ({
      ...m,
      [c.id]: result.models.filter((m) => m.available && m.text).length,
    }));
    await onUpdate(result.credential, result.models);
    if (!result.credential.valid)
      throw new Error(
        result.credential.error || "Credential could not be validated.",
      );
  }
  return (
    <Modal
      title="Connect your models."
      kicker="CREDENTIALS / SERVER-SIDE SESSION"
      onClose={onClose}
      wide
    >
      <p className="muted">
        Choose a provider, validate access, then select a compatible model. Keys
        stay on the local server and never enter browser storage or exports.
      </p>
      <div className="credential-grid">
        <section>
          <h3>Available credentials</h3>
          {credentials.length ? (
            <div className="credential-list">
              {credentials.map((c) => (
                <div className="credential-item" key={c.id}>
                  <div className="credential-icon">
                    <KeyRound size={18} />
                  </div>
                  <div>
                    <strong>{c.label}</strong>
                    <small>
                      {c.provider} ·{" "}
                      {c.source === "session"
                        ? "server session"
                        : "local secret file"}
                    </small>
                    <Status value={c.valid ? "validated" : "unvalidated"} />
                    {modelCount[c.id] !== undefined && (
                      <small>{modelCount[c.id]} available text models</small>
                    )}
                    {c.error && <p className="form-error small">{c.error}</p>}
                  </div>
                  <button
                    className="button small"
                    disabled={!!pending}
                    onClick={() => action(c.id, () => validate(c))}
                  >
                    {pending === c.id ? (
                      <Loader2 size={13} className="spin" />
                    ) : (
                      "Validate"
                    )}
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="callout">
              No credentials yet. Add one to use planning agents, execute runs
              and evaluate results.
            </div>
          )}
          <div className="callout small">
            The workbench’s planning and review agents use your selected model.
            Connected applications can have additional runtime requirements;
            check adapter coverage before running.
          </div>
        </section>
        <section className="credential-add">
          <h3>Add a provider</h3>
          <Field label="Provider">
            <select
              value={provider}
              onChange={(e) => setProvider(e.target.value as Provider)}
            >
              {PROVIDERS.map((p) => (
                <option key={p} value={p}>
                  {p[0].toUpperCase() + p.slice(1)}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Label">
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder={`${provider} workspace`}
            />
          </Field>
          <Field
            label="API key"
            hint="Held in this server session. Enter a fresh key after the server restarts."
          >
            <input
              type="password"
              autoComplete="off"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="Paste your provider key"
            />
          </Field>
          <button
            className="button primary"
            disabled={!!pending || !key.trim()}
            onClick={() =>
              action("add", async () => {
                const c = await api<Credential>("/credentials", "POST", {
                  provider,
                  label: label || `${provider} workspace`,
                  key,
                });
                setKey("");
                await onUpdate(c);
                await validate(c);
              })
            }
          >
            {pending === "add" ? (
              <Loader2 size={14} className="spin" />
            ) : (
              <KeyRound size={14} />
            )}
            Add & validate
          </button>
          {localAvailable && (
            <>
              <div className="or-separator">
                <span>or</span>
              </div>
              <button
                className="button full"
                disabled={!!pending}
                onClick={() =>
                  action("import", async () => {
                    const c = await api<Credential>(
                      "/credentials/import",
                      "POST",
                      { provider },
                    );
                    await onUpdate(c);
                    await validate(c);
                  })
                }
              >
                {pending === "import" ? (
                  <Loader2 size={14} className="spin" />
                ) : (
                  <ArrowDownToLine size={14} />
                )}
                Import configured local key
              </button>
              <small className="muted">
                The server reads only the selected provider’s configured secret
                entry.
              </small>
            </>
          )}
        </section>
      </div>
      {error && (
        <div className="form-error" role="alert">
          {error}
        </div>
      )}
      <div className="modal-footer">
        <span className="muted small">
          Model availability is checked. Capability support can still require
          runtime validation.
        </span>
        <button className="button" onClick={onClose}>
          Done
        </button>
      </div>
    </Modal>
  );
}
