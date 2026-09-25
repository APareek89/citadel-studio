# Architecture flow

Source-reviewed snapshot: 25 September 2026. **IMPLEMENTED** means the corresponding source exists and was inspected; it does not mean the journey has passed live QA. **PLANNED** means that boundary is not implemented. Source review is separate from free integration tests and any paid inference validation. The earlier HTML prototype is not this runtime.

This Markdown file is the canonical authored diagram source. Its Mermaid fences are mirrored in `docs/mermaid/`; the skill's build script generates `docs/architecture-flow.html`. Diagrams are not generated automatically from code. Refresh them whenever a source boundary or execution rule changes.

The user selected a standalone viewer; no in-app debug tab is included. The generated HTML loads Mermaid 11 from a CDN and needs network access to render. Diagram text stays local; the only external request is for the rendering library and its dependencies.

## Source and export implementation

GitHub acquisition is now implemented in `server/github.ts` and wired into `server/index.ts`: the UI can list repositories through the existing authenticated `gh` CLI or connect a strict HTTPS GitHub URL. The service clones into private managed storage before handing the local path to discovery. It disables inherited Git configuration, hooks, templates and submodules, validates the origin and serializes concurrent publication. Existing managed checkouts are reused unchanged. The source-adapter trust gate still applies after cloning; download is not execution authorization.

Diagram 04 now includes both GitHub acquisition and the local discovery boundary. Its Mermaid source and canonical block are synchronized; regenerate the standalone viewer with the commands below after any further diagram edit.

The manifest export now contains a CLI and a minimal local browser wrapper (`npm run serve`), alongside the shared graph executor, validation, dependencies and empty environment template. The support-app ZIP passed a clean-directory install, graph test and one live CLI sample. Diagram 06's planned **automatic** readiness gate remains accurate: the export endpoint does not run these checks for each download. The browser wrapper additionally passed free HTTP boundary and interrupted-upload regression checks. Interactive model-backed browser acceptance remains separate from the recorded CLI evidence. Source-owned imports are explicitly rejected by export.

Current evidence, live-versus-mocked provider coverage, the inconclusive connected red-team probe and final UI checks are in [QA-REPORT.md](QA-REPORT.md).

## Legend and ownership

Blue: a model generates or judges. Green: deterministic code. Purple diamonds: conditions with a named enforcer. Pale purple: a library or data store. Cyan: a question returned to the user. Gray: terminal outcome. Each box declares its input and output. `config.model` names the model chosen for that run; there is no hard-coded universal model.

New applications are manifest-owned; imported applications are source-owned. A resource/dependency edge supplies architectural context and does not itself schedule work. Only supporting resource nodes may be hidden; executable policy nodes cannot disappear from the scheduler through a visibility setting. Hidden resources remain searchable. Recorded invocation output is evidence of one run, not proof that every possible path is represented.

## Gates at a glance

| Gate | Enforcer and threshold | Source |
| --- | --- | --- |
| Graph structure | Zod: 1–80 nodes, at most 160 edges; only resource nodes may be hidden; output and feedback checks | `server/graph.ts` |
| Model/run input | Validated credential, available text model, non-empty input at most 40,000 characters | `server/runs.ts` |
| Run pressure | At most 12 active runs; at most 3 provider calls active globally | `server/runs.ts` |
| Graph budgets | 1–30 model calls, 0–3 semantic revisions, 1–180 seconds, 64–16,000 output tokens | `server/graph.ts` |
| Dollar limits | Graph cap reserves before dispatch; optional `WORKBENCH_SPEND_LIMIT_USD` adds a persistent global ledger and rejects unknown pricing | `server/runs.ts`, `server/providers.ts` |
| Provider input | Combined system/input at most 120,000 characters; call deadline at most 90 seconds | `server/providers.ts`, `server/runs.ts` |
| Source discovery | At most 500 files, depth at most 6; source reads at most 900,000 bytes | `server/importer.ts` |
| Trusted import | Approved revision and 14-file allowlist, unchanged current contents, macOS sandbox | `server/importer.ts`, `server/learning-runner.ts` |
| Imported execution | Input at most 20,000 characters; at most 6 model requests; 120 seconds | `server/learning-runner.ts` |
| Campaigns | 2–5 comparison slots; 1–20 eval cases; at most 6 red-team probes; shared budget at most 30 calls | `server/workflows.ts` |
| Arbitrary code | Docker image required; no network; 128MB; 0.5 CPU; 32 PIDs; 15 seconds | `server/sandbox.ts` |

These are implementation limits, not promises of exact provider billing or complete security isolation. Source restrictions, runtime behavior and UI coverage still require the journey tests in `Loop.MD`. The configured global spend ledger is a local estimate, not an account-wide provider billing limit.

## File index

| Stage | Diagram | Implementation |
| --- | --- | --- |
| Master | `01-master.mmd` | `web/App.tsx`, `server/index.ts`, shared services |
| Credentials/providers | `02-credentials-providers.mmd` | `server/providers.ts` |
| Manifest execution | `03-manifest-runtime.mmd` | `server/graph.ts`, `server/runtime.ts`, `server/runs.ts`, `server/store.ts` |
| Source import | `04-imported-source.mmd` | `server/github.ts`, `server/importer.ts`, `server/learning-runner.ts` |
| Product modes | `05-product-modes.mmd` | `server/workflows.ts`, `web/App.tsx` |
| Export/hosting | `06-export-hosting.mmd` | `server/export.ts`; automatic readiness gate and AWS remain planned |
| Code sandbox | `07-custom-code-sandbox.mmd` | `server/sandbox.ts` |

## Diagrams

<!-- diagram: 01-master.mmd -->

```mermaid
%% 01 MASTER — local application and ownership boundaries
%% IMPLEMENTED means source inspected, not that every live journey has passed QA.
flowchart TD
UI["IMPLEMENTED · Five-mode workspace<br/>[LIBRARY · React + React Flow]<br/>in: user goal, graph edits, selected model<br/>out: same-origin API request"]:::data
API["IMPLEMENTED · Local API boundary<br/>[FUNCTION]<br/>in: browser request on loopback<br/>out: local operation after Host, Origin and JSON checks"]:::fn
MODE{"IMPLEMENTED · Operation selection<br/>[FUNCTION]<br/>in: requested mode<br/>out: owning module"}:::dec
ALIGN["IMPLEMENTED · Alignment and generation<br/>[AGENT · selected config.model]<br/>in: brief and answers<br/>out: questions, assumptions and graph<br/>see diagram 05"]:::agent
RUN["IMPLEMENTED · Manifest execution<br/>[FUNCTION]<br/>in: graph snapshot and input<br/>out: invocation events and terminal result<br/>see diagram 03"]:::fn
REPO["IMPLEMENTED · Source discovery and trusted adapter<br/>[FUNCTION]<br/>in: selected local repository<br/>out: source map or isolated overview run<br/>see diagram 04"]:::fn
MODES["IMPLEMENTED · Compare, eval and red-team coordination<br/>[FUNCTION]<br/>in: 2–5 candidates, 1–20 cases or up to 6 approved probes<br/>out: runs with grouped evidence<br/>see diagram 05"]:::fn
EXPORT["IMPLEMENTED · Portable project export<br/>[FUNCTION]<br/>in: supported project revision<br/>out: secret-free runnable ZIP<br/>see diagram 06"]:::fn
PROVIDER["IMPLEMENTED · Provider gateway<br/>[FUNCTION]<br/>in: bounded request and credential ID<br/>out: model text and usage<br/>see diagram 02"]:::fn
STORE["IMPLEMENTED · Local workspace and event journal<br/>[DATA · private JSON + JSONL]<br/>in: snapshots and redacted events<br/>out: restorable project and run history"]:::data
RESULT["IMPLEMENTED · Inspect selected invocation<br/>[FUNCTION]<br/>in: recorded graph, input, output, status<br/>out: node detail and visible run state"]:::term
UI --> API --> MODE
MODE -->|"Build alignment"| ALIGN
MODE -->|"Build execution"| RUN
MODE -->|"Connect and Debug"| REPO
MODE -->|"Model Lab, Evals, Red Team"| MODES
MODE -->|"Launch download"| EXPORT
ALIGN --> PROVIDER
RUN --> PROVIDER
REPO -->|"only mediated model calls"| PROVIDER
MODES --> RUN
MODES -->|"source-owned campaigns"| REPO
MODES -->|"planner or judge"| PROVIDER
MODES --> STORE
ALIGN --> STORE
RUN --> STORE
REPO --> STORE
STORE --> RESULT
classDef agent fill:#dbeafe,stroke:#2563eb,color:#0b2a5b;
classDef fn fill:#dcfce7,stroke:#16a34a,color:#052e16;
classDef dec fill:#f3e8ff,stroke:#9333ea,color:#2a0a4a;
classDef term fill:#e5e7eb,stroke:#6b7280,color:#111827;
classDef ask fill:#cffafe,stroke:#0891b2,color:#083344;
classDef data fill:#ede9fe,stroke:#7c3aed,color:#2a0a4a;
```

<!-- diagram: 02-credentials-providers.mmd -->

```mermaid
%% 02 IMPLEMENTED — server credentials and five provider adapters
flowchart TD
SOURCE{"Credential source<br/>[FUNCTION]<br/>in: user-selected source<br/>out: session entry or configured file import"}:::dec
SESSION["Receive key<br/>[FUNCTION]<br/>in: key and provider<br/>out: validated length and provider enum"]:::fn
FILE["Read configured local secrets file<br/>[DATA · server-only file]<br/>in: explicitly configured path<br/>out: provider-specific key match"]:::data
VAULT["Retain key in server memory<br/>[DATA · credential Map]<br/>in: provider key<br/>out: opaque ID and public metadata"]:::data
LIST["Discover account-accessible models<br/>[FUNCTION]<br/>in: credential ID<br/>out: provider model metadata"]:::fn
CAPS["Apply text adapter capability rules<br/>[FUNCTION]<br/>in: metadata and model ID<br/>out: advertised support and verified flag"]:::fn
CHECK{"Selected model available and key validated?<br/>[FUNCTION]<br/>in: config and cached catalog<br/>out: ready or explicit error"}:::dec
ADAPT["Build fixed-endpoint provider request<br/>[FUNCTION]<br/>in: system prompt, input, token limit<br/>out: Gemini, OpenAI, Anthropic, Groq or OpenRouter body"]:::fn
SPEND{"Configured global spend guard permits call?<br/>[FUNCTION]<br/>in: known pricing and conservative token reserve<br/>out: reserve before dispatch or reject<br/>WORKBENCH_SPEND_LIMIT_USD, when configured"}:::dec
LEDGER["Record persistent spend reservation<br/>[DATA · private usage.json]<br/>in: reservation and successful reported usage<br/>out: spend carried across server restarts"]:::data
LLM["Generate model response<br/>[AGENT · config.model]<br/>in: model-specific request<br/>out: text, stop reason and reported usage"]:::agent
NORMALIZE["Normalize and redact response<br/>[FUNCTION]<br/>in: provider body<br/>out: text, usage and available cost estimate"]:::fn
RECORD["Record successful model verification<br/>[DATA · session verified-model Set]<br/>in: successful request and selected model<br/>out: verified execution label"]:::data
ERROR["Credential or provider error<br/>[FUNCTION]<br/>in: failure status<br/>out: redacted actionable message"]:::term
SOURCE -->|"session"| SESSION
SOURCE -->|"local file"| FILE
SESSION --> VAULT
FILE --> VAULT
VAULT --> LIST --> CAPS --> CHECK
CHECK -->|"yes"| ADAPT --> SPEND
SPEND -->|"allowed or guard not configured"| LLM --> NORMALIZE --> RECORD
SPEND -->|"configured: reserve before call"| LEDGER
SPEND -->|"unknown rate or exhausted"| ERROR
NORMALIZE -->|"reconcile reported successful usage"| LEDGER
CHECK -->|"no"| ERROR
LLM -->|"HTTP error, empty output or truncation"| ERROR
classDef agent fill:#dbeafe,stroke:#2563eb,color:#0b2a5b;
classDef fn fill:#dcfce7,stroke:#16a34a,color:#052e16;
classDef dec fill:#f3e8ff,stroke:#9333ea,color:#2a0a4a;
classDef term fill:#e5e7eb,stroke:#6b7280,color:#111827;
classDef ask fill:#cffafe,stroke:#0891b2,color:#083344;
classDef data fill:#ede9fe,stroke:#7c3aed,color:#2a0a4a;
```

<!-- diagram: 03-manifest-runtime.mmd -->

```mermaid
%% 03 IMPLEMENTED — preflight, scheduling and bounded reflection
flowchart TD
INPUT["Prepare run request<br/>[FUNCTION]<br/>in: project, config, non-empty input<br/>out: graph and credential references"]:::fn
SCHEMA["Validate graph structure and schemas<br/>[LIBRARY · Zod + Ajv]<br/>in: graph with at most 80 nodes and 160 edges<br/>out: errors or valid typed definition"]:::data
READY{"Preflight ready?<br/>[FUNCTION]<br/>in: model access, input at most 40000 chars, graph and sandbox status<br/>out: accept or reject"}:::dec
SNAP["Pin graph snapshot and start deadline<br/>[FUNCTION]<br/>in: accepted request; active runs below 12<br/>out: run ID and AbortSignal"]:::fn
ORDER["Order executable data graph<br/>[FUNCTION]<br/>in: acyclic data edges and bounded feedback edges<br/>out: deterministic execution order"]:::fn
MAP["Resolve node input<br/>[FUNCTION]<br/>in: edge mapping and prior outputs<br/>out: previous, original or all context"]:::fn
KIND{"Node role?<br/>[FUNCTION]<br/>in: current node<br/>out: model, tool, check or passthrough"}:::dec
BUDGET{"Provider budget available?<br/>[FUNCTION]<br/>in: calls, known-rate reserve and signal<br/>out: queue or reject<br/>maxCalls 1–30; at most 3 calls active globally"}:::dec
AGENT["Generate candidate<br/>[AGENT · run.config.model]<br/>in: prompt, mapped input, optional repair feedback<br/>out: text or schema-shaped JSON"]:::agent
TOOL["Execute declared tool<br/>[FUNCTION]<br/>in: mapped input and tool enum<br/>out: transformed text or isolated code result<br/>see diagram 07 for custom code"]:::fn
CHECK["Evaluate candidate<br/>[FUNCTION]<br/>in: candidate, required/forbidden phrases, length and schema<br/>out: reasons and optional model-review request"]:::fn
JUDGE["Optional model judgment<br/>[AGENT · run.config.model]<br/>in: rubric and candidate; maximum 512 output tokens<br/>out: boolean pass and reason"]:::agent
PASS{"All configured checks pass?<br/>[FUNCTION]<br/>in: deterministic reasons and optional model verdict<br/>out: accept, repair or block"}:::dec
REPAIR{"Validator has feedback edge and allowance?<br/>[FUNCTION]<br/>in: validator revision count<br/>out: retry earlier agent or block<br/>maxRevisions 0–3"}:::dec
EVENT["Append invocation evidence<br/>[DATA · redacted run events + JSONL]<br/>in: start/end, input, output, usage, errors<br/>out: inspectable invocation history"]:::data
OUTPUT["Release final output<br/>[FUNCTION]<br/>in: final output-node input after checks<br/>out: completed result"]:::term
STOP["Stop with explicit status<br/>[FUNCTION]<br/>in: preflight error, rejection, timeout or cancellation<br/>out: blocked, failed or cancelled with partial events"]:::term
INPUT --> SCHEMA --> READY
READY -->|"yes"| SNAP --> ORDER --> MAP --> KIND
READY -->|"no"| STOP
KIND -->|"agent"| BUDGET
BUDGET -->|"available; per-call timeout at most 90s"| AGENT --> CHECK
BUDGET -->|"exhausted or unknown rate under dollar cap"| STOP
KIND -->|"tool"| TOOL --> EVENT
KIND -->|"guardrail or validator"| CHECK
KIND -->|"coordinator passthrough"| EVENT
KIND -->|"output"| OUTPUT
CHECK -->|"prompt configured"| JUDGE --> PASS
CHECK -->|"deterministic checks only"| PASS
PASS -->|"yes"| EVENT
PASS -->|"no"| REPAIR
REPAIR -->|"yes; feedback passed to earlier agent"| MAP
REPAIR -->|"no"| STOP
EVENT -->|"next node"| MAP
SNAP -.->|"graph deadline 1–180s or user stop"| STOP
classDef agent fill:#dbeafe,stroke:#2563eb,color:#0b2a5b;
classDef fn fill:#dcfce7,stroke:#16a34a,color:#052e16;
classDef dec fill:#f3e8ff,stroke:#9333ea,color:#2a0a4a;
classDef term fill:#e5e7eb,stroke:#6b7280,color:#111827;
classDef ask fill:#cffafe,stroke:#0891b2,color:#083344;
classDef data fill:#ede9fe,stroke:#7c3aed,color:#2a0a4a;
```

<!-- diagram: 04-imported-source.mmd -->

```mermaid
%% 04 IMPLEMENTED — source map and narrowly trusted Learning Studio execution
flowchart TD
SOURCE{"Repository source?<br/>[FUNCTION]<br/>in: local path, GitHub URL or picker choice<br/>out: local discovery or managed acquisition"}:::dec
CATALOG["List GitHub repositories<br/>[FUNCTION]<br/>in: existing authenticated gh login<br/>out: at most 100 account repositories; 30-second deadline"]:::fn
URL["Validate GitHub identity<br/>[FUNCTION]<br/>in: HTTPS github.com owner/repository URL<br/>out: normalized identity; reject credentials, escapes and extra paths"]:::fn
CLONE["Acquire or reuse managed checkout<br/>[FUNCTION]<br/>in: validated identity and per-repository lock<br/>out: verified local source directory<br/>shallow clone; 90-second deadline; 2MB CLI output cap"]:::fn
ISOLATE["Enforce Git acquisition boundary<br/>[FUNCTION]<br/>in: checkout and origin/config checks<br/>out: source only; no hooks, filters, submodules or repo scripts<br/>existing checkouts preserved; atomic publication"]:::fn
PATH["Resolve selected local checkout<br/>[FUNCTION]<br/>in: local or managed repository path<br/>out: canonical directory"]:::fn
FILES["Discover source resources<br/>[FUNCTION]<br/>in: repository directory<br/>out: at most 500 files, depth at most 6<br/>excludes secrets, symlinks and generated/dependency folders"]:::fn
MAP["Build source-linked graph<br/>[FUNCTION]<br/>in: recognized paths and symbols<br/>out: workflow nodes plus collapsed UI, DB/auth and Markdown"]:::fn
TRUST{"Approved source and platform?<br/>[FUNCTION]<br/>in: adapter, pinned revision and 14 allowlisted files<br/>out: isolated execution or discovery only<br/>macOS sandbox-exec required"}:::dec
OPAQUE["Retain discovery-only map<br/>[DATA · source references]<br/>in: unsupported or changed source<br/>out: coverage and opaque components; no execution"]:::term
GIT["Read exact committed source<br/>[FUNCTION]<br/>in: approved revision and source allowlist<br/>out: source matching current files<br/>replacement objects disabled; inherited GIT overrides removed"]:::fn
BUNDLE["Bundle pinned overview with test shims<br/>[LIBRARY · esbuild]<br/>in: verified source, bridge, local libraries<br/>out: scratch runner without provider keys"]:::data
OS["Start reviewed-source worker<br/>[LIBRARY · macOS sandbox-exec]<br/>in: scratch bundle and request<br/>out: constrained process<br/>no network, file writes or process fork; 256MB JS heap"]:::data
BRIDGE["Validate worker messages<br/>[FUNCTION]<br/>in: JSON lines from worker<br/>out: event or bounded provider request<br/>2MB message, 12MB total stdout, at most 6 model requests"]:::fn
LLM["Execute mediated model call<br/>[AGENT · run.config.model]<br/>in: original source prompts and bounded request<br/>out: response returned over stdin; key stays in parent"]:::agent
ART["Render isolated overview artifact<br/>[FUNCTION]<br/>in: original schema-validated overview<br/>out: original HTML and in-memory artifact; no DB or billing"]:::fn
RESULT["Return overview result and trace<br/>[FUNCTION]<br/>in: artifact and observed invocation events<br/>out: source-linked output with ungrounded/retrieval-disabled notice"]:::term
CLEAN["Force-stop and remove scratch files<br/>[FUNCTION]<br/>in: error, cancellation or 120-second deadline<br/>out: terminated worker and preserved partial trace"]:::term
SOURCE -->|"local path"| PATH
SOURCE -->|"GitHub picker"| CATALOG --> URL
SOURCE -->|"GitHub URL"| URL
URL --> CLONE --> ISOLATE --> PATH
PATH --> FILES --> MAP --> TRUST
TRUST -->|"unsupported or mismatched"| OPAQUE
TRUST -->|"approved overview only"| GIT --> BUNDLE --> OS --> BRIDGE
BRIDGE -->|"model request"| LLM
LLM -->|"response, never credential"| OS
BRIDGE -->|"completed original render"| ART --> RESULT
OS -.->|"timeout, cancellation, protocol error"| CLEAN
classDef agent fill:#dbeafe,stroke:#2563eb,color:#0b2a5b;
classDef fn fill:#dcfce7,stroke:#16a34a,color:#052e16;
classDef dec fill:#f3e8ff,stroke:#9333ea,color:#2a0a4a;
classDef term fill:#e5e7eb,stroke:#6b7280,color:#111827;
classDef ask fill:#cffafe,stroke:#0891b2,color:#083344;
classDef data fill:#ede9fe,stroke:#7c3aed,color:#2a0a4a;
```

<!-- diagram: 05-product-modes.mmd -->

```mermaid
%% 05 IMPLEMENTED — alignment, comparison, red-team and evaluation coordination
flowchart TD
ALIGN["Align the requested app<br/>[AGENT · selected config.model]<br/>in: brief; one planning call, 5000 output tokens<br/>out: assumptions, questions and 1–5 proposed agents<br/>The model writes clarification questions"]:::agent
ASK["Present open questions<br/>[FUNCTION]<br/>in: model-written questions<br/>out: user updates the brief and requests a new plan"]:::ask
APPROVE{"User accepts the proposed graph?<br/>[FUNCTION]<br/>in: explicit Accept action<br/>out: saved revision or further alignment"}:::dec
COMPARE["Prepare candidate slots<br/>[FUNCTION]<br/>in: one input, 2–5 configs, node/workflow strategy<br/>out: supported candidates with shared budget at most 30 calls"]:::fn
RED["Produce bounded probe plan<br/>[AGENT · selected config.model]<br/>in: local-test or owned-staging declaration and brand rules<br/>out: at most 6 synthetic security, brand or customer probes<br/>one planning call, 2200 output tokens"]:::agent
SCOPE{"User confirms the finite plan?<br/>[FUNCTION]<br/>in: confirmed=true and proposed campaign<br/>out: start once or retain proposed state"}:::dec
SOURCE["Review supported source heuristics<br/>[FUNCTION]<br/>in: inspected importer rules or manifest prompts<br/>out: suspected findings, not reproduced vulnerabilities"]:::fn
CASES["Save evaluation suite version<br/>[FUNCTION]<br/>in: 1–20 cases, assertions and optional judge rubric<br/>out: immutable suite version and report with pinned criteria"]:::fn
SCHEDULE["Execute each accepted work item<br/>[FUNCTION]<br/>in: pinned graph/repo, config/input and campaign budget at most 30<br/>out: independent run and invocation events<br/>manifest or supported source adapter"]:::fn
KIND{"Which result consumer?<br/>[FUNCTION]<br/>in: completed or partial run<br/>out: comparison, evaluation or red-team evidence"}:::dec
ASSERT["Evaluate deterministic assertions<br/>[FUNCTION]<br/>in: case output, contains/JSON/length/regex rules<br/>out: reasons; regex execution limited to 30ms"]:::fn
JUDGE["Optional rubric judgment<br/>[AGENT · suite.judge.config.model]<br/>in: rubric, expected behavior, actual output<br/>out: boolean and reason; maximum 512 output tokens"]:::agent
EVAL["Assign evaluation verdict and regression<br/>[FUNCTION]<br/>in: assertions, optional judgment and same-criteria baseline<br/>out: pass, fail, error or unscored; explicit criteria-change note"]:::fn
PROBE{"Probe has a literal failure signal?<br/>[FUNCTION]<br/>in: approved probe and completed output<br/>out: deterministic check or semantic review"}:::dec
LITERAL["Check literal failure signal<br/>[FUNCTION]<br/>in: prohibited substring and output<br/>out: reproduced or passed finding with run ID"]:::fn
REVIEW["Review semantic behavior<br/>[AGENT · selected config.model]<br/>in: expected behavior, brand rules and candidate<br/>out: suspected or passed finding; maximum 512 output tokens<br/>human confirmation required for suspected violations"]:::agent
HISTORY["Persist grouped evidence<br/>[DATA · workspace snapshots]<br/>in: comparisons, suites, reports, campaigns and run links<br/>out: retained partial and completed evidence"]:::data
PROMOTE["Draft regression case<br/>[FUNCTION]<br/>in: selected trace/finding input and run ID<br/>out: editable expectation and assertions awaiting review"]:::fn
ALIGN --> ASK
ASK -.->|"answers appended to brief"| ALIGN
ALIGN --> APPROVE
APPROVE -->|"accepted; run requested separately"| SCHEDULE
APPROVE -->|"revise"| ALIGN
COMPARE --> SCHEDULE
RED --> SCOPE
SCOPE -->|"confirmed"| SOURCE --> SCHEDULE
SCOPE -->|"not confirmed"| RED
CASES --> SCHEDULE --> KIND
KIND -->|"comparison: retain each candidate"| HISTORY
KIND -->|"eval: successful execution"| ASSERT
KIND -->|"red team: successful execution"| PROBE
KIND -->|"failed/cancelled: error or inconclusive"| HISTORY
ASSERT -->|"judge configured"| JUDGE --> EVAL
ASSERT -->|"deterministic only"| EVAL --> HISTORY
PROBE -->|"yes"| LITERAL --> HISTORY
PROBE -->|"no"| REVIEW --> HISTORY
HISTORY --> PROMOTE --> CASES
classDef agent fill:#dbeafe,stroke:#2563eb,color:#0b2a5b;
classDef fn fill:#dcfce7,stroke:#16a34a,color:#052e16;
classDef dec fill:#f3e8ff,stroke:#9333ea,color:#2a0a4a;
classDef term fill:#e5e7eb,stroke:#6b7280,color:#111827;
classDef ask fill:#cffafe,stroke:#0891b2,color:#083344;
classDef data fill:#ede9fe,stroke:#7c3aed,color:#2a0a4a;
```

<!-- diagram: 06-export-hosting.mmd -->

```mermaid
%% 06 IMPLEMENTED export — PLANNED portability gate and phase-3 hosting
flowchart TD
PROJECT["IMPLEMENTED · Selected project revision<br/>[DATA · versioned graph]<br/>in: saved manifest application<br/>out: cloned and validated export input"]:::data
SUPPORTED{"IMPLEMENTED · Manifest-owned project?<br/>[FUNCTION]<br/>in: project ownership<br/>out: permit export or keep source in its repository"}:::dec
EXPORT["IMPLEMENTED · Assemble runnable project<br/>[FUNCTION]<br/>in: supported graph and shared executor modules<br/>out: CLI source, dependencies, graph test and setup instructions"]:::fn
FILTER["IMPLEMENTED · Filter private runtime data<br/>[FUNCTION]<br/>in: explicitly selected file set<br/>out: redacted graph, no node source paths, empty environment template"]:::fn
ZIP["IMPLEMENTED · Package download<br/>[LIBRARY · archiver]<br/>in: selected files<br/>out: portable project ZIP, not a deployment"]:::data
CHECK{"PLANNED · Automatic clean-directory readiness gate<br/>[FUNCTION]<br/>in: extracted package and compatible environment<br/>out: verified readiness or failure<br/>not enforced by the export endpoint today"}:::dec
READY["PLANNED · Verified portable release<br/>[FUNCTION]<br/>in: clean install, graph checks and sample-run evidence<br/>out: readiness claim supported by that evidence"]:::term
FAIL["PLANNED · Preserve portability failure<br/>[FUNCTION]<br/>in: install or execution failure<br/>out: actionable failure evidence"]:::term
BLOCK["IMPLEMENTED · Reject source-owned export<br/>[FUNCTION]<br/>in: connected repository project<br/>out: explicit supported-boundary message"]:::term
AWS["PLANNED · Hosted UI and bounded API<br/>[LIBRARY · AWS S3, CloudFront, Lambda]<br/>in: separately verified deployment build<br/>out: hosted service; no resources created yet"]:::data
DB["PLANNED · Hosted accounts and project storage<br/>[LIBRARY · Cognito + DynamoDB]<br/>in: authorized user operations<br/>out: tenant-scoped durable data"]:::data
RUNNER["PLANNED · Local runner bridge or hosted sandbox<br/>[FUNCTION]<br/>in: authorized source/code job<br/>out: isolated execution with explicit cost limits<br/>not supplied by static hosting or Lambda automatically"]:::fn
PROJECT --> SUPPORTED
SUPPORTED -->|"yes"| EXPORT --> FILTER --> ZIP
SUPPORTED -->|"no"| BLOCK
ZIP -.->|"required release QA, not automatic today"| CHECK
CHECK -->|"passes"| READY
CHECK -->|"fails"| FAIL
READY -.->|"separate phase-3 work"| AWS
AWS --> DB
AWS -.->|"source/code execution needs separate design"| RUNNER
classDef agent fill:#dbeafe,stroke:#2563eb,color:#0b2a5b;
classDef fn fill:#dcfce7,stroke:#16a34a,color:#052e16;
classDef dec fill:#f3e8ff,stroke:#9333ea,color:#2a0a4a;
classDef term fill:#e5e7eb,stroke:#6b7280,color:#111827;
classDef ask fill:#cffafe,stroke:#0891b2,color:#083344;
classDef data fill:#ede9fe,stroke:#7c3aed,color:#2a0a4a;
```

<!-- diagram: 07-custom-code-sandbox.mmd -->

```mermaid
%% 07 IMPLEMENTED — Docker is required for arbitrary code nodes
flowchart TD
CODE["Prepare custom code tool<br/>[FUNCTION]<br/>in: node code and mapped input<br/>out: isolated JavaScript invocation"]:::fn
CHECK{"Docker and node:22-alpine image available?<br/>[FUNCTION]<br/>in: local image inspection, 3-second check<br/>out: accept or block"}:::dec
BLOCK["Block unsupported execution<br/>[FUNCTION]<br/>in: unavailable sandbox<br/>out: setup error; no host execution fallback"]:::term
START["Create uniquely named sandbox<br/>[LIBRARY · Docker]<br/>in: code, stdin input and no provider credential<br/>out: non-root container<br/>network none; read-only; no mounts; all capabilities dropped"]:::data
LIMIT["Apply process limits<br/>[FUNCTION]<br/>in: container execution<br/>out: bounded workload<br/>128MB memory; 0.5 CPU; 32 PIDs; 15-second timeout"]:::fn
RESULT{"Workload completes within output limit?<br/>[FUNCTION]<br/>in: process status and stdout<br/>out: result or failure<br/>stdout limit 100000 characters"}:::dec
CLEAN["Force-remove named container<br/>[FUNCTION]<br/>in: completion, abort, timeout or excessive output<br/>out: docker rm -f attempted; launcher cleaned up"]:::fn
RETURN["Return tool outcome<br/>[FUNCTION]<br/>in: captured result or error<br/>out: node completion or failure event"]:::term
CODE --> CHECK
CHECK -->|"no"| BLOCK
CHECK -->|"yes"| START --> LIMIT --> RESULT
RESULT -->|"success"| CLEAN
RESULT -->|"failure or cancellation"| CLEAN
CLEAN --> RETURN
classDef agent fill:#dbeafe,stroke:#2563eb,color:#0b2a5b;
classDef fn fill:#dcfce7,stroke:#16a34a,color:#052e16;
classDef dec fill:#f3e8ff,stroke:#9333ea,color:#2a0a4a;
classDef term fill:#e5e7eb,stroke:#6b7280,color:#111827;
classDef ask fill:#cffafe,stroke:#0891b2,color:#083344;
classDef data fill:#ede9fe,stroke:#7c3aed,color:#2a0a4a;
```

## Regeneration and validation

After editing these Mermaid fences, mirror each block into its named `.mmd` file. Then run:

```bash
node /Users/macbook/.agents/skills/power-coding/scripts/validate-mmd.mjs docs/mermaid
node /Users/macbook/.agents/skills/power-coding/scripts/build-html.mjs docs/mermaid docs/architecture-flow.html
```

Verification at this snapshot: the real Mermaid parser passed all seven diagrams. Chromium rendered seven SVG diagrams with no Mermaid error nodes. The master diagram was visually inspected. Repeat these checks after changes; a successful parse alone does not establish readable layout. The viewer is a documentation artifact, not a runtime debug tab.

## Known boundaries

- Metadata discovery is not proof of model inference compatibility; verified execution is a separate flag.
- Phrase and schema checks cannot establish factual accuracy. Optional model judges remain fallible.
- Local store permissions protect files from ordinary other-user access; this is not encrypted tenant storage.
- The trusted imported overview disables retrieval and external persistence; full lesson generation remains discovery-only. Its macOS policy permits scoped read access plus root-directory metadata needed by the loader; network, file writes and child-process creation are denied. It is a reviewed-source adapter, not a general hostile-code sandbox.
- Red-team specialists currently label different planned probe concerns; the source review is deterministic heuristics and semantic review uses the selected model. Separate autonomous specialist agents are not implemented.
- Export assembly and a clean-directory CLI sample are verified for the support app. The browser wrapper has free HTTP-boundary and abort-survival coverage; interactive model-backed browser acceptance is separate. The download endpoint does not automatically enforce a readiness gate for each download.
- AWS configuration is ready, but cloud hosting, tenant identity and a remote runner/sandbox are not built. See [AWS-READINESS.md](AWS-READINESS.md).
- Decisions and rejected alternatives are in [DECISIONS.md](DECISIONS.md).
