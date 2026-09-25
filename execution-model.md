# Citadel: proposed execution model

**Status: design proposal, not an implemented runtime.** Build a visual development environment whose full application graph contains an executable workflow and its supporting resources. Its promise is: “Understand, change and verify how your agent works in one place.” Fewer accidental behaviors is a stronger promise than eliminating code.

Start with people already assembling agent workflows in code: product engineers and technical builders who need to see delegation, validate handoffs and debug failed answers. Begin with a research-backed support assistant. Arbitrary application reverse engineering should follow a useful working builder.

## 1. Keep the metaphor, give every element a technical identity

Use the castle vocabulary as optional labels beside familiar names:

- **Citadel / King — orchestrator.** Owns entry, routing, completion and the run budget. Routing can use a deterministic function or a model that chooses among declared transitions. A model cannot invent a new permission or destination.
- **Army / Knight — agent.** A model, instructions, input and output contracts, permitted tools, local context policy and execution limits. An agent may contain a reusable subgraph.
- **Armory / tool — capability.** A callable implementation with schemas, timeout, credentials, network permissions and side-effect classification. A tool definition is a reusable resource; a particular tool call is a runtime invocation.
- **Council / advisor — evaluator.** Code or a model assesses an artifact against a rubric and returns a structured verdict, issues and evidence references. A subject-matter expert that produces new content is an agent, even if visually labelled “advisor.”
- **Court / warden — policy gate.** A deterministic check can block execution or release. A model-based risk classifier supplies a fallible signal to a deterministic decision rule; naming it a guardrail does not make it a guarantee.

Add explicit utility elements when needed: input/output, transformation, branch, fork/join and human approval. Forcing all behavior into five anthropomorphic categories would conceal the very complexity this product should expose. Display compact utilities rather than turning every function into another agent.

## 2. Four views of the same system

**Capability topology** answers “What can this component call?” A Knight → Armory edge grants access; it does not mean the tool always executes.

**Control flow** answers “What happens next, and under which condition?” Success, failure, revision, timeout and approval are distinct outcomes. An edge has a typed condition, priority and fallback. Natural-language instructions may describe a task, but cannot replace executable transition semantics.

**Data flow** answers “What values does this activation receive?” Named ports and bindings select particular fields. An evaluator may receive a draft and its evidence while being denied credentials and irrelevant conversation history.

**Invocation trace** answers “What actually happened in this run?” It overlays the graph with activations, calls, returned artifacts and timing. Three visits to the researcher are three activation IDs, not one overwritten output.

Default to control flow, with capability and data overlays. A single canvas showing every relationship simultaneously becomes a hairball. Hide overlays, never hide execution semantics.

### Supporting nodes, collapsed by default

**User-stated requirement:** UI code, database connections, authentication connections, Markdown files and other non-core workflow code belong in a hidden-nodes section so the main graph stays readable.

**Proposed implementation:** keep these resources in the same full application graph, under a collapsed **Supporting nodes** section. The default main canvas shows the agent execution workflow. Give supporting nodes stable IDs, source references, versions and editable contracts; use a view property such as `visibility: "collapsed"`, rather than creating an untracked second graph.

Use typed relationships: `depends_on` for infrastructure, `implemented_by` for code, and `informed_by` for documentation. These describe dependencies, not control transitions. Selecting a workflow node reveals its direct dependencies and a hidden-item count; users can expand a group, search all nodes or reveal the full application. Documentation only enters a prompt through an explicit context binding.

Classification depends on the operation. A database connection configuration can stay collapsed; a retrieval query is an executable tool. An authentication provider can be supporting infrastructure; a permission decision that controls a run is a visible policy gate. Supporting execution remains in traces: failures and material delays surface on the affected workflow node, with a link that reveals the dependency.

**Rejected:** treating “hidden” as exempt from permissions, versioning, validation or observability. It means visually collapsed, never outside governance.

## 3. One authoritative definition

For systems built here, store a versioned declarative manifest plus referenced prompt, schema, code and supporting-resource files. The canvas and inspector edit that representation. The compiler validates dependencies and produces an execution plan from executable node and edge types; displaying a file node does not make the file executable. Generated code is an export with a version marker, not a second independently editable source of truth.

Code remains appropriate inside tools, transforms and deterministic routers. Reference modules instead of forcing entire implementations into text boxes. The graph governs orchestration and boundaries; application logic remains readable code.

**Rejected:** independently maintained canvas configuration and generated source with implied automatic synchronization. They will disagree. If users export and hand-edit orchestration, switch that component to code-owned mode and make the graph derived until an explicit conversion is reviewed.

## 4. Define what a directed delegation means

A King → Knight delegation grants the King permission to invoke that Knight with a task payload. The child returns a structured result to the parent invocation. That return is part of call semantics; it does not require granting the Knight permission to command the King.

Each invocation has `run_id`, `activation_id`, `parent_activation_id`, attempt number, graph revision and artifact references. A run begins at the King's start port and ends at its finish port, or an explicit failed, cancelled, timed-out or awaiting-approval state.

The model may propose an action. The scheduler validates its arguments and permissions, then performs it. Show the selected action and a concise reported reason when available; do not claim to expose hidden model reasoning.

## 5. Contracts and state make the graph executable

Every executable node declares input and output JSON Schemas. Edges carry explicit field bindings; the compiler rejects incompatible ports, missing required inputs and unreachable termination routes before a run. Runtime validation still checks actual values. A schema proves shape, not factual correctness.

Keep immutable artifacts separately from run state. Agents receive scoped context assembled from explicit bindings, not an unrestricted mutable global transcript. Node outputs become new artifact versions. State updates use declared reducers or single-writer ownership; two concurrent branches cannot silently overwrite the same field.

Treat identity, permissions and secrets as runtime context, never model-editable state. Preserve provenance for evidence and every transformed artifact so a claim can be traced back to its source.

## 6. Reflection must terminate

An evaluator returns a verdict such as `pass`, `revise` or `escalate`, with structured issues. The orchestrator owns the response to that verdict. Revision edges declare a maximum traversal count and the fields included in feedback.

Enforce cumulative run limits as well: deadline, model/tool calls, tokens and concurrency. Cost limits require conservative reservations before calls; stop new calls when the remaining allowance is insufficient. Cancelling an in-flight provider call may still incur cost, so do not promise an exact billing cap.

After two unsuccessful revisions, return an explicit unresolved result or request human review. Preserve the best artifact and its unresolved issues. Infrastructure retries and semantic revisions have separate counters. Do not blindly retry a side-effecting tool: require an idempotency key or reconciliation.

**Rejected:** “Keep reflecting until correct.” The same model can repeatedly approve its own errors; more loops do not establish truth.

## 7. Parallelism needs a join contract

A fork creates named branch invocations. Its join declares `all`, `any` or a quorum; required branches; timeout; allowed partial results; and a deterministic merge rule. With `any`, specify whether remaining work is cancelled and how already-incurred cost is reported.

Failure is an explicit artifact, not an absent output. The UI must distinguish “not selected,” “cancelled,” “failed” and “still running.” Start the MVP with sequential execution and one supported `all` join before offering unrestricted parallel graphs.

## 8. Small illustrative manifest

The following proposes vocabulary, not a complete executable format. Referenced schemas, prompts and implementations must exist in the project. Conditions are enums, and bindings identify the latest completed activation on the current branch.

```json
{
  "id": "support-research",
  "revision": 1,
  "entry": "king.start",
  "exit": "king.finish",
  "limits": {"maxModelCalls": 8, "deadlineSeconds": 90},
  "nodes": [
    {"id": "king", "type": "orchestrator", "router": "support-router@sha256:..."},
    {"id": "court", "type": "policy", "rule": "validate-question-and-tenant@1"},
    {"id": "researcher", "type": "agent", "prompt": "support-research@1", "inputSchema": "ResearchTask@1", "outputSchema": "CitedAnswer@1"},
    {"id": "knowledge", "type": "tool", "implementation": "search-help-center@1", "sideEffects": "read", "outputSchema": "EvidenceList@1"},
    {"id": "advisor", "type": "evaluator", "rubric": "citation-support@1", "outputSchema": "Review@1"}
  ],
  "edges": [
    {"from": "king.start", "to": "court", "type": "transition"},
    {"from": "court", "to": "researcher", "type": "transition", "on": "pass"},
    {"from": "researcher", "to": "knowledge", "type": "may_invoke", "maxCallsPerActivation": 3},
    {"from": "researcher", "to": "advisor", "type": "transition", "on": "success"},
    {"from": "advisor", "to": "researcher", "type": "transition", "on": "revise", "maxTraversalsPerRun": 2, "onLimit": "unresolved"},
    {"from": "advisor", "to": "king.finish", "type": "transition", "on": "pass"}
  ],
  "bindings": {
    "researcher.question": "run.input.question",
    "researcher.feedback": "optional(latest.advisor.issues)",
    "advisor.draft": "latest.researcher.answer",
    "advisor.evidence": "latest.researcher.evidence",
    "king.finish.answer": "latest.researcher.answer"
  },
  "defaults": {"unhandledOutcome": "stop_unresolved", "policyDeny": "stop_blocked"}
}
```

## 9. Secrets, code and release boundaries

Real API keys belong in an encrypted server-side credential store or a local runtime's secret store. Manifests contain references. Redact traces before persistence; separately govern access to sensitive raw artifacts. A dummy playground must label simulated execution and should never solicit a real key it cannot safely use.

Run user code in isolated workers with declared dependencies, resource limits, outbound-network policy and scoped credentials. A language sandbox alone is insufficient isolation. Side-effecting tools can require a human approval gate before dispatch.

Streaming also needs a release policy. If an output check runs after generation, unreviewed tokens cannot already have reached the end user. Show them only as internal draft previews, or buffer until checks pass.

## 10. Version, replay and import honestly

Pin every run to an immutable graph revision, prompt/schema/code hashes, model configuration and credential-reference version. Saving during execution creates a new revision for the next run. Record causal events so reconnecting the UI reconstructs the trace.

Offer two distinct actions: **replay recorded events** and **rerun with current or pinned dependencies**. Only the former reproduces the original trace exactly. Models and external services may change; never describe a rerun as guaranteed reproduction. A branch from an intermediate artifact is a new run with lineage.

For existing applications, begin with supported framework adapters and instrumentation. Static analysis suggests possible components and calls; traces prove that particular calls occurred in particular runs. Neither proves every possible route. Label imported edges `declared`, `inferred` or `observed`, with source locations and run references. Mark opaque components and incomplete coverage visibly. Start read-only; propose source patches for review rather than claiming arbitrary code can round-trip through a graph.

## 11. The six-step user experience

1. **Describe the app:** capture goal, sample input, desired output and allowed actions.
2. **Review the plan:** explain components, assumptions, budgets and success criteria.
3. **Generate the graph:** compile contracts and routes; show the execution workflow with supporting nodes collapsed; surface unresolved requirements.
4. **Edit a node or edge:** reveal relevant supporting resources; change prompts, schemas, code references, mappings and failure behavior; validate the resulting revision.
5. **Run a sample:** show real invocation events, active paths, costs and streamed draft or released output according to policy.
6. **Inspect an activation:** view exact inputs, output, evidence, verdict, latency and errors; revise and compare the next run against the same case.

The useful product is the complete edit–run–inspect–compare cycle. Animated nodes make that cycle legible; they are not, by themselves, observability or correctness.
