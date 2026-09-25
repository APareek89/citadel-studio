# Connect source and observe an existing app

Source mapping and execution evidence are separate connections. A repository shows what the code may do. Instrumentation records operations that an app actually reported. Neither connection authorizes the workbench to run arbitrary imported code.

Open **Connect & Debug → Connect** for the selected application. You can connect source, traces, or both. Source mapping with a model needs a validated model credential; native telemetry and Langfuse import do not.

## 1. Connect source

**Private or public GitHub repository.** Choose **GitHub**, then **Check GitHub CLI** to use the GitHub CLI account on the computer running the workbench. If needed, sign in from that computer with `gh auth login`. Alternatively, expand **Connect with a personal access token**, supply a token with read access to the desired repository, and choose **Validate & connect**. The account identity is checked before listing repositories. The picker returns up to 100 recently updated repositories accessible to that account, including private repositories; a missing picker entry can still be supplied as its URL.

Use `https://github.com/owner/repository`, optionally ending in `.git`. URLs containing credentials, query parameters, fragments or extra paths are rejected. A token is sent to the local server, cleared from the form, and held only in server memory. **Remove token** clears that session credential; any independent local CLI login remains available. An invalid explicit token must be replaced or removed before CLI authentication is used.

The workbench creates a managed shallow clone under its private data directory. It disables inherited Git configuration, hooks, templates, filters and submodules, and does not install dependencies or run repository scripts. Reconnecting an existing managed clone reuses it unchanged; it does not fetch the latest revision or reset files. GitHub access can therefore succeed while execution remains unsupported.

**Local path.** Choose **Local path** and enter an existing checkout directory accessible to the workbench server. Source reads stay within that directory; excluded secret files and symlinks are not imported. The source checkout is preserved.

**Upload folder.** Choose **Upload folder**, select a source directory and review the accepted/skipped file counts. The browser submits text files to the local server; this is not a ZIP upload or a Git clone. The server stores a separate private copy and rejects unsafe paths, duplicate/case-colliding paths and file/directory collisions. It excludes Git metadata, common credential files, dependencies, generated output and binary content. Limits: at most 500 submitted files, 900,000 UTF-8 bytes per file and 10 MiB total. The browser review uses a stricter 8 MiB total limit. The chosen application name is preserved on refresh. Upload acceptance does not mean every language or file is understood by the mapper.

## 2. Interpret the workflow

Choose **AI workflow map** with a compatible model credential. A small model interprets source evidence into meaningful agent, tool, check and orchestration stages. It receives candidate headers and bounded source excerpts; known credentials and common literal secret patterns are scrubbed before transmission. Source text is treated as untrusted input, not instructions. Use source-only/static discovery when you want local candidate extraction without an inference call.

Deterministic checks underpin the interpretation:

- Source discovery retains up to 500 files at depth 6, prioritizing backend source before bulk documentation. Large files above 900,000 bytes are not read. This is a bounded inventory, not a complete filesystem scan.
- TypeScript/JavaScript is parsed with the TypeScript AST. Python uses isolated standard-library `ast.parse`; repository modules, import hooks and top-level code are never executed. Parsing is capped at 220 files and 12 MB; syntax errors and unavailable Python parsing are disclosed.
- The candidate layer prioritizes actual LangGraph declarations, workflow-facing entry points, model calls and checks. The map limits expanded function/call-site candidates and reports additional declarations left in the file inventory.
- The semantic map groups related evidence into at most 20 workflow nodes. Unaccounted candidates remain disclosed in one expandable unresolved-coverage group. UI, DB/auth plumbing and documentation files remain hidden supporting resources. Administrative entry points and provider wrappers can be grouped into a supporting-services responsibility rather than receiving a workflow card each; their source references are retained.
- Source paths and referenced lines must exist in supplied evidence; duplicate/invented candidate assignments and invalid relationships are rejected. Coverage distinguishes interpreted, supporting and unresolved evidence. A source reference is evidence of code location, not proof that a model interpretation is correct.

Review the mapping notes, source references and unresolved group before relying on the graph. Dynamic dispatch, conditions, external-service behavior and uninstrumented paths can remain unknown. Source-declared or inferred edges describe potential structure, not recorded runtime data flow. Remapping creates a new graph revision; existing run snapshots retain their own graph.

## 3. Native tracing from your application

In **Connect live traces → Native instrumentation**, choose **Create integration token**. Copy the endpoint and token into the application server's environment. The endpoint is project-specific, for example:

```sh
export WORKBENCH_URL='http://127.0.0.1:3001/api/telemetry/PROJECT_ID/spans'
export WORKBENCH_TOKEN='PASTE_THE_ISSUED_TOKEN'
```

Use the actual values shown by the UI. Do not put the token in browser code. Download the **JavaScript helper** or **Python helper** under **Instrument an agent call** into your application. These dependency-free helpers wrap your existing functions; they do not generate an agent implementation or insert instrumentation automatically.

For server-side JavaScript, replace `research(question)` with your real operation:

```js
import { WorkbenchTrace } from './workbench-client.mjs';

const trace = new WorkbenchTrace('Answer a question', {
  input: { question },
});
const answer = await trace.run(() => trace.span(
  'Research',
  () => research(question),
  {
    role: 'agent',
    input: { question },
    source: { path: 'src/research.ts', symbol: 'research' },
  },
));
```

For Python, use the context managers around your existing operation and set the reported output:

```python
from workbench_client import WorkbenchTrace

trace = WorkbenchTrace('Answer a question', input={'question': question})
with trace.run() as run:
    with trace.span(
        'Research', role='agent', input={'question': question},
        source={'path': 'server/research.py', 'symbol': 'research'},
    ) as span:
        answer = research(question)
        span['output'] = answer
    run['output'] = answer
```

Use repository-relative `source.path` and the actual symbol; an optional line number helps associate spans with source nodes. A known `nodeId` in JavaScript, or `node_id` in Python, can explicitly identify a node. Nested helper spans carry parent IDs. Wrap the real agent, tool and validation operations whose input/output you want to inspect; calls outside those wrappers are not observed.

Each trace needs a new ID, which the helper creates. Running spans are sent before an operation, followed by completion or failure; the helper rethrows the application's original error. After correct setup, telemetry delivery failures are reported to the application console and do not replace its business result. Sending is best effort with a three-second request timeout; there is no durable retry queue. Helpers bound serialized payloads rather than sending arbitrarily large objects. Choose the fields you intend to record; application input/output can itself contain sensitive data.

The receiver accepts authenticated native batches of up to 200 spans / 1 MB. A trace is limited to 1,000 spans / 3 MB, with each input/output under 24,000 serialized characters. Duplicate span IDs within a batch, cyclic/self parent links and invalid timestamps are rejected. Native batches remain open until an explicit completed/failed trace status arrives; out-of-order child spans may arrive first. Finished native traces are immutable; use a new trace for the next request. Replacing a token invalidates the previous token for that project. **Disable receiver** stops new authenticated ingestion; saved evidence remains.

## 4. Receiver reachability

The workbench listens on `127.0.0.1`; its default port is 3001. Run the workbench while the instrumented app sends spans. `localhost` from a container, remote server or cloud deployment is that environment's own loopback, not this computer. The supplied endpoint must be reachable from the actual application process. This release does not publish a public receiver or configure a tunnel, container route, firewall or deployment for you.

The native endpoint does not grant a model credential or the ability to execute workbench code. It only accepts spans for the token's selected project. If an external run must stop, cancel it in its source application; the workbench cannot stop a process it did not start.

## 5. Import Langfuse observations

In **Connect live traces → Langfuse**, enter the base URL and that Langfuse project's public and secret keys (usually `pk-lf-…` and `sk-lf-…`). Choose **Validate & connect**, then **Sync recent traces · 24 h**. The server validates project access and reads the v2 observations API. It does not instrument the source app, install a Langfuse SDK, enable polling or trigger an app run.

Allowed base URLs are HTTPS on `cloud.langfuse.com`, `us.cloud.langfuse.com`, `jp.cloud.langfuse.com` or `hipaa.cloud.langfuse.com`; use the region where the project exists. Local `http://localhost:PORT`, `http://127.0.0.1:PORT` and their HTTPS equivalents are accepted for a local compatible v4 instance. Other self-hosted domains are not enabled. Credentials in URLs, non-root paths, queries, fragments and redirects are rejected. Local URLs are resolved from the workbench server's machine.

Each manual sync takes a **partial snapshot of the preceding 24 hours**, with at most three pages of 100 observations. The API allows a 1–168-hour window; the current UI uses 24 hours. Per-request deadlines are 12 seconds and response bodies are capped at 5 MB. Imported inputs/outputs are bounded. The result reports observation/trace counts and whether pagination was limited. Empty results mean the selected window had no returned observations; run the already-instrumented app and sync again.

Time windows, pagination and missing spans can omit parents or earlier parts of a trace. Synced hierarchy therefore remains explicitly partial, even when fewer than 300 observations were returned. Parent observations describe nesting or causality reported by the trace producer; they do not prove data flow between graph nodes, validation of output, or complete application coverage. External usage/cost values are producer-reported observations, not workbench model calls or an invoice.

## 6. Sessions, persistence and execution limits

Model-provider keys, GitHub session tokens and Langfuse keys stay in server memory. Native receiver tokens are project-scoped; the receiver stores their digests, with secret redaction registered for the session. These connections must be re-established after restarting the workbench. The CLI may retain its own GitHub login independently. Integration status responses and saved workspace/export data exclude connection credentials. Redacted graph/run evidence persists in the private local data directory; disconnecting a connection does not erase that evidence.

An imported source map remains source-owned and read-only here. Native traces and Langfuse observations report activity from another app; they do not make it runnable in the workbench. The existing Agentic Learning Studio adapter can execute only its reviewed overview path at the pinned revision under the macOS sandbox. Generic imported code remains unsupported for execution, and custom editable manifest code still requires Docker. Neither source import nor telemetry is a shortcut around those execution boundaries.
