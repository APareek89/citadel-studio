# Citadel Studio

An agent workbench for mapping source, designing workflows and inspecting recorded behavior. Hidden supporting nodes remain inspectable; a source map is never presented as proof of execution. The product scope is in [planning/APP-BRIEF.md](planning/APP-BRIEF.md).

## Try the portfolio example

[Open Citadel Studio](https://citadel-studio.3-6-183-210.sslip.io). The 30 September AWS deployment passes live signup/signin/signout, owner isolation, source recovery, and the free example journey. One bounded live source-mapping call and the final ordinary-runtime browser check also passed. Live acceptance is complete.

1. Open the app and create an email/password account, or sign in.
2. Choose **Try with an example** to inspect the bundled source map and source excerpts. This does not execute the imported repository.
3. Choose **Run cached workflow**. A separate manifest runs through the actual scheduler with prepared responses; inspect its graph, output and recorded events. No model key or paid inference is needed.

The example belongs to your workspace. Start your own project or connect a public GitHub URL to continue; private repositories have an optional token field. Model-backed planning, mapping and tests are explicit actions with provider and spend gates.

## Run locally

Requires Node 22+ and PostgreSQL. Development defaults below use local fixture storage and block live model generation.

1. Install dependencies with `npm ci`.
2. Copy `.env.example` to `.env`; set your local database URL and a new random `AUTH_SECRET` of at least 32 characters. The example allows unencrypted PostgreSQL only on loopback. Production requires a trusted database CA and private S3 configuration.
3. Run `npm run build`, then `node --env-file=.env --import tsx server/index.ts`. Open `http://127.0.0.1:8951` in Codex’s browser panel.

The app serves compiled assets, never the repository directory. `WORKBENCH_DEV=1` enables local Vite middleware. Hosted authentication is required by default; `PORTFOLIO_AUTH_ENABLED=0` is reserved for isolated legacy test fixtures. Never put a real provider key into mock development.

Pasted model and integration keys stay in the owner’s server-side session and never enter browser storage or graph exports. Re-enter them after a server restart. Workspace drafts, redacted events and reports persist in separate user directories; passwords are bcrypt hashes and session revocation is checked against PostgreSQL. Hosted source bundles use private S3 objects and digest verification. Known text pricing, per-run call/time/revision caps and a shared configured-provider allowance bound inference; prices are estimates rather than invoices.

## Working paths

- **Build:** model-assisted alignment, editable agent prompts/checks/schemas/edges, bounded execution, node evidence and a runnable ZIP with CLI and local browser interface.
- **Connect & Debug:** public GitHub URLs, optional private-repository tokens and filtered folder uploads. Local checkouts and CLI login remain local-mode options. A small model interprets source-backed workflow candidates; deterministic checks retain coverage and hidden resources. Observe an existing app through the native JavaScript/Python tracing helpers or a manual Langfuse observation import. [Connection setup](docs/CONNECTIONS.md) covers each path.
- **Red Team:** review a finite generated plan, run synthetic probes, inspect reproduced/suspected/inconclusive findings, and promote a case to evals.
- **Model Lab:** two to five candidates, fixed-input node or whole-workflow comparison, per-slot failure retention, per-node traces. One prompt does not establish a model ranking.
- **Evals:** versioned JSON cases, deterministic assertions, optional rubric judge, immutable reports and comparable baseline regressions. Infrastructure failures are errors, not quality failures.

## Honest boundaries

- The hosted app accepts a **GitHub URL or uploaded source folder**. Public GitHub URLs do not need a token. Private repositories use an optional validated token held in the owner’s server session. Local checkouts and GitHub CLI login are available only in local mode. Managed clones disable repository hooks, install scripts and submodules; reconnect reuses the existing checkout without pulling/resetting it. Folder uploads store filtered text in a separate private directory.
- AI mapping sends bounded, scrubbed source evidence to the selected model to group workflow stages. Local TypeScript/JavaScript and Python AST parsing supplies candidates; deterministic checks validate source references, candidate assignments and relationships. Static discovery remains available without an inference call. Coverage is bounded and disclosed; an inferred map cannot prove all runtime paths are represented.
- Learning Studio executes the **overview path only** at inspected revision `5968d23`. Full lesson build and other routes are mapped, not executed. The adapter disables database, uploads/retrieval, billing, auth and Langfuse; output uses model knowledge and an isolated memory artifact store. It is not a full production-environment reproduction.
- That reviewed adapter uses a tested macOS sandbox. Unknown or changed imported code stays discovery-only. Arbitrary editable code requires Docker and the `node:22-alpine` image; otherwise preflight blocks it. The hosted Linux release does not expose Docker to the app; custom-code execution remains unavailable there.
- Built-in tools: uppercase, word count and JSON formatting. External tool integrations, general source patching, arbitrary branching languages and automatic deployment are not implemented.
- New manifest workflows run data edges in deterministic topological order. Feedback edges permit bounded validator-to-agent revision. Orchestrators with no prompt pass through; adding a prompt uses a model. Graph code is a sandboxed tool body that returns a string or JSON value.
- Source maps label inferred/declared relationships. An observed trace covers only that actual run. Supporting files stay under **Hidden nodes**, and runtime resource events are still retained.
- Native telemetry receives only operations you instrument in the existing app. Its per-project token and all integration credentials are session-only; reconnect after restarting the workbench. Langfuse imports are manual, partial snapshots of the last 24 hours, capped at 300 observations. Parent spans describe nesting, not proven data flow. Native telemetry has a scoped bearer endpoint over the configured public origin; local mode remains loopback-only. Connecting it never starts or deploys that app.
- Red-team specialists currently use bounded probes and shared-provider review. Independent specialist coordination is Phase 2. Semantic findings need human confirmation.
- Email/password signup and Auth.js sessions use PostgreSQL. Each user has a separate state/source namespace; S3 source objects are private. Google login and email password reset are not configured. The shared-host release passes live account and ownership checks; the earlier single-owner deployment remains separate.
- Hosted workspace limits are 40 projects, 300 runs/traces, 256 MiB per user and 1 GiB shared data. New writes reject at the cap without deleting existing evidence. Git clone monitoring can briefly overshoot between polls; it is not a hard filesystem quota.
- This is a text/graph workbench. No image-generation or media-upload experience was invented for this release.

## Validation and continuity

```sh
npm test
npm run build
```

Verification: 209/209 offline tests passed before the final client-only expiry correction; its three session-order regressions and browser mutation contract then passed 4/4. Root verified the corrected live JavaScript, source/example/cached-run journey and both themes with no console errors. Local mobile verification at 390×844 passed. Live free HTTP checks cover two-account access, revoked cookies/event streams, export, native capabilities and exact-version S3 cold hydration. The one paid HTTPS source remap dispatched Gemini 3.5 Flash Lite at 2026-09-30 12:46:39.623 UTC and returned HTTP 200 at 12:46:42.087 UTC: 1,299 input and 569 output tokens (zero thinking tokens), estimated US$0.0018122. It mapped 4/4 recognized candidates with zero unresolved candidates; eight source citations checked, and all three source-file hashes plus the private S3 version/hash remained unchanged. This proves one model-backed mapping path, not imported-code execution, exhaustive mapping, or every model/workflow. Cost is an estimate, not an invoice.

See [docs/PORTFOLIO-DEPLOYMENT.md](docs/PORTFOLIO-DEPLOYMENT.md) for the new deployment contract, [docs/QA-REPORT.md](docs/QA-REPORT.md) for retained historical evidence and limits, [docs/ARCHITECTURE_FLOW.md](docs/ARCHITECTURE_FLOW.md) for diagrams, and [docs/architecture-flow.html](docs/architecture-flow.html) for their standalone viewer. The old simulated HTML is preserved under `prototype/` and is not used by the application.

Power Coding is configured in `.power-coding/config.json`. Continue from [Handoff.MD](Handoff.MD). The original checkout and its separate single-owner preview are preserved. Release commits and deployment require the launch review gates.
