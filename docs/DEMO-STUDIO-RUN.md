# Demo Studio original-source execution receipt

On 25 September 2026, the workbench recorded a real, isolated run of Demo Studio's original conversational guardrails and session-summary agent. This is a subsystem execution against synthetic inputs, not a full demo build, live customer session or production deployment.

In **Connect & Debug**, select **demo-studio** (`project_8affabcd-15d`) and the completed observed run `observed_3485872e-b80`. Its five spans cover the QA harness, original conversational policy, original safe-response renderer, original source-coverage guard and original session-summary agent. Each source span retains its real function location and input/output. The separate model broker run records provider usage.

## What executed

The reviewed source is revision `e80a18077036490e25608d90ff027f918379bcc1`. The harness checks that revision and the committed/current SHA-256 bytes before copying only three modules into a temporary directory:

- `server/runtime_acts.py`: `allowed_act_ids` and `render_act`, including their actual context and input checks.
- `server/runtime_coverage.py`: `unsupported_coverage_claim` and `coverage_limitation`.
- `server/agents/summary.py`: the original `SUMMARY_SYSTEM`, Pydantic contracts, `_payload`, `summarize` and deterministic post-processing.

The summary received a three-line synthetic conversation: a visitor wanted family seating, asked for the current on-road price in Pune, and had not chosen a variant. One real `gemini-3.5-flash-lite` call returned a structured summary. The original Pydantic schema validated it; original code retained the unanswered pricing request and set the opener to:

> I'd like to discuss the questions left open in your demo.

Original record copying retained the actual fixture questions and slide durations, with empty CTA and lead fields. No missing price or customer action was invented in the observed result. This single sample does not establish broad semantic quality.

The provider reported 607 input tokens and 127 output tokens. The workbench estimate was **US$0.0004996**. The request was capped at one call, 1,200 output tokens, 80 seconds and US$0.02, under the shared US$3 QA ledger. There was no paid retry or fallback. This is an estimate, not the provider invoice.

## Isolation and substitutions

The trusted QA harness executed unchanged module copies under macOS `sandbox-exec`, with an empty inherited environment, Python `-I -S -B`, a timeout, capped IPC and scratch-directory cleanup. Python's site initialization and `.pth` hooks were disabled. Existing Python/Pydantic libraries supplied schema validation; no dependencies were installed. Real denial checks passed for network access, file writes, process forks and reading a canary outside the allowed directory. System/Rosetta runtime files and the installed schema-library directory were readable.

Only these application boundaries were substituted:

- `store.read_json` / `store.load`: synthetic product/deck records in memory; no real demo, user data, configuration or persistence was loaded.
- `config`: `MOCK_LLM=False` for the live summary. The unused mock provider fails closed.
- `runtime.structured`: one IPC request to the workbench's existing budgeted provider broker. Provider credentials remained in the workbench server. The original prompt, input and output schema were used; original Pydantic validation ran after the broker returned. Demo Studio's fallback/provider-race logic did not execute, and its requested low-thinking option was not forwarded by this broker.

The harness posted native spans to the local receiver after each actual operation. The receiver token was session-only and is absent from the receipt. It was replaced for this QA run. The QA broker is a separate, clearly named local manifest project; it does not add a generic Demo Studio execution adapter or make imported source executable through the ordinary Run button.

## Failure retained

The first free guardrail attempt is preserved as failed observed run `observed_c9aa34ca-b28`. The original coverage regex missed:

> The documents contain no pricing information.

The narrower case “The documents do not mention pricing.” was caught and converted to a verification limitation. The successful run records both that supported behavior and the missed wording. Demo Studio's own module describes this as a conservative text guard, not an entailment engine; this finding concerns the isolated coverage function and does not prove the full runtime would accept that sentence. No Demo Studio fix was made under this task.

## Reproduction and limits

`scripts/qa/demo-studio-run.mjs` is a finite, pinned QA harness; `scripts/qa/demo-studio-worker.py` is its sandbox worker. The default command executes only the free guardrail path. `--live` deliberately requests another paid one-call summary and requires a currently validated small Gemini credential in the local workbench; this receipt is not standing permission for repeated paid QA.

The detailed local receipt is `output/qa/demo-studio-original-run.json`. It records source hashes, output, sandbox checks and the broker/native run IDs without credentials. The completed workbench trace is the persisted execution evidence.

Full Read/Align/Build, retrieval, media generation, speech, LangGraph orchestration, app storage and production services were not exercised. The source repository was unchanged. Parent links show the QA harness's invocation hierarchy; they do not establish the full application's data flow.
