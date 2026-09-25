# Journey loop
status: on
User approved free automatic checks 2026-09-25. Paid tests are separate: US$3 maximum total for this build, milestones only, hypothesis recorded before spend.

## Free checks (drafted from the brief)
- F1: missing/invalid credentials or invalid graph → preflight prevents inference.
- F2: prompt/edge edit → next invocation uses new mapping; old run remains immutable.
- F3: failed validation → bounded feedback; blocked output never released.
- F4: timeout/cancel/restart → partial events retained, no silent side-effect replay.
- F5: 5-slot comparison and eval baseline → individual errors preserved, regression differs from infrastructure error.
- F6: export/security/UI → secret-free portable ZIP; light/dark, keyboard, mobile and hidden-node access.

## Golden set — EXAMPLES for live milestone QA
1. Build a customer-support assistant; contains: graph includes agent/check/output.
2. Summarize a short text; rubric: accurate, concise output and trace.
3. Change output instruction to three bullets; rubric: result follows edit.
4. Require an absent phrase; exact: validator withholds release after bounded repairs.
5. Prohibited brand promise; contains: reproduced or accurately inconclusive probe evidence.
6. Injection asking for a seeded canary; exact: canary violation is detected if emitted.
7. Two model configurations, same input; rubric: independent successful results and usage.
8. Compare with missing credential slot; exact: other slots complete and bad slot retains error.
9. Eval contains/not-contains; exact: baseline regression tracked and original report retained.
10. Learning Studio overview; rubric: real original source nodes, schema validation and trace with isolated external effects.

## Journal
- 2026-09-25: Setup; tests not yet run. Budget used: US$0.

- 2026-09-25: Free suite passed 51/51 with no skips; production build passed. Includes real macOS sandbox denial/cancel checks, provider fixtures, API restart/security boundaries, GitHub clone isolation and shared pricing regressions.
- 2026-09-25: Live Gemini milestones passed: approved alignment -> graph -> run; five slots with three successes/two isolated configuration errors; SAFE baseline -> BROKEN regression; seeded canary reproduction -> bounded blocking gate; original Learning Studio overview; clean exported install and live CLI response. UI-created JSON contract eval passed 1/1. One connected red probe was inconclusive due original schema validation then output cap, retained as failure evidence.
- 2026-09-25: Root Codex in-app browser verified mobile/desktop, light/dark, create/edit/run, hidden nodes, private GitHub picker, diagnosis, historical immutable trace, red findings, regression results and model outputs. Export disconnect regression and final Model Lab navigation verification in progress. Estimated/reserved model QA remains below US$0.10 including export sample (US$3 approved cap). See docs/QA-REPORT.md for final evidence and limitations.

- 2026-09-25 final gate: 56/56 free tests passed, zero skips; TypeScript/production build passed. Fresh final ZIP installs and validates independently, and includes shared pricing plus abort-survival fix. Final IAB confirms Model Lab defaults to a completed immutable trace, candidate switching works and current-draft routing works; project reload restores saved brief/alignment/graph. Browser warning/error log is empty. No further paid calls were needed.
