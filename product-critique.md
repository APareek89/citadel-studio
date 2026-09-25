# Citadel: product thesis and critique

**Recommendation: build a small, contract-first agent workbench.** Its promise should be: “Describe the job, inspect the execution rules, run it, and see precisely where a result failed.” A graph editor alone will be difficult to differentiate. The opportunity is to make control understandable: who can act, what information they receive, which checks must pass, and what happens when they fail.

This is a proposed direction, not a claim that the market is validated or that these capabilities are built. Competitor facts below were checked against official documentation on 25 September 2026.

## Who should use it first?

Start with small AI product and solutions teams that repeatedly build research, qualification, or document-review agents. Their builder is technical enough to inspect a schema or short function, while a product owner needs to understand and edit behavior. The initial job is to turn a promising prototype into a workflow whose failures the team can diagnose and repair.

Choose one demonstration: an evidence-backed research brief. A coordinator assigns research, a tool retrieves documents, a reviewer checks citations and coverage, a bounded revision loop repairs failures, and an output policy controls what reaches the user. This makes every proposed role useful without requiring sensitive integrations or irreversible actions.

Avoid “anyone can build any agent” as the first positioning. A broad audience creates incompatible requirements: beginners need opinionated defaults, while experienced engineers demand custom runtimes, infrastructure integration, and source control. Start with the shared design-and-debug task.

## What already exists

- **LangSmith Studio:** graph visualization, agent interaction, intermediate state inspection, prompt iteration, dataset experiments, and time-travel debugging. It operates against systems implementing the Agent Server API. A live graph and editable prompts are established capabilities. [Official Studio documentation](https://docs.langchain.com/langsmith/studio)
- **Langflow:** visual composition, a Playground, tool-call outputs, flow export, and direct editing of underlying Python component code. This substantially overlaps the proposed first six steps. [Visual editor](https://docs.langflow.org/concepts-overview), [component code](https://docs.langflow.org/concepts-components)
- **Flowise Agentflow V2:** explicit workflow orchestration, shared state, loops, conditional branches, and human input. Supervisor/worker collaboration is already a supported pattern. [Agentflow V2](https://docs.flowiseai.com/using-flowise/agentflowv2)
- **Dify:** agent nodes with configurable tools and execution controls, plus individual-node testing and inspection of inputs, outputs, timing, and errors. Cached variables can be edited to test downstream steps. [Agent node](https://docs.dify.ai/en/cloud/use-dify/nodes/agent), [single-node debugging](https://docs.dify.ai/en/cloud/use-dify/debug/step-run)
- **Langfuse:** agent graphs can be inferred from trace observation timing and nesting, or supplied through its LangGraph integration. This is execution instrumentation, not general conversion of an arbitrary repository into an editable application. [Agent graphs](https://langfuse.com/docs/observability/features/agent-graphs)

The proposed advantage is therefore a **product hypothesis**, not an established missing competitor feature: a better integrated experience for expressing execution contracts, understanding failures, and repairing the smallest relevant part of a workflow. Demonstrate that advantage on an actual task before building a broad platform.

## The design calls that determine whether it works

**Separate roles from execution types.** King, Knight, Advisor, and Warden are memorable role labels; they should not determine the runtime. A reviewer can be an LLM, a deterministic function, or a human. A coordinator can be a router or an agent. Keep the kingdom theme as optional vocabulary, with plain labels visible: Coordinator, Agent, Tool, Evaluator, Policy. Forcing every system into a hierarchy excludes simple pipelines and peer collaboration.

**Give edges executable meaning.** “Research task” is a description, not a complete contract. A delegation needs an input mapping, output contract, timeout, and failure route. A one-way arrow can mean one-way authority while still returning a result to its caller. Alternatively, model send and return explicitly. Choose one convention and display it consistently. Validation must yield a structured outcome such as pass, revise, or block; “feedback” cannot silently imply an unlimited loop.

**Make state visible.** The graph cannot replace architecture if data movement stays implicit. Show which fields each node reads and writes, whether context is private or shared, and how parallel outputs merge. Separate a reusable node definition from each invocation: one research agent may execute six times with different inputs. Users must inspect the particular execution, not an ambiguous latest output.

**Distinguish advice from enforcement.** A prompt saying “do not reveal secrets” is an instruction, not a guarantee. The runtime must enforce tool access, schema validation, execution budgets, and configured blocking rules. LLM evaluators may provide judgment; deterministic policies should enforce hard boundaries where possible. An attractive Warden node is misleading if an alternate edge bypasses it.

**Retain one source of truth.** Store the executable graph as a versioned manifest, with prompts, schemas, and explicit references to code modules. UI edits update that representation; generated code is an export. Reject unrestricted two-way editing of arbitrary generated code for the MVP: keeping visual structure and unconstrained source synchronized becomes a separate programming-language problem. The reduction is in repeated wiring code, not in all necessary application logic.

**Treat replay as a new execution.** Re-running a model may change its answer. Re-running a tool may repeat an external action. Distinguish “view recorded output,” “run with recorded upstream inputs,” and “execute again.” Require idempotency or deliberate confirmation for repeated side effects. A bright node indicates execution, not proof that it causally improved the final answer.

## Hidden layers and the supplied baseline

The user wants UI code, database and authentication connections, Markdown, and other supporting resources represented but hidden from the default workflow. Keep them in the same versioned application graph, collapsed behind a **Supporting nodes** control. Selecting an agent or tool should reveal its dependencies. A database connection can stay collapsed; an executed query or authorization failure must appear in the trace. Hidden means less canvas clutter, never missing provenance or permissions.

The supplied `Agent Graph.html` demonstrates six screens, editing, graph export and one scripted trace. Its missing pieces are persistent workspaces, supporting resources, alternative outcomes and immutable run comparisons. Improve the demonstration through a visible **fail → inspect → change → rerun → compare** loop, rather than claiming a numerical quality multiplier.

## Importing existing applications

Offer two explicit modes. **Build mode** owns the graph and can execute or change it. **Observe mode** reconstructs what instrumented runs actually did and links events to source locations. An observed path cannot establish every possible branch, permission, or failure handler in the underlying application.

For the first import, accept the product's own manifest. Then support one framework adapter with declared node identities and source references. Import existing telemetry as read-only observed runs. Show unknown code as an opaque component, and label inferred relationships. Only later consider suggesting source patches for review. Reject the promise “link any repository and edit its behavior through the graph”: dynamic imports, callbacks, runtime-generated tools, and configuration-dependent routing make that promise unreliable.

## Minimum credible product

Ship a single workspace with prompt-to-plan, plan-to-graph, an inspector, and a playground. Support an agent, a registered tool, a deterministic condition/evaluator, and an output step; role badges can organize them. Include typed ports, explicit failure routes, one bounded revision loop, per-node inputs and outputs, and immutable run versions. Add one provider through a small backend or local runtime; keep credentials outside exported graphs and browser persistence.

Make the defining interaction: **a reviewer rejects an unsupported claim; the user sees the evidence gap, edits the relevant contract or instruction, and compares a new run against the original.** Show a small evaluation set alongside the graph. Otherwise a polished happy-path animation only proves that the canvas can animate.

Defer deployment, arbitrary repository round-tripping, multi-framework imports, marketplaces, and broad connector coverage. Arbitrary user code also requires an isolated execution environment, resource limits, and controlled network access; Langflow's own documentation flags isolation when running untrusted or generated code. Treat that as runtime work, not a textarea feature. [Custom-code controls](https://docs.langflow.org/deployment-block-custom-components)

## A concrete go/no-go test

Recruit five builders with an existing multi-step workflow. Give each the same sequence: inspect a failure, identify its cause, change one instruction or contract, and test the repair against three cases. Compare against their current workflow and record time, wrong diagnoses, help required, and accidental regressions.

Proposed continuation gate: four of five finish independently, at least three ask to use it on another real workflow, and two accept a paid pilot with a named budget owner. These are validation targets, not forecasts. If users enjoy the graph but return to code for every meaningful edit, narrow the product to a debugging workbench. If the value is only faster initial assembly, the stronger strategy may be a specialized extension to an existing builder rather than another general-purpose platform.
