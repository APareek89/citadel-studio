# Learning
Log material flow changes and bugs with a five-whys chain; target the deepest actionable cause.

## 2026-09-25 — Prototype was insufficient for Phase 1
Symptom: static mock visually described capabilities but could not prove the credential-to-run journey.
Why 1: node execution was simulated.
Why 2: the initial request mixed a dummy HTML request with the intended product.
Why 3: acceptance journeys were not yet articulated.
Why 4: visual completeness can hide absent runtime behavior.
Deepest why [process]: establish executable exit criteria before presenting a product as working.
Action: approved brief and eleven journeys now gate delivery; fixture and live evidence are labelled separately.
Prevention: every mode needs an actual bounded operation, recoverable errors and retained evidence.

## 2026-09-25 — Model metadata overstated account access
Symptom: Gemini listed 2.5 Flash Lite but inference rejected it for this account.
Why 1: listing does not guarantee inference availability.
Why 2: lifecycle restrictions depend on the account.
Why 3: the adapter initially treated metadata as sufficient availability evidence.
Deepest why [design]: capability discovery and proven account execution need separate states.
Action: retain advertised versus verified status, scope verification to credential/model, disable a rejected pair, and use the explicitly recommended current model for QA.
Prevention: mocked 404/429/truncation tests and real bounded inference at integration milestones.

## 2026-09-25 — Hidden policy and source-pin trust boundaries
Symptom: review found hidden executable nodes could bypass checks, and Git replacement objects could bypass a source pin.
Why 1: visual hiding affected scheduling; normal Git source reads honored replace refs.
Why 2: presentation flags and convenience APIs were reused as execution trust boundaries.
Deepest why [design]: explicitly validate execution semantics and trust exact source bytes, not just labels.
Action: executable nodes cannot be hidden; supporting resources remain collapsed but traceable. Trusted reads disable replacement objects and inherited Git overrides.
Prevention: adversarial tests for hidden policy, replacement blobs, sandbox file/network/process restrictions and cancellation.

## 2026-09-25 — Browser workflow correction
Symptom: QA opened task browser sessions outside Codex.
Why 1: the default Playwright CLI workflow launched external Chrome.
Why 2: the user's desired browser location was not stated until QA.
Deepest why [process]: carry this project's explicit browser constraint forward.
Action: closed task-owned external sessions and moved further browser work to root's Codex in-app tab.
Prevention: project README and handoff specify Codex in-app browser only; subagent inability to access it is not a reason to open Chrome.
