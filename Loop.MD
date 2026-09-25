# Journey loop
status: on
User approved free automatic checks 2026-09-25. Paid tests are separate: US$3 maximum total for this build, milestones only, hypothesis recorded before spend.

## Free checks (drafted from the brief)
- F1: missing/invalid credentials or invalid graph → preflight prevents inference.
- F2: prompt/edge edit → next invocation uses new mapping; old run remains immutable.
- F3: failed validation → bounded feedback; blocked output never released.
- F4: timeout/cancel/restart → partial events retained, no silent side-effect replay.
- F5: 5-slot comparison and eval baseline → individual errors preserved, regression differs from infrastructure error.
- F7: private PAT/CLI or reviewed folder → bounded AI map with source-valid references, candidate coverage and unresolved retention.
- F8: native/Langfuse ingestion → scoped auth, bounded payloads, partial evidence, preserved run graph, redacted IO, no execution side effects.
- F9: source replacement/remap → stale completion rejected, prior run snapshots retained and old integration credentials revoked on actual replacement.
- F6: export/security/UI → secret-free portable ZIP; light/dark, keyboard, mobile and hidden-node access.
- F10: open the existing Demo Studio source map → all workflow nodes remain discoverable in a readable structure overview; Fit, Focus node, node jump and All connections reveal detail without remapping or paid inference. Supporting resources remain in Hidden nodes.
- F11: inspect an editable manifest and its recorded run → every original visible relationship, parallel instruction and feedback contract remains available; overview changes never alter saved graph semantics, source provenance or historical node output. All connections shows every original visible edge, not only one representative per endpoint pair. For external traces, Recorded path may restrict nodes to actual node events and links to original observed relationships; Full source context restores the complete saved graph without claiming those other nodes ran.
- F12: expand the graph → the canvas uses the viewport, the inspector can be toggled, keyboard focus stays within the visible surface, nested modals retain priority, and Escape/Exit restores the normal workspace. Light/dark and narrow-screen checks use Codex's in-app browser only.

## Current graph milestone — free journey gate

- **PASS — deterministic presentation:** `tsx --test tests/graph-presentation.test.ts` passed 16/16 with zero skips. Fixtures cover the Demo Studio topology, cycles, long chains, peer packing, disconnected/hidden nodes, stable positions, duplicate relationship evidence and no source-graph mutation. Four external-path cases additionally cover event-backed nodes, observed-only links, parallel/self edges, empty evidence and independent immutable metadata.
- **PASS — edge-selection contract:** the same suite verifies that All connections retains original parallel edges, editable/recorded graphs retain every visible connection, and imported source overview retains every explicit feedback edge. This tests the helper contract; it does not replace UI wiring checks.
- **PASS, bounded — F10 browser:** root verified Demo Studio's 16 nodes / 16 overview edges and all 39 original source edges, fullscreen, node focus at zoom 1, inspector and Escape focus restoration. Hidden-resource/source-reference checks retain prior evidence. Final recorded-path readability and narrow-screen checks passed.
- **PASS, bounded — F11 external trace browser:** Recorded path shows 5 event-backed nodes / 4 observed links; Full source context restores 20 nodes / 43 edges. The summary inspector displays actual synthetic input and real structured output. Selecting the observed harness→summary arrow retains CONNECTION INSPECTOR, original endpoint names and observed provenance. Manifest feedback/parallel contracts pass automated regressions; a fresh manifest edit/save browser check has not yet been reported for this UI delta.
- **PASS — F12 browser:** desktop fullscreen, Fit/Focus, inspector, dark mode, forward/reverse Tab confinement and Escape focus restoration passed. Forward Tab from the last Fit View control wraps to Source map within fullscreen. Nested Hidden nodes modal Escape closes only the child and retains fullscreen/focus. At 390×844, fullscreen/Focus/Inspector controls are accessible, the inspector fits at 340px and the document has no horizontal overflow. Four recorded edges show four labels when labels are enabled.
- **PASS — final gate:** root reports 125/125 free tests and the latest successful production build after selection/layout repair. Normal Codex viewport and System theme were restored; the final four-row/28px-gap path was visually checked as a clear hierarchy without a false chain. Browser warning/error logs are empty. App is left on the completed path in fullscreen. Screenshots were viewed in the tool, not saved as new files. Root owns the subsequent staged review/checkpoint. The preceding connection milestone's 109/109 result remains historical.

These checks use local fixtures and existing records. Any new Demo Studio execution evidence belongs in `docs/DEMO-STUDIO-RUN.md`; source acquisition or a clean map alone is not runtime proof. This documentation pass makes no paid call.

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

- 2026-09-25 connection extension:109 free tests pass; build passes. Root IAB directory review/source inspection, native live→completed node output and Langfuse loopback sync/partial output passed. Gemini Flash Lite maps Model Arena 4/4 candidates and Demo Studio 92/92 into 16 visible nodes; bounded inventory/body coverage remains explicit. Reserved workbench usage US$0.101072 plus ~US$0.0006701 export sample, below US$0.11 and approved US$3. No real Langfuse account or pasted GitHub PAT supplied.
- 2026-09-25 graph readability milestone: user feedback exposed dense crossing relationships despite a bounded 16-node semantic map. Added deterministic presentation and fullscreen exploration. Initial free helper suite passed 12/12. The review reproduced a lost second feedback return and a deduplicated parallel relationship; dedicated edge-selection regressions now pass. No paid inference was used to debug presentation. Subsequent acceptance appears in the final gate above.
- 2026-09-25 external-path follow-up: helper suite increased to 16/16; root reported merged 125/125. Initial desktop source graph/fullscreen passed; subsequent selection, recorded-path and keyboard results are in the final gate above.
- 2026-09-25 Demo Studio receipt, retrospectively indexed here: the hypothesis was recorded in the parent task plan and user commentary **before** the sole paid call, not as a pre-call Loop row. Expectation: original `summarize()` makes one ≤1,200-output-token structured request, validates through original Pydantic `SessionSummary`, preserves the unanswered Pune-price question and record fields, and applies its safe unresolved opener. The one live result passed: broker `run_419f28b4-239`, external trace `observed_3485872e-b80`, 607 input / 127 output tokens, estimated US$0.0004996. No paid retry/fallback. A first **free** original coverage-guard test failed for “documents contain no pricing information”; its failed trace and the successful narrower case were retained. This is three original modules with explicit fixture substitutions, not a full Demo Studio run or generic adapter. See `docs/DEMO-STUDIO-RUN.md`.
- 2026-09-25 latest ledger audit reported by root: reserved US$0.1235153 across 38 calls, plus US$0.0006701 export sample, conservative total US$0.1241854 (below US$0.125 of the approved US$3 cap). These estimates are not an invoice; presentation documentation/tests made no paid call.
- 2026-09-25 final-path browser update: root verified 5-node/4-link Recorded path versus 20-node/43-link Full source context, actual summary I/O, stable observed-edge inspection, dark fullscreen, reverse Tab and Escape restoration. Latest build passed; later responsive/keyboard results completed the final gate above.
- 2026-09-25 final responsive update: nested-modal Escape priority, forward-Tab wrap, edge labels and 390×844 layout passed. A two-peer-row recorded star put arrows behind other cards and suggested a chain, so the final path returned to four peer rows with 28px spacing. Latest build passed; restored-viewport/System-theme visual check passed with empty console warning/error logs. These are task-browser observations, not newly claimed screenshot artifacts.
