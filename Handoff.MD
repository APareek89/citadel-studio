# Handoff
Update this snapshot after major changes. Read Learning.MD and Loop.MD at session start. Local checkpoints are automatic; never push without authorization. Standalone diagrams only. Free checks run after meaningful changes. Live QA has a total US$3 cap for this build; log spend and hypothesis before calls.

## Current state
Working local MVP at http://127.0.0.1:3001, open inside Codex. Five modes use real local services. Final free suite: 56/56 passed, no skips; production build passed. Live Gemini evidence covers alignment/run, five comparison slots (three successes, two independent errors), baseline regression, a seeded red-team finding, bounded output blocking, and original Learning Studio overview. Clean exported install and live CLI sample passed; final regenerated ZIP adds verified interrupted-upload handling and shared pricing. QA: docs/QA-REPORT.md. AWS CLI/profile configured; no cloud resources or deployment. Prior mock is in prototype/.

Estimated reserved live QA: US$0.0265253 in the workbench ledger, plus roughly US$0.0006701 for the exported sample. This is under US$0.10 and the approved US$3 cap; not an invoice. See the explicit historical Flash-cost correction event and server/pricing.ts. Credentials were re-imported/validated after final backend restart and remain memory-only.

## Pending / boundaries
No known P0 remains on enabled local paths. General repo execution and source round-tripping are not implemented; only pinned Learning Studio overview is executed. Docker is absent, so arbitrary custom code is blocked. Other providers have free contract tests, not live verification. One imported adversarial probe is inconclusive due schema/output limits; do not claim a security pass. Future work: broaden adapters, strengthen specialist coordination (Phase 2), address journal/snapshot crash consistency and trace retention, then hosted DB/auth/tenant isolation and deployment (Phase 3). No automatic push/deploy.

Browser QA must use root's Codex in-app browser only; subagents cannot access it. Final IAB journeys verified 390px/1440px themes/navigation, prompt/schema/edge edits, real runs and eval, GitHub connect, hidden resources, immutable traces, comparison outputs, red findings, regression detection, keyboard modal focus and project reload. Model Lab now auto-selects a completed candidate's immutable trace.

## Session efficiency
Approximate effort: 60% feature, 25% support/verification, 15% rework. Most late rework came from export transport handling, source/credential boundaries and historical-view state.

## Decisions
- 2026-09-25 — Five modes share versioned graph, run events, credentials and local persistence.
- 2026-09-25 — Supporting UI/DB/auth/Markdown nodes stay searchable under Hidden nodes.
- 2026-09-25 — New graphs own manifest runtime; imported code stays source-owned with explicit coverage.
- 2026-09-25 — Only pinned inspected Learning Studio source may use a tested OS sandbox adapter; arbitrary code requires Docker.
- 2026-09-25 — User approved automatic local commits, free journey loop, milestone failure reviews, standalone diagrams, and up to US$3 live QA.
