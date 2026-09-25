# Approval-brief journey audit

Planning only. The existing prototype is simulated; none of the following is claimed as implemented. Phase 1 should provide one complete, local path through every tab, using a shared execution engine, graph representation and trace format. The first import adapter must match the actual selected repository. Do not commit to a framework before inspecting it.

## Functional phase-1 boundary by tab

**1. Build.** Align captures outcome, sample input, expected output, allowed actions, app structure and success criteria. The planner asks only for unresolved essentials, then proposes a graph with assumptions. Review supports node instructions, code references, schemas, edge conditions and input mappings; supporting UI, DB, auth and Markdown are searchable and collapsed. Before Run, require a credential, validated model capability and valid sample input. Execute real calls and checks, retaining every invocation. Launch downloads a runnable project with the exact graph revision, dependencies, setup instructions and `.env.example`; exclude credentials and private run data. Exit: a clean local folder can run the downloaded project against the same case with the same configuration and produce a correctly shaped answer and trace. Identical wording is not required from stochastic models.

**2. Connect and debug.** Select a local repository and identify its entry point and supported adapter. Discover recognized workflow nodes and supporting resources, with source locations; label every relationship declared, inferred or observed. Unknown components remain opaque and coverage is explicit. Instrument one actual run through the compatible adapter, then inspect inputs, outputs, errors and repeated invocations. Keep arbitrary imported source read-only in phase 1; offer source-linked findings rather than silently rewriting it. Exit: locate an intentional failure from its real trace and open the responsible source location. An imported static graph without a real run is discovery, not working observability.

**3. Red-team.** Choose the connected, owned local/test app, permitted target surfaces and budgets. The master proposes a finite test plan; specialist agents perform both inference probes and read-only source review for security, brand and customer-experience issues. Execute probes only against the approved test target; side-effecting integrations must be sandboxed or stubbed. Findings include evidence, target revision, reproducible input, observed behavior, severity rationale and suggested fix. Mark hypotheses separately from reproduced failures. Exit: reproduce one seeded issue and report it without exposing secrets or changing application source. Missing target access yields a partial source-review report, not a claim that inference testing passed.

**4. Compare.** Configure two to five candidate slots; slots may reuse one provider credential. Pin the same graph revision, input, context and comparable settings. Explicitly show which model nodes each slot can override. App-fixed calls stay pinned and are disclosed; incompatible override requests block that slot. Capture each candidate's answer, node outputs, verdicts, latency and usage when reported. Do not invent prices or tokens when absent. Exit: compare at least two successful real candidates, inspect per-node results and retain a failed candidate alongside the successful ones. One configured slot can run as a baseline but is not a comparison.

**5. Evals.** Create cases manually, import a small documented dataset format, or promote a recorded failure. Cases declare input, expected behavior and deterministic assertions; add a model judge only when its rubric and credential are configured. Run cases against a pinned graph/model configuration. Store case version, evaluator/rubric version, actual output, trace and pass/fail/error. Compare the next run against a chosen baseline and identify new failures. Exit: a seeded regression fails, a repaired version passes, and both reports remain inspectable. An execution error is separate from an assertion failure.

## Shared prerequisites and hard limits

Provider name alone does not establish compatibility. Check the chosen model's required capabilities: text generation, tool calling, structured output or a supported validation strategy, context size, and modality where used. Track advertised versus verified support. Also check whether the app adapter permits replacing a model at each requested node. The initial provider adapters must be named in the approved brief; all other providers remain unsupported, not silently approximated.

Use a local server for provider calls, with credentials held in server memory for the session or a supported local secret store. Never persist them in browser storage, graph exports, traces or downloads. Core runtime limits—timeouts, cancellations, bounded retries, tool permissions and output checks—belong in phase 1. Phase 2 strengthens the product's own planner/specialist structure and evaluations; it must not be a deferred repair of missing basic control.

The five tabs need consistent empty, loading, success, blocked, failed, cancelled and partial states. Distinguish not executed, unsupported, no data and zero results. Invalid graphs stop before paid calls. A missing key opens credential setup; unsupported capabilities give a specific reason and compatible alternatives. Provider failures preserve completed work, redact sensitive error data and identify what may be retried. Repeated external actions cannot be silently replayed.

## Eleven critical customer QA journeys

1. **First build:** vague goal → targeted clarification → accepted plan → editable graph → real run → inspect intermediate output. Verify assumptions and non-executable supporting resources are recognizable.
2. **Preflight failure:** attempt Run with no key, invalid key, missing model, unsupported capability and invalid input. Each stops at the correct point, with no false successful run or unnecessary downstream call.
3. **Meaningful edit:** change a prompt and an edge mapping, validate, rerun, and inspect the new inputs. The old run still shows its original immutable graph and configuration.
4. **Bounded repair:** evaluator rejects a result, feedback reaches the intended node, retry limit terminates correctly, and output remains withheld until the release condition passes.
5. **Runtime interruption:** one provider times out or rate-limits, then user cancels. Preserve completed and interrupted invocations, restore usable controls, and never label an incomplete answer complete.
6. **Launch portability:** download, extract into a clean directory, configure fresh credentials and run using the documented command. No machine-specific absolute paths, secrets or private trace payloads are included.
7. **Honest import:** connect a supported repository, reveal UI/DB/auth/Markdown dependencies, and inspect a real failing run. An unsupported or dynamic component is visibly opaque; observed paths do not become claims about all possible behavior.
8. **Controlled red-team:** approve a finite plan for a local test target, reproduce a seeded inference issue and identify a separate source issue. Test budget and scope limits stop correctly; report distinguishes reproduced, suspected and untested findings.
9. **Mixed comparison:** configure five slots including shared credentials, one invalid capability and one failing provider. Compatible slots run; successful results remain visible; failures and pinned app-fixed calls are explicit.
10. **Eval regression:** promote an observed failure, run a baseline, introduce a known regression, and compare. Case lineage, rubric version and trace explain the changed verdict; model-judge uncertainty is visible.
11. **Workspace integrity:** reload or restart mid-work, switch light/dark theme, navigate with keyboard, export and reopen. Draft recovery and run persistence match the declared storage policy; unsupported restoration is stated clearly; secrets are not exposed.

## Release gates for the three phases

**Phase 1 — real local MVP:** all five exit criteria and the eleven journeys pass on the agreed adapter/provider matrix. The interface uses readable light/dark GPT/Codex-style tokens; main workflow stays clear while supporting code remains accessible. Explicit approval precedes implementation.

**Phase 2 — strengthen our agentic structure:** use the product's own versioned planner, reviewers and specialists; evaluate graph generation, import coverage, issue quality and regression resistance against retained cases. Expand adapters only with compatibility tests.

**Phase 3 — hosted product and launch:** add durable shared storage, authentication, authorization, credential isolation, hosted execution and deployment operations. Re-run the journeys with multiple users and tenant boundaries before external release.
