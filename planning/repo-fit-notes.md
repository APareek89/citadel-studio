# agentic-learning-studio: read-only fit notes

Inspected 25 September 2026. These are source-code findings and proposed integration constraints, not evidence of a successful live run. No application start, model request, database request, secret file read, product edit, git initialization or commit was performed.

## Verified source

- Private repository: https://github.com/APareek89/agentic-learning-studio
- GitHub default branch: `main`.
- Local clean checkout and remote `main` both resolve to `5968d231fae50fa3364470fbf0377968630aff6d`, dated 23 July 2026. Confirmed with `git status`, `git ls-remote --symref` and authenticated `gh repo view`.
- Local checkout: `/Users/macbook/Documents/Codex/2026-09-05/use/work/render-to-vercel/repos/agentic-learning-studio`.
- The GitHub connector returned 404 for this private repository, but the existing authenticated git/gh CLI can read it. This is an integration-path difference, not a missing repository.
- Runtime stack: Node >=20, TypeScript through `tsx`, Express, LangChain, LangGraph, Zod, vanilla browser JavaScript, Postgres/Supabase, Hugging Face local embeddings, optional Langfuse tracing. Relevant declarations: `package.json`.

## The important graph finding

**The obvious LangGraph file is not the primary current user flow.** Importing only `src/agent/graph.ts` would yield a convincing but materially incomplete graph.

- `src/agent/graph.ts:14` declares a legacy pipeline: profiler → retriever → architect (conditional repair) → seedFirstModule → composer. It has an in-memory LangGraph checkpointer and is used by `/api/learn` in `src/server.ts:771`.
- `public/app.js:1576` and `:1661` drive the current two-stage `/api/overview` → `/api/build` flow. These endpoints call imperative orchestration in `src/agent/orchestrator.ts`, not the compiled LangGraph.
- `runOverviewJob` (`orchestrator.ts:54`) runs profiler and retriever in parallel; creates a coverage brief with one application retry; renders and persists a draft for user review.
- `runBuildJob` (`orchestrator.ts:134`) restores approved inputs; conditionally reruns profiler; retrieves, plans, generates a skeleton and retries a missing skeleton; then builds modules under a configurable concurrency cap while glossary/synthesis generation runs alongside them.
- Module count is generated and changes per request. Default module concurrency is five; global generation concurrency defaults to two (`src/lib/jobs.ts:46`). Module workers mutate distinct slots in a shared blueprint, with serialized persistence. A failed module remains a stub while other modules proceed. Full success can deduct a lesson credit.
- `runDeepDive` (`src/agent/nodes.ts:697`) performs focused retrieval, a structured generation with provider/parse retries, deterministic repair, optional parallel density/code-length repairs, and a code-integrity lint/repair pass. The code gate is deliberately nonblocking at `nodes.ts:882`; do not display it as an enforced release gate.

**Proposed initial Connect contract:** produce a source-linked whole-app dependency graph, plus a reviewed executable-workflow map for these known paths. Mark the LangGraph topology `declared`, imperative call relationships `inferred`, and instrumented activations `observed`. Keep UI, auth configuration, database connection, rendering, Markdown and scripts collapsed as supporting nodes. Show authorization decisions, retrieval queries, persistence failures and billing effects on the active trace. Do not promise exhaustive automatic recovery of every possible path.

## Existing observability seams and gaps

- `src/lib/langfuse.ts:48` creates a rooted callback handler. Overview/build jobs supply named callbacks to model stages and flush them in `finally`.
- `src/agent/orchestrator.ts:65` and `:152` are central locations for stage naming; `src/agent/llm.ts:232` centralizes most resilient invocations. `runDeepDive` directly invokes its runnable, so that helper alone does not capture everything.
- The retriever accepts no RunnableConfig; database, auth, renderer, artifact persistence, job limits and billing operations are normal code. Their exact starts, ends, outputs and failure reasons require explicit instrumentation.
- The app's job API reports progress summaries, not complete node inputs/outputs. Existing model callbacks do not automatically constitute a complete application trace.
- Distinct overview/build root traces should be correlated by artifact/job/run lineage. Model fallbacks, retry attempts and generated module IDs need stable activation IDs.
- Tracing is optional when Langfuse credentials are absent. We did not inspect configuration values or connect to Langfuse, so no claim is made about current deployed telemetry.

## Model comparison and Gemini compatibility

`src/agent/llm.ts` has a useful central factory, but it is currently Anthropic-specific with optional OpenAI failover:

- `makeLLM` returns `ChatAnthropic`, requires the Anthropic key, and reads model tiers from environment-variable names. Some clients are initialized at module import in `src/agent/nodes.ts:45–76`.
- Source defaults name Claude tiers and OpenAI fallback model IDs; their availability was not checked. No live model list was queried.
- The OpenAI helper adapts structured output with function calling because these Zod schemas use optional properties. It removes Anthropic cache metadata from messages. Anthropic-specific temperature/top-p handling and raw usage shapes also exist.
- No Gemini implementation appears in the inspected model factory or direct package declarations. A Gemini key alone cannot run this app's existing pipeline.
- Some endpoints call `makeLLM` directly outside the primary pipeline (`src/server.ts:509`, `:1086`); handson/skill generation are additional routes. Scope the first adapter to the lesson overview/build paths and visibly mark other routes as not yet covered.

**Required adapter before real comparison:** dependency-inject a per-run model binding for logical roles, normalize message/schema/streaming/usage/error behavior, and explicitly check each candidate's required capabilities. Keep provider fallbacks disabled during a comparison or record the provider that actually answered. Do not change process-wide environment variables between concurrent candidates; the existing singleton clients would make that unreliable.

Support two clearly labelled experiments: (a) replay fixed node inputs against up to five compatible candidates; (b) run a complete isolated workflow per candidate. End-to-end runs will produce different downstream prompts because earlier outputs differ. Clone run state and pin graph/prompt/schema versions and retrieval inputs. Schedule within a shared concurrency and spending budget: five candidate workflows can otherwise fan out to at least 25 module calls, plus repair/prose calls. Report all node outputs, errors and evaluator scores; a single prompt is a comparison example, not a model ranking.

## Safe target and red-team scope

The source has authentication, persisted user artifacts, uploads, public UUID-based artifact/module routes, credit deductions and billing integrations. A behavioral test against a production URL could create content or charge credits. The approval-ready scope should be a local/staging clone with isolated artifact storage, fake/test identities, fixture retrieval and billing disabled. Do not use production credentials as test defaults.

Useful specialist roles for this target: route authorization and ownership review; retrieval/prompt-injection probes; schema and generated-code integrity; failure/retry/concurrency behavior; and accounting side effects. The master proposes a bounded test plan and merges evidence. Static findings remain hypotheses until reproduced; probe results record exact inputs, environment, node trace and outcome. Specialists do not receive arbitrary shell/network privileges or production credentials merely because they are called red-team agents.

For initial evals, reuse existing Zod/blueprint validation (`src/render/schema.ts:641`), content-integrity lint (`src/agent/codegate.ts:47`), density measurements, and selected rendering fixtures. Existing `scripts/qa.mjs` is authenticated UI QA; it is not a ready-made offline agent benchmark. Full app startup imports configured model clients, so avoid treating “import a node to test it” as a secret-free operation until dependencies are injected.

## Useful pinned source links

- [Current orchestration](https://github.com/APareek89/agentic-learning-studio/blob/5968d231fae50fa3364470fbf0377968630aff6d/src/agent/orchestrator.ts)
- [Legacy graph](https://github.com/APareek89/agentic-learning-studio/blob/5968d231fae50fa3364470fbf0377968630aff6d/src/agent/graph.ts)
- [Model factory and fallback adapters](https://github.com/APareek89/agentic-learning-studio/blob/5968d231fae50fa3364470fbf0377968630aff6d/src/agent/llm.ts)
- [Generation nodes](https://github.com/APareek89/agentic-learning-studio/blob/5968d231fae50fa3364470fbf0377968630aff6d/src/agent/nodes.ts)
- [Tracing seam](https://github.com/APareek89/agentic-learning-studio/blob/5968d231fae50fa3364470fbf0377968630aff6d/src/lib/langfuse.ts)
- [HTTP routes and runtime boundary](https://github.com/APareek89/agentic-learning-studio/blob/5968d231fae50fa3364470fbf0377968630aff6d/src/server.ts)
