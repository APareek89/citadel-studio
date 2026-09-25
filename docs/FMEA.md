# Failure-mode review

2026-09-25, Phase 1 working checkpoint. Product context: approved APP-BRIEF and eleven journey gates. Severity / occurrence / detection are scored 1–10; RPN is the product. Critical unresolved issues block handoff.

## Fixed before checkpoint
- Hidden policy bypass (9×4×7=252): hidden executable nodes rejected; supporting nodes use dependency edges.
- Trusted Git pin bypass (9×3×8=216): replacements disabled, GIT_* overrides removed, bundled sources verified against inspected commit; adversarial test passes.
- Credential serialization corruption (7×4×5=140): recursive value redaction preserves JSON structure, including ordinary Bearer text.
- Campaign budget replacing graph budget (8×4×6=192): both per-run and shared caps enforced; no model fallback or hidden automatic retries.
- Campaign source revision drift (8×3×6=144): repo and graph snapshots pinned for child runs.
- Docker child outliving cancellation (8×3×7=168): named container force-removed on exit, timeout, abort and output limit. Real Docker availability gate remains closed on this machine.
- Account-agnostic verification badge (6×4×6=144): successful inference recorded per credential/model pair; metadata alone is advertised, not verified.
- Provider model-list drift (6×6×4=144): real 404 retained and choice disabled; adapter filters out incompatible audio/image/agent endpoints.

## Mandatory category sweep
- Unhandled errors: API returns explicit JSON errors; run/campaign errors retain evidence. Export streaming errors terminate response.
- External dependencies: 401/403/404/429/timeouts/truncation tested with mocks; live Gemini metadata and inference tested. Other providers remain unverified live.
- Race/state: immutable revisions and campaign snapshots; global provider semaphore. Workspace is deliberately single-process/local.
- Resource exhaustion: bounded graph/input/output, provider concurrency, calls, timeouts, revisions and capped regex execution. Long-term trace retention/compaction remains a scale limitation.
- Access/security: loopback Host/Origin/content-type checks; session vault; Git-ignore first; isolated source execution; no arbitrary imported execution.
- Partial writes: atomic workspace snapshot plus append-only events. Restart marks incomplete jobs interrupted; journal replay after a crash between append and snapshot remains a limitation.
- Observability: node events for success/failure/blocked/cancel; imported hidden artifact-store event retained. Token-level streaming is not implemented.
- Scale/load: designed for one local user, not hosted concurrency or multiple processes. No production readiness claim.
- Billing/credits: imported billing disabled. Known pricing + bounded reservations under dollar cap; usage and estimates visible. Provider invoice can differ.
- Retry/idempotency: bounded graph reflection, no provider auto retry or fallback; cancelled/interrupted runs not replayed.
- Config drift: versioned graph/suites, source-pinned adapter, explicit account/model validation. Model metadata may still overstate access until first inference.
- Product edges: unsupported repo/model/code/scope blocks with reason; mobile project access and labels checked before handoff.

No unresolved P0 on the enabled local paths. Docker custom-code execution, broad repository instrumentation and hosted deployment are explicitly unavailable, not passed.
