import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  appendFileSync,
  chmodSync,
  existsSync,
  statSync,
} from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { authEnabled, dataRoot, tenantRoot, tenantValue } from "./tenant.js";
import { checkPersistentSpace } from "./import-limits.js";
import type {
  Project,
  Run,
  Comparison,
  EvalSuite,
  EvalReport,
  RedPlan,
} from "../shared/types.js";
// Base path is operational metadata only. Private reads/writes use tenantRoot().
export const dataDir = dataRoot;
export const id = (prefix = "id") => `${prefix}_${randomUUID().slice(0, 12)}`;
export const now = () => new Date().toISOString();
export interface State {
  projects: Project[];
  runs: Run[];
  comparisons: Comparison[];
  suites: EvalSuite[];
  reports: EvalReport[];
  redPlans: RedPlan[];
}
function workspace(): State {
  return tenantValue("workspace", () => {
    const file = path.join(tenantRoot(), "workspace.json");
    const value: State = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) :
      { projects: [], runs: [], comparisons: [], suites: [], reports: [], redPlans: [] };
    const changed = recover(value);
    if (changed || !existsSync(file)) writeState(value);
    return value;
  });
}
export const state: State = new Proxy({} as State, {
  get(_target, key) { return Reflect.get(workspace(), key); },
  set(_target, key, value) { return Reflect.set(workspace(), key, value); },
  ownKeys() { return Reflect.ownKeys(workspace()); },
  getOwnPropertyDescriptor(_target, key) { return { configurable: true, enumerable: true, value: Reflect.get(workspace(), key) }; },
});
function writeState(value: State) {
  const file = path.join(tenantRoot(), "workspace.json"), temp = file + "." + randomUUID() + ".tmp";
  const raw = JSON.stringify(value);
  try {
    if (authEnabled() && Buffer.byteLength(raw) > 32 * 1024 * 1024) throw new Error("Workspace history limit reached. Existing records were preserved.");
    checkPersistentSpace(Math.max(0, Buffer.byteLength(raw) - (existsSync(file) ? statSync(file).size : 0)));
  } catch (error) {
    // Mutations use the original state API. On a rejected write restore the last
    // durable snapshot so an in-memory mutation cannot bypass the storage cap.
    if (existsSync(file)) Object.assign(value, JSON.parse(readFileSync(file, "utf8")));
    throw error;
  }
  writeFileSync(temp, raw, { mode: 0o600, flag: "wx" });
  renameSync(temp, file);
}
export function save() { writeState(workspace()); }
export function journal(record: unknown) {
  const file = path.join(tenantRoot(), "events.jsonl"), raw = JSON.stringify(record) + "\n";
  const bytes = existsSync(file) ? statSync(file).size : 0;
  if (authEnabled() && bytes + Buffer.byteLength(raw) > 16 * 1024 * 1024) throw new Error("Event history limit reached. Existing events were preserved.");
  checkPersistentSpace(Buffer.byteLength(raw));
  appendFileSync(file, raw, { mode: 0o600 });
}
/** Reject new work before model dispatch; leave room for a bounded run's output and events. */
export function assertWriteCapacity(reserve = 1024 * 1024) {
  if (!authEnabled()) return;
  const file = path.join(tenantRoot(), "events.jsonl");
  if (Buffer.byteLength(JSON.stringify(workspace())) + reserve > 32 * 1024 * 1024 ||
      (existsSync(file) ? statSync(file).size : 0) + reserve > 16 * 1024 * 1024)
    throw new Error("Workspace history is full. No new operation was started.");
  checkPersistentSpace(reserve * 2);
}
function recover(state: State) {
let changed = false;
for (const run of state.runs) {
  if (run.status === "running" || run.status === "queued") {
    changed = true;
    run.status = "interrupted";
    run.error =
      "Server restarted. Start a new run to avoid replaying side effects.";
    run.finishedAt = now();
    const event = {
      id: id("event"),
      time: now(),
      type: "run.interrupted" as const,
      message: run.error,
    };
    run.events.push(event);
    try { journal({ runId: run.id, ...event }); } catch { /* History cap never replays interrupted work. */ }
  }
}
for (const report of state.reports) {
  if (report.status === "running") {
    changed = true;
    report.status = "completed";
    for (const row of report.results) {
      if (row.verdict === "pending") {
        row.verdict = "error";
        row.reasons = ["Interrupted by server restart"];
      }
    }
  }
}
for (const plan of state.redPlans) {
  if (plan.status === "running") {
    changed = true;
    plan.status = "completed";
    plan.findings.push({
      id: id("finding"),
      title: "Campaign interrupted",
      severity: "low",
      evidenceType: "inconclusive",
      description:
        "Server restarted; launch a new campaign to finish remaining probes.",
    });
  }
}
return changed;
}
if (!authEnabled()) workspace();
export function projectById(value: string) {
  const result = state.projects.find((p) => p.id === value);
  if (!result) throw new Error("Project not found");
  return result;
}
