# Failure-mode review

2026-09-25, Phase 1 working checkpoint. Product context: approved APP-BRIEF and eleven journey gates. Severity / occurrence / detection are scored 1–10; RPN is the product. Priority follows the protocol: RPN ≥200 is P0, 100–199 is P1, and below 100 is P2. Critical unresolved issues on enabled paths block handoff. See [QA-REPORT.md](QA-REPORT.md) for evidence and the final verification boundary.

## Fixed before checkpoint
- Exported browser server abort handling (7×3×3=63): interrupted POST-body reads are caught; a fresh exported ZIP passed five targeted tests/subtests, including abort survival and subsequent HTTP responses. The saved ZIP was regenerated and passed final clean-install, graph and runtime-import checks with the fix included.
- Hidden policy bypass (9×4×7=252): hidden executable nodes rejected; supporting nodes use dependency edges.
- Trusted Git pin bypass (9×3×8=216): replacements disabled, GIT_* overrides removed, bundled sources verified against inspected commit; adversarial test passes.
- Credential serialization corruption (7×4×5=140): recursive value redaction preserves JSON structure, including ordinary Bearer text.
- Campaign budget replacing graph budget (8×4×6=192): both per-run and shared caps enforced; no workbench provider fallback or automatic provider retries. The trusted adapter preserves the original source’s bounded coverageBrief retry and records its evidence.
- Campaign source revision drift (8×3×6=144): repo and graph snapshots pinned for child runs.
- Docker child outliving cancellation (8×3×7=168): named container force-removed on exit, timeout, abort and output limit. Real Docker availability gate remains closed on this machine.
- Account-agnostic verification badge (6×4×6=144): successful inference recorded per credential/model pair; metadata alone is advertised, not verified.
- Export budget drift (8×3×6=144): the exported runner now enforces graph call/time limits and rejects unknown pricing under a configured dollar cap. It does not inherit the workbench’s global ledger; export QA spend is tracked separately.
- GitHub acquisition executes local Git hooks/filters or reuses the wrong checkout (9×3×7=189): strict credential-free HTTPS URLs, disabled inherited/global/system configuration and hooks/templates/submodules, checked origins/configuration, bounded CLI calls and locked atomic publication. Fixtures test hostile config, concurrent clone, origin mismatch and preservation of local edits; authenticated acquisition also passed.
- Provider model-list drift (6×6×4=144): real 404 retained and choice disabled; adapter filters out incompatible audio/image/agent endpoints.

## Mandatory category sweep

**Mandatory coverage: 12/12 categories reviewed.** Scope: enabled local UI/API journeys, the pinned imported overview, GitHub acquisition, provider boundaries and generated exports. Evidence: reviewed source and tests, the final 56/56 zero-skip suite, production build, retained live/fixture outputs and Codex in-app browser observations linked in [QA-REPORT.md](QA-REPORT.md). Hosted operation, arbitrary-code Docker execution and unsupported repository paths are excluded from passed coverage. Root performs the separate staged review after staging.
- Unhandled errors: API returns explicit JSON errors; run/campaign errors retain evidence. Export streaming errors terminate response.
- External dependencies: 401/403/404/429/timeouts/truncation tested with mocks; live Gemini metadata and inference tested. Other providers remain unverified live.
- Race/state: immutable revisions and campaign snapshots; global provider semaphore. Workspace is deliberately single-process/local.
- Resource exhaustion: bounded graph/input/output, provider concurrency, calls, timeouts, revisions and capped regex execution. Long-term trace retention/compaction remains a scale limitation.
- Access/security: loopback Host/Origin/content-type checks; session vault; Git-ignore first; isolated source execution; no arbitrary imported execution.
- Partial writes: atomic workspace snapshot plus append-only events. Restart marks incomplete jobs interrupted; journal replay after a crash between append and snapshot remains a limitation.
- Observability: node events for success/failure/blocked/cancel; imported hidden artifact-store event retained. Token-level streaming is not implemented.
- Scale/load: designed for one local user, not hosted concurrency or multiple processes. No production readiness claim.
- Billing/credits: imported billing disabled. Known pricing + bounded reservations under dollar cap; usage and estimates visible. Provider invoice can differ.
- Retry/idempotency: bounded graph reflection, no workbench provider auto retry or fallback; the original overview keeps its inspected single coverageBrief retry within the adapter call cap. Cancelled/interrupted runs are not replayed. GitHub reuse does not reset local changes or automatically refresh upstream.
- Config drift: versioned graph/suites, source-pinned adapter, explicit account/model validation. Model metadata may still overstate access until first inference.
- Product edges: unsupported repo/model/code/scope blocks with reason; Codex in-app browser checks covered GitHub connection, old-revision inspection, node output, eval regression, five comparison columns and modal keyboard flow. Mobile navigation, project switching, schema/edge edits, a live UI run and a UI-created eval also passed. The final Model Lab automatic-selection correction and persisted-project reload passed. The exported wrapper’s HTTP boundary and abort survival have separate free regression coverage.

## Residual risks and release boundaries


- **P2 — Imported adversarial result may be unscored (6×5×2=60).** One live connected probe failed original schema validation, then hit the output-token cap on the original source retry. The campaign correctly retained an inconclusive finding. Do not claim that brand behavior passed; reliable adversarial schema handling needs further adapter/model evaluation.
- **P1 — Pricing/model compatibility drifts (8×4×4=128).** Gemini 3.5 Flash rates were corrected to US$1.50/US$9.00 per million input/output tokens. The local runtime and ZIP now share `server/pricing.ts`; historical trace estimates can retain prior rates. Ledger reservations and the explicit US$3 test cap constrain this build, but they are not a provider invoice or an account-wide limit. The four other providers have mock coverage only.
- **P2 — Clean-export success is sampled (6×3×4=72).** One support-app CLI export passed install/check/live execution; the endpoint does not validate every package. The wrapper has free HTTP-boundary coverage, while its interactive model-backed browser journey is separate from the live CLI sample. The endpoint does not repeat these checks for every graph export.
- **P1 — Local snapshot/journal and trace growth (5×4×5=100).** Single-process ownership, private file permissions and restart handling reduce the current risk. Cross-file crash consistency, migrations, compaction and hosted tenant authorization remain future work.

No additional unresolved P0 was identified in the reviewed enabled local paths; this is a bounded review, not a full security audit. Docker custom-code execution, full lesson generation, broad repository instrumentation, hosted authentication/database and cloud deployment are explicitly unavailable, not passed. AWS profile setup created no cloud resources. Final root verification and Codex in-app browser evidence passed for the stated local boundary.

## Final staged gate
Light review checked the staged API/GitHub/export/pricing/provider and UI changes against the approved brief. Coverage: 12/12 categories assessed; no new P0/P1 regression found in enabled local paths. Exact configured-secret scan passed, credential/local-evidence paths remain untracked, and diff whitespace checks passed. The final suite has 56 passing tests with zero skips; the production build and targeted final UI checks passed. Residual product boundaries above remain explicit.
