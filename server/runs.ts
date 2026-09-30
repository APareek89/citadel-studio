import { exampleOutput } from "./examples.js";
import { tenantKey, bindTenant, authEnabled } from "./tenant.js";
import { EventEmitter } from "node:events";
import type {
  Run,
  ModelConfig,
  Preflight,
  Graph,
  Usage,
  RunEvent,
  RepoInfo,
} from "../shared/types.js";
import { state, id, now, save, journal, projectById, assertWriteCapacity } from "./store.js";
import {
  generate,
  modelFor,
  redact,
  safeObject,
  estimate,
  type GenerateResult,
  type GenerateOptions,
} from "./providers.js";
import { validateGraph } from "./graph.js";
import { dockerAvailable } from "./sandbox.js";
import { executeGraph, BlockedError } from "./runtime.js";
import { importedExecutionAvailability } from "./importer.js";
export const bus = new EventEmitter();
bus.setMaxListeners(100);
const controllers = new Map<string, AbortController>();
const completions = new Map<string, Promise<Run>>();
let activeCalls = 0;
const waiting: {
  resolve: () => void;
  reject: (e: Error) => void;
  signal: AbortSignal;
}[] = [];
async function acquire(signal: AbortSignal) {
  signal.throwIfAborted();
  if (activeCalls < 3) {
    activeCalls++;
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const waiter = {
      resolve: () => {
        signal.removeEventListener("abort", abort);
        resolve();
      },
      reject,
      signal,
    };
    const abort = () => {
      const index = waiting.indexOf(waiter);
      if (index >= 0) waiting.splice(index, 1);
      reject(new Error("Run cancelled while queued"));
    };
    waiting.push(waiter);
    signal.addEventListener("abort", abort, { once: true });
  });
}
function release() {
  const next = waiting.shift();
  if (next) next.resolve();
  else activeCalls--;
}
export interface Budget {
  calls: number;
  maxCalls: number;
  reservedUsd: number;
  maxUsd?: number;
}
export function makeBudget(maxCalls = 12, maxUsd?: number): Budget {
  return { calls: 0, maxCalls, reservedUsd: 0, maxUsd };
}
export function boundedGenerator(
  config: ModelConfig,
  budgetOrBudgets: Budget | Budget[],
  signal: AbortSignal,
  defaultTokens = 1536,
) {
  return async (
    system: string,
    input: string,
    opts: Omit<GenerateOptions, "signal"> = {},
  ): Promise<GenerateResult> => {
    const budgets = Array.isArray(budgetOrBudgets)
      ? budgetOrBudgets
      : [budgetOrBudgets];
    const model = modelFor(config);
    const tokens = opts.maxOutputTokens || defaultTokens;
    const reserve = estimate(
      model.provider,
      model.id,
      Buffer.byteLength(system + input),
      tokens,
    );
    for (const budget of budgets) {
      if (budget.calls >= budget.maxCalls)
        throw new Error("Model-call budget exhausted.");
      if (budget.maxUsd !== undefined && reserve === undefined)
        throw new Error(
          "A dollar cap requires verified pricing for this model.",
        );
      if (
        reserve !== undefined &&
        budget.maxUsd !== undefined &&
        budget.reservedUsd + reserve > budget.maxUsd
      )
        throw new Error("Cost budget would be exceeded.");
    }
    for (const budget of budgets) {
      budget.calls++;
      budget.reservedUsd += reserve || 0;
    }
    await acquire(signal);
    try {
      return await generate(config, system, input, {
        ...opts,
        maxOutputTokens: tokens,
        signal: AbortSignal.any([signal, AbortSignal.timeout(90000)]),
      });
    } finally {
      release();
    }
  };
}

export async function preflight(
  projectId: string,
  config: ModelConfig,
  input: string,
  override?: Graph,
  repoOverride?: RepoInfo | null,
): Promise<Preflight> {
  const project = projectById(projectId);
  const graph = override || project.graph;
  const cached = config.credentialId === "cached-example";
  if (cached && (project.example?.kind !== "cached-workflow" || project.repo)) throw new Error("Cached provider is only available in the separate workflow example.");
  const repo = repoOverride === undefined ? project.repo : repoOverride;
  const result = repo
    ? { ok: true, issues: [] as Preflight["issues"], warnings: [] as string[] }
    : validateGraph(graph);
  if (!input?.trim())
    result.issues.push({
      code: "missing_input",
      message: "Add a sample input before running.",
    });
  if (input?.length > 40000)
    result.issues.push({
      code: "input_limit",
      message: "Sample input must be under 40,000 characters.",
    });
  try {
    const m = modelFor(config);
    if (graph.nodes.some((n) => !n.hidden && n.schema) && !m.structured)
      result.warnings.push(
        "This model uses prompted JSON plus local schema validation, not provider-enforced schemas.",
      );
  } catch (e) {
    result.issues.push({
      code: "credential_model",
      message: (e as Error).message,
    });
  }
  if (repo && !importedExecutionAvailability(repo).executionAvailable)
    result.issues.push({
      code: "adapter_missing",
      message: importedExecutionAvailability(repo).executionUnavailableReason!,
    });
  if (
    graph.nodes.some((n) => n.tool === "code" && !n.hidden) &&
    !(await dockerAvailable())
  )
    result.issues.push({
      code: "docker_missing",
      message:
        "Custom code needs Docker and the node:22-alpine image. Built-in tools can run now.",
    });
  if (repo) result.warnings.push(...repo.limitations);
  result.ok = result.issues.length === 0;
  return result;
}
export function emit(run: Run, event: Omit<RunEvent, "id" | "time">) {
  if (authEnabled() && !state.runs.includes(run)) throw new Error("Run not found in this workspace.");
  const safe = safeObject({ ...event, id: id("evt"), time: now() });
  run.events.push(safe);
  journal({ runId: run.id, ...safe });
  save();
  bus.emit(tenantKey(run.id), run);
}
export async function startRun(args: {
  projectId: string;
  config: ModelConfig;
  input: string;
  mode?: Run["mode"];
  parentId?: string;
  graph?: Graph;
  budget?: Budget;
  repoSnapshot?: RepoInfo | null;
}): Promise<Run> {
  assertWriteCapacity(4 * 1024 * 1024);
  if (state.runs.length >= 300) throw new Error("Workspace run limit reached. Existing runs were preserved.");
  const project = projectById(args.projectId);
  const check = await preflight(
    project.id,
    args.config,
    args.input,
    args.graph,
    args.repoSnapshot,
  );
  if (!check.ok) throw new Error(check.issues.map((i) => i.message).join(" "));
  if ([...controllers].length >= 12)
    throw new Error("Too many active runs. Wait or cancel a run.");
  const graph = structuredClone(args.graph || project.graph);
  const repoSnapshot =
    args.repoSnapshot === null
      ? undefined
      : structuredClone(args.repoSnapshot || project.repo);
  const run: Run = safeObject({
    id: id("run"),
    projectId: project.id,
    graph,
    input: args.input,
    config: args.config,
    status: "queued",
    mode: args.mode || "build",
    events: [],
    createdAt: now(),
    usage: { inputTokens: 0, outputTokens: 0 },
    parentId: args.parentId,
  });
  state.runs.unshift(run);
  save();
  const controller = new AbortController();
  const key = tenantKey(run.id);
  controllers.set(key, controller);
  const timeout = setTimeout(
    () => controller.abort(new Error("Run time limit exceeded")),
    graph.limits.timeoutMs,
  );
  const promise = bindTenant(async () => {
    try {
      run.status = "running";
      emit(run, {
        type: "run.started",
        message: args.config.credentialId === "cached-example" ? "Executing cached fixture through the graph scheduler; no model or repository execution" : repoSnapshot
          ? "Executing isolated source adapter"
          : "Executing graph revision " + graph.revision,
      });
      const budget = [
        makeBudget(graph.limits.maxCalls, (graph.limits as any).maxCostUsd),
        ...(args.budget ? [args.budget] : []),
      ];
      const call = boundedGenerator(
        args.config,
        budget,
        controller.signal,
        graph.limits.maxOutputTokens,
      );
      const generateTracked = async (
        system: string,
        input: string,
        options?: Omit<GenerateOptions, "signal">,
      ) => {
        const result = args.config.credentialId === "cached-example"
          ? { text: exampleOutput, usage: { inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0 } }
          : await call(system, input, options);
        run.usage.inputTokens += result.usage.inputTokens;
        run.usage.outputTokens += result.usage.outputTokens;
        if (result.usage.estimatedCostUsd !== undefined)
          run.usage.estimatedCostUsd =
            (run.usage.estimatedCostUsd || 0) + result.usage.estimatedCostUsd;
        return result;
      };
      let output: string;
      if (repoSnapshot) {
        const { runLearningStudio } = await import("./learning-runner.js");
        output = await runLearningStudio({
          repo: repoSnapshot,
          input: run.input,
          config: run.config,
          signal: controller.signal,
          onEvent: (e) => emit(run, e),
          generate: generateTracked,
        });
      } else
        output = await executeGraph(graph, run.input, {
          signal: controller.signal,
          emit: (e) => emit(run, e),
          generate: generateTracked,
        });
      controller.signal.throwIfAborted();
      run.output = redact(output);
      run.status = "completed";
      run.finishedAt = now();
      emit(run, { type: "run.completed", output: run.output });
    } catch (error) {
      const cancelled = controller.signal.aborted;
      run.status = cancelled
        ? "cancelled"
        : error instanceof BlockedError
          ? "blocked"
          : "failed";
      run.error = redact(
        cancelled
          ? String(controller.signal.reason?.message || "Cancelled")
          : (error as Error).message,
      );
      run.finishedAt = now();
      emit(run, {
        type: cancelled ? "run.cancelled" : "run.failed",
        message: run.error,
      });
    } finally {
      clearTimeout(timeout);
      controllers.delete(key);
      save();
    }
    return run;
  })();
  completions.set(key, promise);
  void promise.finally(() => completions.delete(key));
  return run;
}
export async function waitRun(run: Run) {
  if (!state.runs.some(r => r === run)) throw new Error("Run not found");
  return completions.get(tenantKey(run.id)) || run;
}
export function cancelRun(runId: string) {
  if (!state.runs.some(r => r.id === runId)) return undefined;
  const c = controllers.get(tenantKey(runId));
  if (c) c.abort(new Error("Stopped by user"));
  return state.runs.find((r) => r.id === runId);
}
export function cancelAll() {
  for (const c of controllers.values()) c.abort(new Error("Server stopping"));
}
