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
