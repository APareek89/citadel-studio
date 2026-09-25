# Handoff
Update this snapshot after major changes. Read Learning.MD and Loop.MD at session start. Local checkpoints are automatic; never push without authorization. Standalone diagrams only. Free checks run after meaningful changes. Live QA has a total US$3 cap for this build; log spend and hypothesis before calls.

## Current state
Approved brief: planning/APP-BRIEF.md. Real Phase 1 implementation underway; prior simulated design lives in prototype/. React + TypeScript and local Node service. AWS readiness handled separately; no deployment yet.

## Pending
Finish runtime/provider credentials, five UI journeys, exact-source Learning Studio adapter, tests, clean export, live Gemini QA and full failure review. Docker absent: arbitrary code execution must remain blocked until a sandbox is available. No real API success claimed yet.

## Decisions
- 2026-09-25 — Five modes share versioned graph, run events, credentials and local persistence.
- 2026-09-25 — Supporting UI/DB/auth/Markdown nodes stay searchable under Hidden nodes.
- 2026-09-25 — New graphs own manifest runtime; imported code stays source-owned with explicit coverage.
- 2026-09-25 — Only pinned inspected Learning Studio source may use a tested OS sandbox adapter; arbitrary code requires Docker.
- 2026-09-25 — User approved automatic local commits, free journey loop, milestone failure reviews, standalone diagrams, and up to US$3 live QA.
