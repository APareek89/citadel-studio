import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  appendFileSync,
  chmodSync,
  existsSync,
} from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type {
  Project,
  Run,
  Comparison,
  EvalSuite,
  EvalReport,
  RedPlan,
} from "../shared/types.js";
export const dataDir = path.resolve(process.env.WORKBENCH_DATA_DIR || ".local");
mkdirSync(dataDir, { recursive: true, mode: 0o700 });
chmodSync(dataDir, 0o700);
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
const file = path.join(dataDir, "workspace.json");
const initial: State = {
  projects: [],
  runs: [],
  comparisons: [],
  suites: [],
  reports: [],
  redPlans: [],
};
export const state: State = existsSync(file)
  ? JSON.parse(readFileSync(file, "utf8"))
  : initial;
export function save() {
  const temp = file + ".tmp";
  writeFileSync(temp, JSON.stringify(state), { mode: 0o600 });
  renameSync(temp, file);
}
export function journal(record: unknown) {
  appendFileSync(
    path.join(dataDir, "events.jsonl"),
    JSON.stringify(record) + "\n",
    { mode: 0o600 },
  );
}
for (const run of state.runs) {
  if (run.status === "running" || run.status === "queued") {
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
    journal({ runId: run.id, ...event });
  }
}
for (const report of state.reports) {
  if (report.status === "running") {
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
save();
export function projectById(value: string) {
  const result = state.projects.find((p) => p.id === value);
  if (!result) throw new Error("Project not found");
  return result;
}
