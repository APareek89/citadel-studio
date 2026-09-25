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


## 2026-09-25 — Private source access was mistaken for mapping support
Symptom: Demo Studio showed one unresolved entry although GitHub access succeeded.
Why 1: source discovery excluded Python; the generic importer was only an inventory.
Why 2: authentication, structural interpretation and runtime observation shared an ambiguous connect journey.
Deepest why [design]: make each capability independently visible and verifiable.
Action: PAT/CLI and folder access; Python/TypeScript syntax candidates; a small LLM groups source-backed responsibilities; deterministic references/candidate accounting retain uncertainty. Native/Langfuse traces are a separate connection.
Prevention: actual private Python/TypeScript repositories, omitted/forged candidate fixtures, bounded evidence labels and distinct source-versus-observed graph views.

## 2026-09-25 — Mapping evidence, upload identity and trace boundaries
Symptom: a first AI map exposed 92 cards; uploads lost their chosen name/inherited parent Git; out-of-order completed spans finalized too early; multiline secrets/object keys escaped redaction.
Why 1: evidence excerpts favored file prefixes, candidate-level checks were coupled to body excerpts, filesystem ancestry implied repository ownership, and individual span completion implied trace completion.
Why 2: tests covered simple string values and in-order lifecycle, but not representation/transport boundaries.
Deepest why [design/testing]: validate semantic coverage, source identity and trace finality separately from convenient representations.
Action: supply all parser-backed headers plus bounded DSL excerpts, cap 20 semantic groups, preserve unresolved references, deduplicate projected relationships; verify Git root ownership; retain upload names; require explicit native finalization; scrub whole files with line preservation and redact JSON keys.
Prevention: source-preview, multiline/PEM, property-key collision, nested Git root and partial-batch regressions; stale mapping completions reject changes to a newer project connection.

## 2026-09-25 — A complete source map was still messy to use
Symptom: the user found the mapped graph difficult to follow and asked for a clean graph, fullscreen exploration and a real Demo Studio check. Accounting for 92 candidates in 16 nodes did not establish readable navigation.
Why 1: many source relationships, provider fan-in and labels competed for attention in a constrained canvas.
Why 2: one generic layout exposed the entire relationship set without a separate overview and deliberate inspection controls.
Why 3: the implementation treated mapping coverage as the main acceptance test, although the product's promise is understanding and control.
Why 4: fixture checks and candidate counts did not ask whether a person could follow the actual application's responsibilities, then inspect the relevant connection and output.
Deepest why [design/process]: graph truth and graph presentation need separate contracts, and readability needs a customer journey using the real connected app.
Action: a presentation-only helper lays out cycles, disconnected components and peer groups without mutating the source graph; overview, All connections, Fit/Focus, node jump, optional labels and fullscreen provide progressive detail. Twelve free helper checks pass. Browser acceptance is recorded in Loop.MD; runtime proof is tracked separately from source-map readability.
Prevention: F10–F12 require actual Demo Studio navigation, complete edge inspection, immutable trace output and fullscreen keyboard/mobile checks. Never count candidate coverage or a screenshot alone as proof that the graph is usable.

## 2026-09-25 — Simplifying arrows could hide execution contracts
Symptom: review reproduced an overview showing only one of two feedback returns and an All connections count of seven with only six representative arrows.
Why 1: endpoint deduplication and a spanning overview were applied to executable manifests and recorded runs as well as imported source maps.
Why 2: presentation routing hints and compactness were allowed to substitute for the original edge list.
Deepest why [design]: reducing visual clutter must never reduce editable execution contracts or claim runtime facts from layout geometry.
Action: the tested selection contract restricts source simplification to an imported, unobserved source overview, always retains explicit feedback, and returns every original visible edge in All connections and executable-manifest views. Root verified fullscreen/overview, focus, responsive controls and revised-trace UI acceptance.
Prevention: keep original IDs, instructions and provenance authoritative; test parallel edges, multiple feedback returns and historical evidence alongside visual packing. A return-shaped line is not automatically a feedback policy; nodes sharing a layout rank are not proof of parallel execution.

## 2026-09-25 — An observed graph still exposed unexecuted source clutter
Symptom: the new external trace showed 20 context nodes and 43 edges even though only five nodes had invocation events.
Why 1: the trace correctly retained its whole source snapshot, but rendered that full context as the default activity view.
Why 2: preserving context and presenting the recorded path were treated as the same requirement.
Deepest why [design]: keep source context available while making the scope of actual observation explicit.
Action: add an external-trace-only Recorded path projection from node events and original observed edges, alongside Full source context. Do not invent sequence edges from event timestamps. Four projection regressions pass; browser evidence shows 5 recorded nodes / 4 observed links versus 20 nodes / 43 context links, with real node I/O and stable arrow inspection. Packing the star into two peer rows made links pass behind cards and suggest a chain; restore four peer rows with a 28px gap.
Prevention: test traces with many unvisited source nodes, disconnected observed operations and repeated invocations. Inspect routed arrows as well as non-overlapping rectangles: a tidy packing can still imply a false relationship. A projection changes what is shown, never the stored run graph or the meaning of its relationships.
