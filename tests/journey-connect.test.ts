import test from "node:test";
import assert from "node:assert/strict";
import { spawn, execFile, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  access,
} from "node:fs/promises";
import { createServer } from "node:http";
import { once } from "node:events";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const workspace = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const execute = promisify(execFile);
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const githubToken = "github_pat_CONNECT_JOURNEY_SYNTHETIC_123456";
const providerKey = "synthetic_connect_model_key_123456";
const literalSecret = "synthetic_source_password_do_not_disclose";
const publicKey = "pk_lf_connect_fixture_123456";
const secretKey = "sk_lf_connect_fixture_123456";

test(
  "Connect customer journey: private access and upload → map/recover → inspect → observe/diagnose → replace/restart",
  { timeout: 45000 },
  async (t) => {
    const scratch = await mkdtemp(
      path.join(tmpdir(), "workbench-connect-journey-"),
    );
    const data = path.join(scratch, "data"),
      source = path.join(scratch, "source"),
      bin = path.join(scratch, "bin");
    const canary = path.join(scratch, "repository-executed");
    const audit = path.join(scratch, "requests.jsonl"),
      mode = path.join(scratch, "model-mode");
    const realGit = (await execute("/usr/bin/which", ["git"])).stdout.trim();
    const gitEnv = {
      PATH: process.env.PATH,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_SYSTEM: "/dev/null",
    };
    const git = (args: string[]) =>
      execute(realGit, ["-c", "core.hooksPath=/dev/null", ...args], {
        env: gitEnv,
      });
    await mkdir(source);
    await mkdir(bin);
    await writeFile(mode, "valid");
    const python = `from pathlib import Path\nPath(${JSON.stringify(canary)}).write_text("executed")\npassword = ${JSON.stringify(literalSecret)}\n\ndef draft(question):\n    return client.messages.create(question)\n\ndef check(answer):\n    if not answer:\n        raise ValueError("EMPTY_ANSWER")\n    return answer\n\ndef workflow(question):\n    return check(draft(question))\n`;
    await writeFile(path.join(source, "workflow.py"), python);
    await writeFile(
      path.join(source, "README.md"),
      "# Synthetic private app\n",
    );
    await writeFile(
      path.join(source, ".env"),
      "EXCLUDED_PRIVATE_ENV=never_read_fixture\n",
    );
    await git(["init", "--initial-branch=main", source]);
    await git(["-C", source, "add", "workflow.py", "README.md"]);
    await git([
      "-C",
      source,
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "commit",
      "-m",
      "fixture",
    ]);
    // GitHub authentication is mocked; cloning still exercises real Git against a local fixture.
    await writeFile(
      path.join(bin, "gh"),
      `#!${process.execPath}\nprocess.exit(1);\n`,
      { mode: 0o700 },
    );
    await writeFile(
      path.join(bin, "git"),
      `#!${process.execPath}
const cp=require('node:child_process'),fs=require('node:fs');
let args=process.argv.slice(2); const clone=args.indexOf('clone');
if(clone>=0){const separator=args.lastIndexOf('--'),remote=args[separator+1];if(remote!=='https://github.com/fixtureowner/private-app.git')process.exit(70);if(!process.env.WORKBENCH_GITHUB_CLONE_TOKEN||args.some(a=>a.includes(process.env.WORKBENCH_GITHUB_CLONE_TOKEN)))process.exit(71);args[separator+1]=process.env.FIXTURE_REPO;args.unshift('-c','protocol.file.allow=always');const r=cp.spawnSync(process.env.REAL_GIT,args,{env:process.env,encoding:'utf8'});if(r.status!==0){process.stderr.write(r.stderr||'');process.exit(r.status||1)}const dest=args.at(-1);const c=cp.spawnSync(process.env.REAL_GIT,['-C',dest,'config','remote.origin.url',remote],{env:process.env,encoding:'utf8'});fs.appendFileSync(process.env.FIXTURE_AUDIT,JSON.stringify({kind:'local-clone'})+'\\n');process.exit(c.status||0)}
if(args.some(a=>/^(?:https?:|ssh:|git@)/.test(a)))process.exit(72);
const r=cp.spawnSync(process.env.REAL_GIT,args,{env:process.env,encoding:'utf8'});process.stdout.write(r.stdout||'');process.stderr.write(r.stderr||'');process.exit(r.status||0);
`,
      { mode: 0o700 },
    );
    const guard = path.join(scratch, "fixtures.mjs");
    await writeFile(
      guard,
      `import fs from 'node:fs';
import http from 'node:http';import https from 'node:https';import {syncBuiltinESMExports} from 'node:module';
const log=value=>fs.appendFileSync(process.env.FIXTURE_AUDIT,JSON.stringify(value)+'\\n');
for(const module of [http,https]){const original=module.request;module.request=function(input,...args){const host=typeof input==='string'?new URL(input).hostname:input instanceof URL?input.hostname:input.hostname||input.host;if(!['127.0.0.1','localhost','::1'].includes(host)){log({kind:'blocked-network'});throw new Error('Non-loopback HTTP disabled by journey fixture')}return original.call(this,input,...args)}}syncBuiltinESMExports();
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
globalThis.fetch=async(raw,init={})=>{const url=new URL(String(raw));
if(url.hostname==='api.github.com') {log({kind:'github-fixture',path:url.pathname});if(init.headers.Authorization!=='Bearer '+${JSON.stringify(githubToken)})return json({message:'bad fixture credential'},401);if(url.pathname==='/user')return json({login:'FixtureOwner'});if(url.pathname==='/user/repos')return json([{name:'private-app',html_url:'https://github.com/FixtureOwner/private-app',private:true,description:'Fixture private repository'}]);}
if(url.hostname==='generativelanguage.googleapis.com') {
if((init.method||'GET')==='GET'){log({kind:'model-catalog-fixture'});return json({models:[{name:'models/gemini-2.5-flash',displayName:'Fixture model',supportedGenerationMethods:['generateContent']}]});}
const body=JSON.parse(init.body);const input=body.contents[0].parts[0].text;
if([${JSON.stringify(githubToken)},${JSON.stringify(providerKey)},${JSON.stringify(literalSecret)},${JSON.stringify(secretKey)}].some(secret=>input.includes(secret)))throw new Error('Synthetic credential leaked into mapper evidence');
const evidence=JSON.parse(input);log({kind:'mapping-fixture',candidates:evidence.candidates.length});
let text='invalid fixture JSON';
if(fs.readFileSync(process.env.FIXTURE_MODE,'utf8')==='valid'){const nodes=evidence.candidates.map((c,i)=>({key:'stage_'+i,label:c.source.symbol||c.label,role:c.role,description:'Fixture source-backed responsibility',path:c.source.path,line:c.source.line,symbol:c.source.symbol,candidateIds:[c.id]}));text=JSON.stringify({nodes,edges:nodes.slice(1).map((n,i)=>({source:nodes[i].key,target:n.key,label:'Fixture inferred relationship'})),notes:['Fixture semantic inference; not observed execution']});}
return json({candidates:[{finishReason:'STOP',content:{parts:[{text}]}}],usageMetadata:{promptTokenCount:100,candidatesTokenCount:80}});
}
log({kind:'blocked-fetch'});throw new Error('Unmocked fetch disabled by journey fixture');};
`,
    );
    let remoteMode: "empty" | "rows" | "malformed" = "empty";
    const remoteRequests: string[] = [];
    const remote = createServer((req, res) => {
      const url = new URL(req.url!, "http://127.0.0.1");
      remoteRequests.push(url.pathname);
      const respond = (body: unknown, status = 200) =>
        res
          .writeHead(status, { "Content-Type": "application/json" })
          .end(JSON.stringify(body));
      if (
        req.headers.authorization !==
        "Basic " + Buffer.from(publicKey + ":" + secretKey).toString("base64")
      ) {
        respond({ message: "Unauthorized fixture" }, 401);
        return;
      }
      if (url.pathname === "/api/public/projects") {
        respond({
          data: [{ id: "remote-fixture", name: "Fixture remote app" }],
        });
        return;
      }
      if (url.pathname !== "/api/public/v2/observations") {
        respond({}, 404);
        return;
      }
      const start = new Date(Date.now() - 5000).toISOString(),
        end = new Date(Date.now() - 4000).toISOString();
      const rows = [
        {
          id: "remote-root",
          traceId: "remote-trace",
          name: "remote-workflow",
          type: "SPAN",
          startTime: start,
          endTime: end,
          input: "question",
          output: "partial",
        },
        {
          id: "remote-check",
          traceId: "remote-trace",
          parentObservationId: "remote-root",
          name: "remote-check",
          type: "GENERATION",
          startTime: start,
          endTime: end,
          level: "ERROR",
          statusMessage: "REMOTE_CHECK_FAILED " + secretKey,
          input: "draft",
          model: "remote-fixture-model",
          inputUsage: 11,
          outputUsage: 2,
        },
      ];
      respond({
        data:
          remoteMode === "empty"
            ? []
            : remoteMode === "malformed"
              ? [
                  ...rows,
                  {
                    id: "broken",
                    traceId: "invalid-trace",
                    startTime: "not-a-date",
                  },
                ]
              : rows,
      });
    });
    remote.listen(0, "127.0.0.1");
    await once(remote, "listening");
    const address = remote.address();
    assert.ok(address && typeof address !== "string");
    const remoteUrl = `http://127.0.0.1:${address.port}`;
    const portServer = createServer();
    portServer.listen(0, "127.0.0.1");
    await once(portServer, "listening");
    const appAddress = portServer.address();
    assert.ok(appAddress && typeof appAddress !== "string");
    const port = appAddress.port;
    await new Promise<void>((resolve) => portServer.close(() => resolve()));
    const base = `http://127.0.0.1:${port}`;
    let child: ChildProcess | undefined,
      logs = "";
    const request = (
      url: string,
      body?: unknown,
      method = body === undefined ? "GET" : "POST",
      token?: string,
    ) =>
      fetch(base + url, {
        method,
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: "Bearer " + token } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    const api = async (url: string, body?: unknown, method?: string) => {
      const response = await request(url, body, method);
      const result = await response.json();
      assert.equal(response.status, 200, `${url}: ${JSON.stringify(result)}`);
      return result;
    };
    const stop = async () => {
      if (child && child.exitCode === null && child.signalCode === null) {
        child.kill("SIGTERM");
        await Promise.race([once(child, "exit"), delay(4000)]);
        if (child.exitCode === null && child.signalCode === null) {
          child.kill("SIGKILL");
          await once(child, "exit");
        }
      }
    };
    const start = async () => {
      logs = "";
      child = spawn(
        process.execPath,
        ["--import", "tsx", "--import", guard, "server/index.ts"],
        {
          cwd: workspace,
          env: {
            PORTFOLIO_AUTH_ENABLED: "0",
            PATH: bin + path.delimiter + process.env.PATH,
            TMPDIR: process.env.TMPDIR,
            PORT: String(port),
            WORKBENCH_DATA_DIR: data,
            WORKBENCH_SECRETS_FILE: path.join(scratch, "nonexistent-secrets"),
            WORKBENCH_DEV: "0",
            WORKBENCH_SPEND_LIMIT_USD: "0",
            REAL_GIT: realGit,
            FIXTURE_REPO: source,
            FIXTURE_AUDIT: audit,
            FIXTURE_MODE: mode,
          },
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      child.stdout!.on("data", (chunk) => {
        logs = (logs + String(chunk)).slice(-10000);
      });
      child.stderr!.on("data", (chunk) => {
        logs = (logs + String(chunk)).slice(-10000);
      });
      for (let i = 0; i < 100; i++) {
        if (child.exitCode !== null || child.signalCode !== null)
          throw new Error("Fixture server exited: " + logs);
        if (logs.includes("Agent Workbench:")) {
          const result = await request("/api/health");
          if (result.ok) return;
        }
        await delay(60);
      }
      throw new Error("Fixture server failed to start: " + logs);
    };
    let project: any,
      uploaded: any,
      config: any,
      receiver: any,
      nativeRun: any,
      remoteRun: any;
    try {
      await start();
      await t.test(
        "private GitHub authentication and real local clone establish source access without execution",
        async () => {
          assert.equal((await api("/api/github/status")).connected, false);
          assert.equal(
            (
              await request("/api/github/token", {
                token: "invalid_fixture_token",
              })
            ).status,
            400,
          );
          const connected = await api("/api/github/token", {
            token: githubToken,
          });
          assert.deepEqual(connected, {
            connected: true,
            login: "FixtureOwner",
            authSource: "token",
          });
          const repos = await api("/api/repos/github");
          assert.equal(repos.length, 1);
          assert.equal(repos[0].isPrivate, true);
          project = await api("/api/repos/connect", {
            path: repos[0].url,
            mapping: "static",
          });
          assert.equal(project.repo.adapter, "discovery-only");
          assert.ok(
            project.repo.sources.some((s: any) => s.path === "workflow.py"),
          );
          assert.equal((await api("/api/bootstrap")).runs.length, 0);
          await assert.rejects(access(canary));
          assert.ok(
            !JSON.stringify(await api("/api/bootstrap")).includes(githubToken),
          );
        },
      );
      await t.test(
        "folder selection reports excluded resources; a missing map credential does not masquerade as mapped source",
        async () => {
          uploaded = await api("/api/repos/upload", {
            name: "Local fixture",
            files: [
              { path: "Local fixture/workflow.py", content: python },
              { path: "Local fixture/README.md", content: "# Local fixture" },
              { path: "Local fixture/.env", content: "EXCLUDED_UPLOAD_SECRET" },
            ],
            mapping: "static",
          });
          assert.equal(uploaded.name, "Local fixture");
          assert.equal(uploaded.repo.sourceKind, "upload");
          assert.equal(uploaded.upload.acceptedFiles, 2);
          assert.equal(uploaded.upload.skippedFiles, 1);
          const missing = await request(`/api/projects/${uploaded.id}/remap`, {
            mapping: "ai",
          });
          assert.equal(missing.status, 400);
          assert.match(
            (await missing.json()).error,
            /validated model credential/,
          );
          assert.equal(
            (await api("/api/bootstrap")).projects.find(
              (p: any) => p.id === uploaded.id,
            ).graph.revision,
            uploaded.graph.revision,
          );
          assert.equal(
            (await request(`/api/projects/${uploaded.id}/source?path=.env`))
              .status,
            404,
          );
        },
      );
      await t.test(
        "validate a fixture model, retain source after malformed AI response, retry to a source-backed workflow, and inspect redacted code",
        async () => {
          const credential = await api("/api/credentials", {
            provider: "gemini",
            label: "Synthetic fixture",
            key: providerKey,
          });
          const catalog = await api(
            `/api/credentials/${credential.id}/validate`,
            {},
          );
          assert.equal(catalog.models.length, 1);
          config = {
            credentialId: credential.id,
            provider: "gemini",
            model: "gemini-2.5-flash",
          };
          await writeFile(mode, "invalid");
          const failed = await api(`/api/projects/${project.id}/remap`, {
            mapping: "ai",
            config,
          });
          assert.equal(failed.repo.mapping.method, "static");
          assert.ok(failed.repo.mapping.error);
          assert.ok(failed.graph.nodes.some((n: any) => n.source));
          await writeFile(mode, "valid");
          project = await api(`/api/projects/${project.id}/remap`, {
            mapping: "ai",
            config,
          });
          assert.equal(
            project.repo.mapping.method,
            "ai",
            JSON.stringify(project.repo.mapping),
          );
          assert.ok(project.repo.mapping.mappedCandidates >= 3);
          assert.equal(project.repo.mapping.unresolvedCandidates, 0);
          uploaded = await api(`/api/projects/${uploaded.id}/remap`, {
            mapping: "ai",
            config,
          });
          assert.equal(uploaded.repo.mapping.method, "ai");
          assert.equal(uploaded.repo.sourceKind, "upload");
          assert.equal(uploaded.name, "Local fixture");
          assert.equal(uploaded.graph.name, "Local fixture");
          assert.ok(project.graph.nodes.some((n: any) => n.hidden));
          assert.ok(
            project.graph.edges.some((e: any) => e.provenance === "inferred"),
          );
          assert.ok(
            !project.graph.edges.some((e: any) => e.provenance === "observed"),
          );
          const node = project.graph.nodes.find(
            (n: any) => n.source?.symbol === "check",
          );
          assert.ok(node);
          const preview = await api(
            `/api/projects/${project.id}/source?path=${encodeURIComponent(node.source.path)}&line=${node.source.line}`,
          );
          assert.match(preview.content, /EMPTY_ANSWER/);
          assert.match(preview.content, /REDACTED/);
          assert.ok(!preview.content.includes(literalSecret));
          assert.equal((await api("/api/bootstrap")).runs.length, 0);
          await assert.rejects(access(canary));
        },
      );
      await t.test(
        "downloaded native helper records a real fixture failure whose node, source and partial output support diagnosis",
        async () => {
          receiver = await api(
            `/api/projects/${project.id}/telemetry/token`,
            {},
          );
          assert.equal(
            (
              await request(
                `/api/telemetry/${uploaded.id}/spans`,
                { traceId: "wrong-project", spans: [] },
                "POST",
                receiver.token,
              )
            ).status,
            401,
          );
          const helper = await (
            await request("/api/telemetry/client.mjs")
          ).text();
          const sdkPath = path.join(scratch, "downloaded-client.mjs");
          await writeFile(sdkPath, helper);
          const { WorkbenchTrace } = await import(pathToFileURL(sdkPath).href);
          const trace = new WorkbenchTrace("Fixture workflow failure", {
            url: receiver.endpoint,
            token: receiver.token,
            input: "question " + providerKey,
          });
          await assert.rejects(
            trace.run(async () => {
              await trace.span("draft", async () => "DRAFT_FOR_DIAGNOSIS", {
                source: { path: "workflow.py", symbol: "draft", line: 5 },
                input: "question",
              });
              return trace.span(
                "check",
                async () => {
                  throw new Error("EMPTY_ANSWER " + githubToken);
                },
                {
                  source: { path: "workflow.py", symbol: "check", line: 8 },
                  input: "DRAFT_FOR_DIAGNOSIS",
                },
              );
            }),
            /EMPTY_ANSWER/,
          );
          nativeRun = (await api("/api/bootstrap")).runs.find(
            (r: any) => r.external?.traceId === trace.traceId,
          );
          assert.ok(nativeRun);
          nativeRun = await api(`/api/runs/${nativeRun.id}`);
          assert.equal(nativeRun.status, "failed");
          assert.equal(nativeRun.external.kind, "workbench");
          const failed = nativeRun.events.find(
            (e: any) =>
              e.type === "node.failed" && /EMPTY_ANSWER/.test(e.message),
          );
          assert.ok(failed);
          const failedNode = nativeRun.graph.nodes.find(
            (n: any) => n.id === failed.nodeId,
          );
          assert.equal(failedNode.source.symbol, "check");
          assert.ok(
            nativeRun.events.some(
              (e: any) => e.output === "DRAFT_FOR_DIAGNOSIS",
            ),
          );
          assert.ok(
            nativeRun.graph.edges.some((e: any) => e.provenance === "observed"),
          );
          assert.match(nativeRun.events[0].message, /did not execute/);
          assert.ok(!JSON.stringify(nativeRun).includes(providerKey));
          assert.ok(!JSON.stringify(nativeRun).includes(githubToken));
          const preview = await api(
            `/api/projects/${project.id}/source?path=${failedNode.source.path}&line=${failedNode.source.line}`,
          );
          assert.match(preview.content, /raise ValueError/);
          const current = (await api("/api/bootstrap")).projects.find(
            (p: any) => p.id === project.id,
          );
          assert.deepEqual(current.graph, project.graph);
          assert.equal(
            (
              await request(
                `/api/telemetry/${project.id}/spans`,
                {
                  traceId: trace.traceId,
                  spans: [nativeRun.external.spans[0]],
                  output: "overwrite",
                  status: "completed",
                },
                "POST",
                receiver.token,
              )
            ).status,
            400,
          );
        },
      );
      await t.test(
        "Langfuse local connection covers invalid keys, empty sync, observed failure, idempotency and atomic malformed rejection",
        async () => {
          const endpoint = `/api/projects/${project.id}/langfuse`;
          assert.equal(
            (
              await request(endpoint, {
                url: remoteUrl,
                publicKey,
                secretKey: "wrong_fixture_secret",
              })
            ).status,
            400,
          );
          await api(endpoint, { url: remoteUrl, publicKey, secretKey });
          const empty = await api(endpoint + "/sync", { hours: 1 });
          assert.equal(empty.runs, 0);
          assert.match(empty.message, /no observations/);
          remoteMode = "rows";
          const synced = await api(endpoint + "/sync", { hours: 1 });
          assert.equal(synced.runs, 1);
          assert.equal(synced.spans, 2);
          remoteRun = (await api("/api/bootstrap")).runs.find(
            (r: any) => r.external?.kind === "langfuse",
          );
          assert.ok(remoteRun);
          assert.equal(remoteRun.status, "failed");
          assert.equal(remoteRun.external.partial, true);
          assert.ok(
            remoteRun.events.some(
              (e: any) =>
                e.type === "node.failed" &&
                e.message.includes("REMOTE_CHECK_FAILED"),
            ),
          );
          assert.ok(!JSON.stringify(remoteRun).includes(secretKey));
          await api(endpoint + "/sync", { hours: 1 });
          assert.equal((await api("/api/bootstrap")).runs.length, 2);
          const before = (await api("/api/bootstrap")).runs;
          remoteMode = "malformed";
          assert.equal(
            (await request(endpoint + "/sync", { hours: 1 })).status,
            400,
          );
          assert.deepEqual((await api("/api/bootstrap")).runs, before);
          remoteMode = "rows";
        },
      );
      await t.test(
        "same source preserves connections; replacing source revokes old tokens and retains immutable diagnosis evidence",
        async () => {
          const same = await api("/api/repos/connect", {
            projectId: project.id,
            path: project.repo.path,
            mapping: "static",
          });
          const connections = await api(
            `/api/projects/${project.id}/connections`,
          );
          assert.equal(connections.native.enabled, true);
          assert.equal(connections.langfuse.connected, true);
          const replaced = await api("/api/repos/connect", {
            projectId: project.id,
            path: uploaded.repo.path,
            mapping: "static",
          });
          assert.equal(replaced.graph.revision, same.graph.revision + 1);
          assert.notEqual(replaced.repo.path, project.repo.path);
          const cleared = await api(`/api/projects/${project.id}/connections`);
          assert.equal(cleared.native.enabled, false);
          assert.equal(cleared.langfuse.connected, false);
          assert.equal(
            (
              await request(
                `/api/telemetry/${project.id}/spans`,
                { traceId: "stale", spans: [] },
                "POST",
                receiver.token,
              )
            ).status,
            401,
          );
          assert.equal(
            (
              await request(`/api/projects/${project.id}/langfuse/sync`, {
                hours: 1,
              })
            ).status,
            400,
          );
          assert.deepEqual(await api(`/api/runs/${nativeRun.id}`), nativeRun);
          const rotated = await api(
            `/api/projects/${project.id}/telemetry/token`,
            {},
          );
          assert.notEqual(rotated.token, receiver.token);
          receiver = rotated;
          await api("/api/github/token", {}, "DELETE");
          assert.equal((await api("/api/github/status")).connected, false);
        },
      );
      await t.test(
        "restart preserves source and observed evidence while dropping session credentials and native access",
        async () => {
          await stop();
          await start();
          const restored = await api("/api/bootstrap");
          assert.equal(restored.system.localSecretsAvailable, false);
          assert.equal(restored.credentials.length, 0);
          assert.equal(restored.runs.length, 2);
          assert.deepEqual(await api(`/api/runs/${nativeRun.id}`), nativeRun);
          assert.equal(
            (await api(`/api/projects/${project.id}/connections`)).native
              .enabled,
            false,
          );
          assert.equal(
            (
              await request(
                `/api/telemetry/${project.id}/spans`,
                { traceId: "after-restart", spans: [] },
                "POST",
                receiver.token,
              )
            ).status,
            401,
          );
          const persisted = await readFile(
            path.join(data, "workspace.json"),
            "utf8",
          );
          for (const secret of [
            githubToken,
            providerKey,
            secretKey,
            publicKey,
            receiver.token,
            literalSecret,
          ])
            assert.ok(!persisted.includes(secret));
          const calls = (await readFile(audit, "utf8"))
            .trim()
            .split("\n")
            .map((line) => JSON.parse(line));
          assert.equal(calls.filter((c) => c.kind === "local-clone").length, 1);
          assert.equal(
            calls.filter((c) => c.kind === "mapping-fixture").length,
            3,
          );
          assert.ok(
            !calls.some((c) => c.kind.startsWith("blocked")),
            "No unexpected outbound request was attempted",
          );
          assert.ok(remoteRequests.includes("/api/public/v2/observations"));
          await assert.rejects(access(canary));
        },
      );
    } finally {
      await stop();
      remote.closeAllConnections();
      await new Promise<void>((resolve) => remote.close(() => resolve()));
      await rm(scratch, { recursive: true, force: true });
    }
  },
);
