# Architecture decisions

25 September 2026. The approved scope is [APP-BRIEF.md](../planning/APP-BRIEF.md). These decisions explain the implementation direction; they do not establish that every journey has passed QA. Current source coverage and planned boundaries are recorded in [ARCHITECTURE_FLOW.md](ARCHITECTURE_FLOW.md).

## 01 — One local application, five modes

**Chosen:** React/TypeScript interface and a local Node/TypeScript API, with shared graph, project, run and evaluation contracts. Build, Connect, Red Team, Model Lab and Evals consume the same runtime services and history.

**Reason:** an edit, diagnosis, comparison and regression test should refer to the same revision and invocation evidence. This limits divergent execution semantics between screens.

**Rejected:** five independent tools or services, each maintaining its own graph and credential storage. That would make the interface look unified while the behavior and evidence differ.

**Consequence:** phase 1 is a single-user local application. It is not a hosted multi-tenant service; tenant authorization and cloud persistence remain phase 3.

## 02 — The manifest owns new workflows; imported code owns imported workflows

**Chosen:** versioned graph definitions govern new workflows. Editable prompts, supported code nodes, policies, schemas and typed data/feedback edges have explicit runtime meaning. Imported application maps retain source locations and declared/inferred/observed relationship provenance.

**Reason:** the graph is useful only if it accurately represents the execution the user can change. Code discovery cannot prove every dynamic branch.

**Rejected:** arbitrary two-way synchronization between any repository and an editable visual graph. Unsupported components remain opaque, with source inspection available. A static map is not a successful instrumented run.

**Consequence:** source-owned imported graphs cannot silently become executable manifest graphs. Local paths and strict HTTPS GitHub URLs are accepted. GitHub acquisition uses the existing CLI login, a shallow managed checkout and disabled hooks, templates and submodules. Reusing a checkout preserves its current files; it does not silently pull or reset. Repository acquisition and live adapter coverage are separately identified and gated.

## 03 — Roles describe purpose; the runtime determines execution

**Chosen:** explicit roles for orchestrator, agent, tool, validator, guardrail, output, resource and opaque code. In the initial manifest runtime, an agent invokes a model; deterministic tools and checks remain code. The original kingdom vocabulary is optional product language.

**Reason:** a reviewer or coordinator need not be a model. Treating every box as an autonomous agent increases cost and hides simple logic.

**Rejected:** a mandatory LLM “King” routing every operation or prompt-based policy labels presented as enforceable guarantees.

**Consequence:** the inspector and architecture diagrams identify model calls separately from deterministic functions. Schemas establish shape, and phrase checks establish configured conditions; neither proves factual truth.

## 04 — Supporting resources are collapsed, not omitted

**Chosen:** UI files, DB/auth wiring, Markdown and other supporting resources remain in the same application graph as hidden resource nodes, accessible through search and the inspector.

**Reason:** the main graph must be readable without losing the source context needed to debug the application.

**Rejected:** drawing every source file on the execution canvas, or treating hidden resources as unversioned material outside the application.

**Consequence:** only resource nodes may be hidden; graph validation rejects hidden executable nodes so a visibility setting cannot remove a check. A documentation link does not automatically inject its text into a prompt. A dependency edge does not schedule execution. Supporting failures must remain discoverable through the affected invocation or source.

## 05 — Credentials live on the local server

**Chosen:** provider keys are added to an in-memory server vault or imported from the specifically configured local secrets file. The UI receives credential metadata and opaque IDs. Provider calls use fixed HTTPS provider endpoints. Keys are excluded from graph/run exports.

**Reason:** the browser needs to select a credential, not persist or expose its value. Existing local secrets can be used without copying them into source files.

**Rejected:** browser localStorage, credentials embedded in the graph, unrestricted client-supplied provider URLs, or exporting keys into generated applications.

**Consequence:** restart requires re-adding or re-importing credentials. Imported graphs and prior runs can persist while their credential references become unavailable. Redaction is defense in depth, not a substitute for preventing secrets from entering model context.

## 06 — Model access, advertised capability and verified execution are different states

**Chosen:** discover provider models using each credential; apply adapter capability constraints; mark real execution separately from metadata discovery. Five candidate slots may reuse a credential. Unsupported model overrides are explicit, and provider fallback stays off.

**Reason:** a valid key or recognizable model name does not prove that a request shape, structured output mode or application override is supported.

**Rejected:** calling every provider/model combination “verified,” silently changing models, or treating one prompt as a robust model ranking.

**Consequence:** comparison and campaign execution pin graph and repository snapshots so reconnecting the project cannot change later child runs. Inference failures preserve other comparison results. Unknown cost remains unknown; estimates need declared provider/model rates and cannot be treated as final billing. Compatibility heuristics need retained tests before their coverage is expanded.

## 07 — Bound execution and preserve each invocation

**Chosen:** graph validation precedes inference; timeouts, cancellation, model-call and revision limits are server-enforced. Every run captures a graph snapshot and append-only events; repeated visits to a node are separate invocations. Only accepted output is released. When configured, a persistent server-wide spend ledger adds a known-price reservation before provider dispatch.

**Reason:** live node illumination is useful only when it corresponds to real events, and repairs must terminate predictably.

**Rejected:** unlimited reflection, replacing a node's previous output with its latest result, or exposing an unchecked draft as final output.

**Consequence:** cancellation and restart preserve partial evidence. Restarted jobs become interrupted instead of silently replaying side effects. A replay of recorded events and a fresh model run are different operations.

## 08 — Local journal and snapshot before a hosted database

**Chosen:** a private local data directory stores workspace snapshots and JSONL run events. Files use restrictive permissions. The server restores projects and explicitly marks unfinished runs/reports/campaigns as interrupted or incomplete after restart.

**Reason:** phase 1 needs durable evidence, not cloud infrastructure or account setup.

**Rejected:** storing the authoritative workspace only in browser storage, or provisioning a hosted database before the local journeys work.

**Consequence:** this store assumes one server process owns it. It is not a concurrent distributed database, and the snapshot and journal are not a cross-file transaction. Backups, migrations, multi-process locking and retention must be addressed before a broader deployment.

## 09 — A narrowly trusted source adapter is separate from arbitrary-code execution

**Chosen:** the first live import covers the inspected Learning Studio overview path at a pinned source revision. The adapter must verify the trusted source, isolate execution, mediate model calls and replace external persistence/retrieval with explicit local test boundaries. Arbitrary user-authored code requires the separately constrained Docker path.

**Reason:** the user needs a real imported application run, while an arbitrary repository must not inherit access to the host filesystem, provider credentials or external accounts.

**Rejected:** executing unrecognized repositories with the host's privileges, pretending all discovered paths are instrumented, or calling ungrounded output retrieval-backed when retrieval is disabled.

**Consequence:** the overview adapter must fail closed on source/platform mismatch. Full lesson generation remains discovery-only until explicitly supported. Docker absence blocks arbitrary-code nodes; it does not justify running them directly in Node. Cancellation must terminate the actual isolated workload, not only its launcher.

## 10 — Red-team findings and evaluation verdicts retain provenance

**Chosen:** Red Team separates source review from behavioral tests. Every connected repository or uploaded folder can prepare a free, bounded source plan; discovery-only imports default to it. Explicit approval and a compatible model start one source-review call, capped at US$0.25, 90 seconds and 4,096 output tokens, without executing the target. Behavioral tests require an executable manifest or the supported source adapter and retain their finite, approved probe plan. Findings distinguish reproduced behavior, source-only suspicion and inconclusive results. Evals retain case, rubric, graph/model and source-run versions; infrastructure errors stay separate from quality failures.

**Reason:** the product should help users repair an issue and test that repair, without turning a plausible model statement into a claimed vulnerability or a transport error into a failed answer.

**Rejected:** unrestricted autonomous probing, production side effects, treating a source map or trace connection as an execution adapter, generating paid probes for an unsupported target, hidden model-judge criteria or silent baseline replacement.

**Consequence:** source review reads protected, scrubbed excerpts from at most 30 files / 60,000 numbered characters and labels every accepted finding suspected. A strict response schema and exact quote beginning on the cited supplied line are required; omitted or clipped lines cannot be bridged. Rejected citations and model failures produce inconclusive evidence, never a pass or reproduced vulnerability. Approved graph/repository identity and source-evidence digest are rechecked before dispatch; old unpinned plans must be prepared again. Source lookup opens the current checkout, not a historical file snapshot; the saved safe quote remains the finding's evidence. The behavioral planner labels security, brand and customer concerns but does not spawn autonomous specialist agents. Promotion to eval drafts criteria for user review and does not create an unsupported target runner. Model reasoning remains fallible even when its citation is genuine.

## 11 — Launch initially means a portable project download

**Chosen:** export source, graph configuration, dependencies, checks, setup instructions and a secret-free environment template, with both a CLI and a minimal local browser wrapper. The support-app export passed a clean-directory install, graph check and live CLI sample. The download endpoint does not perform that verification automatically for every ZIP; the browser wrapper passed free HTTP boundary and interrupted-upload regression tests; an interactive model-backed browser journey is separate.

**Reason:** this gives the user an application they can own while keeping hosting separate from local development.

**Rejected:** a decorative download containing only graph JSON, or claiming deployment merely because a ZIP exists.

**Consequence:** source-owned imports remain in their original repository and are rejected by this export path. The exported runner enforces graph call/time limits and a configured known-price dollar cap; it has a separate process and does not inherit the workbench’s persistent global spend ledger. A successful CLI sample is not a hosted deployment or full browser acceptance test.

## 12 — Standalone diagrams and staged AWS hosting

**Chosen:** Mermaid source plus a standalone HTML viewer; no in-app debug tab. Architecture diagrams are authored and must change with the source. Phase-3 AWS recommendations remain separate in [AWS-READINESS.md](AWS-READINESS.md).

**Reason:** this matches the user's chosen review surface and keeps local feature verification independent of infrastructure changes.

**Rejected:** a debug panel shipped as product UI, or treating the local Docker/repository environment as if it can be moved unchanged into a Lambda function.

**Consequence:** the generated viewer loads Mermaid from a CDN and needs connectivity to render. AWS CLI/profile setup is complete, but no cloud resources have been provisioned. Hosted repository/code execution needs an authenticated local runner or a separately designed hosted sandbox; neither is implied by hosting the UI.

## 13 — Presentation can simplify source maps without rewriting execution

**Chosen:** keep the versioned graph and canonical edge IDs authoritative. A deterministic, browser-side layout groups cyclic and related components; an imported source overview may show a connected subset while every workflow node and explicit feedback edge remains available. All connections and executable-manifest views preserve every original visible relationship, including parallel edges. Supporting resources remain separately inspectable. External traces additionally offer Recorded path (event-backed nodes and original observed relationships) and Full source context (the complete saved run graph).

**Reason:** the user needs a readable entry point and full control. Candidate coverage does not establish usability, and losing a feedback contract is more serious than displaying another arrow.

**Rejected:** saving a reduced graph over the original, inventing links or chronological arrows to make a neat diagram, treating same-rank peers as parallel execution, using endpoint deduplication as the meaning of All connections, or lighting unvisited source nodes as though they executed.

**Consequence:** layout is free local computation and does not remap source or invoke a model. Fullscreen, Fit/Focus, labels, path/context scope and inspector visibility are temporary exploration state. Coordinates and routing hints do not change relationship kind, provenance, invocation history or scheduler behavior. The helper contract including external path has 16 passing free checks and the initial desktop pass succeeded; final revised-control browser/build acceptance remains explicit in [QA-REPORT.md](QA-REPORT.md).

## 14 — Mutations preserve ownership and the user's latest intent

**Chosen:** Build alignment only targets manifest-owned projects. Each alignment request captures current project state; only the newest request may publish, and only if graph, source, brief, name and prior alignment still match. Suite version updates require an existing suite belonging to the selected project. Behavioral probe proposals validate their allowed specialist and nonempty input/description before becoming approvable. Browser drafts reset on project changes and selected histories must belong to that project. Catalog results are cached under their requested credential; defaults resolve against the current credential and removed credentials are reconciled on refresh.

**Reason:** syntactically valid output can still be wrong for the user's current project or action. The approved brief requires immutable evidence and reviewed plans, which includes the transitions that create them.

**Rejected:** last-response-wins planning, silently treating a missing suite ID as a new first version, cross-project suite lineage, or coercing malformed model values into apparently valid probes.

**Consequence:** stale work returns an actionable rejection and leaves the newer project intact. Foreground mutations temporarily disable project/new/navigation controls, brief presets and graph mutation controls, with a central graph-update guard. A save response therefore cannot replace edits accepted during its request. Inspector read-only ownership and temporary busy locking remain separate so the explanation stays accurate. Comparison effects change observed view only on Graph Results; completed background evidence remains project-scoped. An already-dispatched model call may still incur cost; the publication guard is not automatic cancellation. Retrying requires the user to prepare work against current state. Browser selection/reset and delayed-edit behavior have their own verification gates beyond API/service tests.

## 15 — Detect stale clients without discarding drafts

**Chosen:** the local production health endpoint returns the current hashed UI entry. Published HTML/assets use `Cache-Control: no-store`. A client containing the checker compares its loaded entry on focus/visibility and every 30 seconds while visible, then offers an explicit reload when a newer build differs. Dirty graph edits disable reload; other unsaved form entries receive a warning.

**Reason:** a browser can keep executing an old bundle after the server's files change. A successful build cannot by itself establish what the user sees.

**Rejected:** automatic refresh that loses work, a version label unrelated to the shipped bundle, or claiming all open legacy clients update themselves.

**Consequence:** development mode has no production-entry comparison; an unreachable health check does not trigger reload. A tab loaded before this checker existed still needs an ordinary reload. Offline simulated journeys, interactive browser acceptance and live provider checks remain three distinct evidence layers.

Production startup now requires a completed build. Only `WORKBENCH_DEV=1` enables Vite, and `npm run dev` sets it explicitly; a missing production build fails before listening instead of silently changing the serving mode. Health uses the captured startup mode. The reproduced development fallback invalidated the early checks as production UI acceptance; root repeated the offline journey after a stable build. This is a QA environment correction, not a confirmed explanation of the user's earlier screen.

## 16 — Preserve the original structured-call contract across provider substitution

**Chosen:** the pinned Learning Studio shim serializes supported original Zod types into a bounded response schema and sends it through validated IPC, the bounded generator and provider gateway. Gemini receives `responseJsonSchema` with JSON MIME mode; a Gemini model without advertised structured support rejects. Other provider adapters retain explicit schema instructions and available JSON mode, followed by the original local Zod validation. The source repository is unchanged. The adapter implementation follows Google's [GenerateContent API](https://ai.google.dev/api/generate-content).

**Reason:** prompt-only JSON and provider-enforced response shape are different contracts. Substituting a provider must carry required nested fields, arrays and enum values through every boundary, while keeping local validation authoritative.

**Rejected:** silently dropping the schema, treating all five providers as having the same native guarantee, weakening the original validator, accepting arbitrary schema references or adding an unapproved fallback provider.

**Consequence:** the IPC accepts only the reviewed schema vocabulary, at most 20,000 serialized characters, depth 12, 80 properties/required entries/enum values and five anyOf alternatives. Unsupported Zod converter types fail closed; this is not a universal Zod-to-JSON-Schema implementation. Existing six-call, 1–3,000-output-token and sandbox limits remain. Thirty-one focused fixture checks include the actual original sandbox workflow with three mocked model calls. Post-fix live evidence remains a separate gate, and native structure does not prove factual or semantic quality.

## QA evidence boundary

Live inference in this checkpoint used Gemini only; the other four provider adapters are fixture-tested. One connected red-team probe remains inconclusive after schema validation and an output-cap failure. These limits are preserved in [QA-REPORT.md](QA-REPORT.md). AWS setup is read-only and Docker is absent. No hosted auth/database or general repository runtime is implied by the local MVP.

The new complete-flow simulations use temporary state and only provider fixtures/loopback integrations: Build has 11 passing checks, assessments 14 and Connect 8. The latest merged receipt is 181/181 with a passing build. Root repeated production offline UI checks for project/mode locks, suite/input reset, five comparisons/graph results, an approved red-team run, credentials after restart and dirty/saved update-banner reload. Final preset/save guards passed with 1,500ms injected delays and external fetch blocked: controls locked correctly, revision 3 saved, and editing resumed without losing dirty-state behavior or showing false immutable-history copy. The schema-transport fix has focused/free coverage, a successful same-input live overview and a one-case/five-assertion eval pass; exact scope is in QA-REPORT.md. Final gates belong to QA-REPORT.md. Native fixture tracing proves instrumentation and diagnosis evidence, not execution of the imported repository; fixture citation checks do not validate a model's diagnosis.
