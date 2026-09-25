# Agent Workbench

A local graph workspace for building, inspecting and testing agentic apps. Phase 1 is a working local MVP, with deliberately narrow imported-app coverage. The approved scope is in [planning/APP-BRIEF.md](planning/APP-BRIEF.md).

## Run

Requires Node 22+.

```sh
npm install
npm run build
npm start
```

Open `http://127.0.0.1:3001` **inside Codex's browser panel**. The server binds only to loopback. It serves the compiled UI, never the project directory. `npm run dev` uses Vite middleware only if no build exists; set `WORKBENCH_DEV=1` for hot UI updates.

Create a project, import/add a credential, validate it, choose a text model, and draft an alignment plan. Accept the plan, edit the graph, run an input and inspect the trace. Gemini has been tested live; the other four adapters have mocked contract tests, not live account verification.

Credentials live only in server memory. The optional local import reads the selected provider from `$WORKBENCH_SECRETS_FILE` (default `~/Documents/mysecrets`). Re-import session keys after a restart. Keys never enter browser storage, graph exports or run events. Workspace drafts, redacted events and reports persist under `.local/` with restricted file permissions. This is a personal local workspace, not a multi-user hosted service.

Optional `WORKBENCH_SPEND_LIMIT_USD=3 npm start` applies a cumulative local spend cap using `.local/usage.json`. Known text pricing is required under a dollar cap; unpriced providers are blocked instead of inventing an estimate. Model-call/time/revision caps always apply; per-run and campaign budgets are both enforced. Prices are estimates, not the provider invoice.

## Working paths

- **Build:** model-assisted alignment, editable agent prompts/checks/schemas/edges, bounded execution, node evidence and a runnable ZIP with CLI and local browser interface.
- **Connect & Debug:** local checkout discovery, source-linked visible and hidden nodes. The inspected Agentic Learning Studio revision has an isolated overview adapter using its original functions, schemas and renderer.
- **Red Team:** review a finite generated plan, run synthetic probes, inspect reproduced/suspected/inconclusive findings, and promote a case to evals.
- **Model Lab:** two to five candidates, fixed-input node or whole-workflow comparison, per-slot failure retention, per-node traces. One prompt does not establish a model ranking.
- **Evals:** versioned JSON cases, deterministic assertions, optional rubric judge, immutable reports and comparable baseline regressions. Infrastructure failures are errors, not quality failures.

## Honest boundaries

- Connect accepts an existing **local checkout**. Clone a private/public GitHub repository yourself with authenticated Git first; URL cloning from the UI is not implemented.
- Learning Studio executes the **overview path only** at inspected revision `5968d23`. Full lesson build and other routes are mapped, not executed. The adapter disables database, uploads/retrieval, billing, auth and Langfuse; output uses model knowledge and an isolated memory artifact store. It is not a full production-environment reproduction.
- That reviewed adapter uses a tested macOS sandbox. Unknown or changed imported code stays discovery-only. Arbitrary editable code requires Docker and the `node:22-alpine` image; otherwise preflight blocks it. Docker is not installed on this machine yet.
- Built-in tools: uppercase, word count and JSON formatting. External tool integrations, general source patching, arbitrary branching languages and automatic deployment are not implemented.
- New manifest workflows run data edges in deterministic topological order. Feedback edges permit bounded validator-to-agent revision. Orchestrators with no prompt pass through; adding a prompt uses a model. Graph code is a sandboxed tool body that returns a string or JSON value.
- Source maps label inferred/declared relationships. An observed trace covers only that actual run. Supporting files stay under **Hidden nodes**, and runtime resource events are still retained.
- Red-team specialists currently use bounded probes and shared-provider review. Independent specialist coordination is Phase 2. Semantic findings need human confirmation.
- No DB/auth/cloud deployment has been added. AWS access is ready; see [docs/AWS-READINESS.md](docs/AWS-READINESS.md).

## Validation and continuity

```sh
npm test
npm run build
```

See [docs/QA-REPORT.md](docs/QA-REPORT.md) for retained evidence and limits, [docs/ARCHITECTURE_FLOW.md](docs/ARCHITECTURE_FLOW.md) for diagrams, and [docs/architecture-flow.html](docs/architecture-flow.html) for their standalone viewer. The old simulated HTML is preserved under `prototype/` and is not used by the application.

Power Coding is configured in `.power-coding/config.json`. Continue in a fresh task with: **Refer to Handoff.MD in /Users/macbook/Documents/citadel-studio and begin**. Git checkpoints are local only. Nothing is pushed automatically.
