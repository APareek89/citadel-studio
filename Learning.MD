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

## 2026-09-25 — Cost table drift
Symptom: the first Gemini 3.5 Flash comparison used a lower sibling model's rates.
Why 1: a manually copied price row was incorrect.
Why 2: the export runner held a second table that could drift separately.
Deepest why [design]: billing estimates need one verified, dated source and regression cases for similarly named variants.
Action: verified standard rates against Google's pricing page, extracted server/pricing.ts for both runtimes, tested long-context and scheduled rate boundaries. Added an explicit cost-correction event to the affected historical run and adjusted the local QA ledger; preserved its input, output, graph and original event evidence.
Prevention: unknown model prices remain unknown and dollar-capped execution rejects them. Figures remain estimates, not invoices.

## 2026-09-25 — Inspector and schema editor state
Symptom: an unchanged empty schema could become an active JSON constraint; historical graph views could expose the current draft in the inspector.
Why 1: editor blur serialized an empty object as an intentional constraint; the inspector reused project state.
Why 2: presentation state and execution snapshots shared convenience paths.
Deepest why [design]: edits must express intent and trace inspection must derive from the recorded snapshot.
Action: preserve absent schema on no-change blur; historical inspectors read their immutable run graph and disable edits.
Prevention: saved-edit, schema-output and old-revision journeys are part of the browser QA gate.

## 2026-09-25 — Export browser disconnected request
Symptom: an aborted partial POST terminated the exported local browser server.
Why 1: ECONNRESET escaped the asynchronous request-body iterator.
Why 2: input validation covered complete malformed bodies, not transport interruption.
Deepest why [testing]: exported applications need independent transport-failure tests, not just happy-path executor parity.
Action: catch interrupted body reads, close only that response, and keep the server available.
Prevention: fresh-ZIP regression sends an interrupted raw request and then proves the server still handles a new request, with provider networking disabled.

## 2026-09-25 — Persisted selection initialized before data
Symptom: reload remembered the project selector but left its brief and graph editor empty.
Why 1: the initialization effect ran before the bootstrap response.
Why 2: its dependency was the already-persisted ID, which did not change when data arrived.
Deepest why [state]: depend on the availability of the resolved project, not just an identifier.
Action: initialize from project?.id; confirmed saved brief, plan and graph restore in Codex's browser.
Prevention: reload is part of the persisted-project journey, separate from switching projects.
