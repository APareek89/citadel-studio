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

## 2026-09-25 — Red Team treated a source connection as an execution runner
Symptom: the user selected the connected Demo Studio application for red teaming and hit the unsupported-runner error.
Why 1: the journey offered behavioral probes even though this repository had source mapping and observation, but no general execution adapter.
Why 2: Red Team exposed one campaign flow for two different capabilities: inspecting code and executing test inputs.
Why 3: the earlier supported overview test did not exercise an ordinary discovery-only application's complete customer journey.
Deepest why [design/testing]: connect, observe, source review and execute require separate capability contracts before the user submits work.
Action: every imported repository can prepare a bounded source-review plan without credentials or inference. Explicit approval plus a compatible model starts at most one review call, capped at US$0.25 and 90 seconds; no target code or probes execute. Behavioral mode remains gated to executable manifests or the supported adapter. Graph/repository fingerprints and current source-evidence digests reject stale or historical unpinned plans before a call. Strict schema and exact supplied path/line/quote checks admit only suspected findings; invalid evidence stays inconclusive. The source viewer explicitly shows the current checkout, while the saved quotation is the review evidence.
Prevention: eight free integration fixtures cover keyless planning, unsupported behavior, one-call/no-target completion, missing credentials, graph/source drift, double starts and malformed output. Ten helper checks cover evidence bounds and citations. Full-suite and browser acceptance for this change are recorded separately in QA-REPORT.md; fixture success does not establish live review quality or a general Demo Studio runtime.

## 2026-09-25 — Passing components did not establish complete customer journeys
Symptom: the user asked for whole-flow simulation before further live work; prior test totals and selected successful screens had left cross-step failures untested.
Why 1: checks often began with prepared projects, credentials or traces rather than exercising how the user reaches those states.
Why 2: service correctness and completed customer outcomes were being counted together.
Deepest why [process/testing]: test the state transitions between product steps, including recovery and switching projects, before using component counts as release evidence.
Action: add isolated Build HTTP/independent-ZIP, Connect HTTP/downloaded-native-helper/loopback-Langfuse, and Model Lab/Evals/Red Team workflow simulations. Provider traffic is mocked and state is temporary; these checks spend no live API budget. Report their 11, 8 and 14 passing checks separately from merged-suite, browser and live gates.
Prevention: start from missing credentials or source, carry generated IDs and revisions through the full journey, preserve deliberate failures and prove recovery. Browser usability and real external integration remain separate gates; a controlled provider fixture does not establish model quality or account access.

## 2026-09-25 — Delayed planning and foreign identities could overwrite user intent
Symptom: full-flow fixtures exposed stale alignment publication, Build planning on source-owned projects, and eval updates accepting missing or another project's suite ID.
Why 1: a successful asynchronous result was allowed to publish without rechecking the state it was prepared for; suite versioning treated its prior ID as an optional lookup hint.
Why 2: validation focused on object shape instead of ownership and the user's latest action.
Deepest why [design]: every mutation needs both a valid value and an authoritative owner/version at publication time.
Action: source-owned projects reject Build planning before inference. Alignment assigns the latest request identity and checks graph, repo, brief, name and prior alignment before publication; a stale response cannot overwrite newer work. Eval version creation rejects missing or foreign suite IDs before storing a new version. Behavioral plans validate specialist, nonempty input/description and optional string failure signal before becoming approvable.
Prevention: delayed-response, concurrent-plan, project-switch, malformed-probe and missing-ID cases remain in the free journey suites. Rejected in-flight results may have consumed their original model call; preserving state is not cancellation or a billing reversal.

## 2026-09-25 — An open browser can keep using an older built interface
Symptom: rebuilding the local app does not replace JavaScript already loaded in the user's tab.
Why 1: the browser keeps running its loaded module; a current server alone does not prove a current client.
Deepest why [delivery]: expose client/server release mismatch and let the user preserve edits before reloading.
Action: production health reports the current hashed UI entry, published HTML/assets use no-store, and the client checks on focus/visibility and every 30 seconds while visible. A changed entry shows an update banner; dirty graph edits disable reload and other unsaved forms are explicitly warned about. The app never reloads automatically.
Prevention: verify the health/header contract and the actual banner/reload journey independently. This checker protects clients that already contain it; it cannot retrofit a previously loaded older bundle. Browser acceptance for this change belongs in QA-REPORT.md.

## 2026-09-25 — API isolation did not guarantee project isolation in the interface
Symptom: the subsequent UI audit found eval inputs, comparison slots, baseline and brand drafts carrying from project A into B; run/comparison/report lookup was not project-scoped. Late model-list responses could also overwrite the currently selected credential's model, while removed server credentials remained selected.
Why 1: local React state survived project switches and asynchronous callbacks captured earlier choices.
Why 2: the API suites correctly isolated stored projects but did not simulate the browser's long-lived selection state.
Deepest why [state/testing]: ownership must be checked in both the server mutation and the browser draft/selection; neither layer substitutes for the other.
Action: root added project-specific draft resets and scoped history resolution, disabled project/new/navigation controls during foreground mutations, reconciled removed/invalid credentials on refresh, and restricted defaults and required model selection to the current credential's compatible catalog. Source inspection confirms these changes; the subsequent UI/browser gate is still recorded separately.
Prevention: deliberately fill A's drafts, switch to B, inspect results, race two model catalogs and remove/restart credentials before returning to the screen. The 177-test/build receipt preceded these UI fixes and cannot be reused as their final acceptance. Release-mismatch detection is preventative, not proof that a stale bundle caused every earlier screen discrepancy.

## 2026-09-25 — A production QA server silently became a development server
Symptom: offline QA startup overlapped a Vite build temporarily removing dist; the server fell back to Vite despite WORKBENCH_DEV=0. HMR resets meant the early UI checks exercised development behavior.
Why 1: startup mode depended on the incidental presence of build output rather than the explicit requested mode.
Deepest why [environment]: a verification environment must fail when its prerequisite is missing, not silently test a different product surface.
Action: capture development mode once; only WORKBENCH_DEV=1 enables Vite, and npm run dev sets it explicitly. Production startup without dist/index.html now fails before listening with build instructions. Health reports the captured mode's entry behavior. Root restarted production QA after a stable build and repeated the affected offline checks; the missing-build regression verifies fail-before-listen.
Prevention: build to completion, start the intended mode and verify the served hashed production entry before calling browser evidence production acceptance. This was a reproduced QA-environment defect, not proof of the cause of the user's earlier screenshot.

## 2026-09-25 — Busy state protected navigation but still allowed conflicting edits
Symptom: read-only review found that brief presets could replace the visible brief during planning, and graph edits remained possible while a save was in flight. The save response then replaced the newer local draft and cleared dirty state.
Why 1: disabling the textarea, Save button and project navigation did not disable every path that mutates the same state.
Deepest why [state]: a pending mutation needs one central ownership rule, reinforced by every visible editor control.
Action: brief presets now disable while busy. The central updateGraph and connection handlers reject busy mutations; add-node, node dragging/connecting, inspector editors and limits disable too. The inspector keeps source/historical read-only state separate from its temporary lock so an ordinary draft is not falsely labelled an immutable run.
Prevention: deliberately delay planning/save and try presets, typing, graph connections and limits before the response arrives. Root's production offline browser check injected 1,500ms model and PUT delays with external fetch blocked: textarea/presets and all graph mutation controls stayed disabled, the draft showed no false immutable-history message, revision 3 saved, and editing resumed with dirty state. The latest merged receipt is 181/181 with a passing build; earlier 178-test evidence remains historical.

## 2026-09-25 — Comparison observation state affected another screen
Symptom: a Model Lab comparison effect could reapply observed view while the user was returning to the current draft.
Why 1: the effect changed a shared graph-view state beyond the screen that owned the comparison presentation.
Deepest why [state]: transient result selection must be scoped to its consuming screen as well as its project.
Action: the comparison effect sets the graph view only on Graph Results. Current-draft navigation remains a deliberate design-view action, while recorded candidate graphs stay immutable.
Prevention: include comparison → graph result → current draft → edit in the UI journey. Root's repeated production offline checks cover graph results, project/input/suite reset, busy project/mode controls, approved red-team execution, credential loss after restart and the dirty/saved update-banner path. The final busy-guard checks also passed; the separate adapter correction subsequently passed its same-input live run and one-case scored eval (QA-REPORT.md).

## 2026-09-25 — Provider substitution weakened the original structured-output contract
Symptom: live imported-app testing exposed that the isolated model shim retained schema instructions and local validation but dropped the original structured-call schema at the provider boundary.
Why 1: the bounded model-call interface carried text and token limits but no response schema.
Why 2: a prompt requesting JSON was treated as equivalent to the original structured generation contract.
Deepest why [adapter design]: replacing a provider must preserve the caller's required response contract, or explicitly disclose and gate the weaker capability.
Action: the pinned Zod shim now carries its supported response schema plus JSON intent through bounded, validated IPC and the common generator. Gemini receives native responseJsonSchema/JSON MIME configuration; other providers retain disclosed schema instructions/available JSON mode and original local Zod validation. Unsupported converter types and out-of-bounds schemas reject; no provider fallback was added and the original app source remains unchanged.
Prevention: inspect the actual outbound request shape, nested required fields and enum/array contracts, not only a convenient valid mock response. Root reports 31 focused checks, including original sandbox execution with three fixture model calls, and 181/181 merged tests/build. These establish schema transport and local validation; the same-input live overview subsequently completed and a one-case/five-assertion eval passed (QA-REPORT.md). A native schema does not establish factual correctness or exhaustive Zod/provider equivalence.


## 2026-09-25 — Alternate navigation bypassed foreground locks
Symptom: final staged review found Quick Find, Cmd+K and the brand link could change mode despite disabled sidebar controls, letting a late completion apply its step to the wrong mode.
Deepest why [state]: lock a shared navigation boundary as well as visible controls; keyboard and modal routes are still user journeys.
Action: central navigation checks busy state; Quick Find/hidden-node actions and keyboard entry respect that state. The delayed production offline browser check kept Build/Review during brand click and Cmd+K while Save was pending, then opened Quick Find normally after completion. Intended completion callbacks retain their original operation context.
Prevention: include alternate keyboard and modal entry points in race reviews, not only the primary sidebar path.

## 2026-09-25 — Local assumptions needed explicit hosted boundaries
Symptom: the locally trusted workbench could not safely be exposed by changing its bindaddress; the sourceexecutor also relies on macOS sandboxing.
Why1: localhost-only request checks, localfilesystem/secretfile imports and platform-specific execution were part of the runtime contract.
Deepest why [deployment design]: hosting changes trust and capabilities, not only the URL.
Action: retain loopback binding behind an authenticated TLSproxy; require its secret and exact origin/host; disable hostfilesystem/keyfile imports; expose execution availability before submission. Package the compiledserver with production dependencies and prove upload/export with all providerfetches blocked. Use a separate retained encryptedvolume and mount dependency for persistence.
Prevention: verify unauthenticated denial, nativeBearer exception, missinghostcapabilities, clean productioninstall and persistence on the realhost. Local success does not establish cloudacceptance; receipts live in QA-REPORT.md.
