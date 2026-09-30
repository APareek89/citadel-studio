import test from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  access,
} from "node:fs/promises";
import { inflateRawSync } from "node:zlib";
import { request as httpRequest } from "node:http";
import path from "node:path";
import { tmpdir } from "node:os";

const workspace = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "..",
);
const port = 3801;
const base = `http://127.0.0.1:${port}`;
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Parse the central directory so assertions inspect real ZIP members without executing them. */
function zipMembers(buffer: Buffer): Map<string, string> {
  let end = buffer.length - 22;
  while (end >= 0 && buffer.readUInt32LE(end) !== 0x06054b50) end--;
  assert.ok(end >= 0, "Export must be a ZIP archive");
  const count = buffer.readUInt16LE(end + 10);
  let offset = buffer.readUInt32LE(end + 16);
  const files = new Map<string, string>();
  for (let i = 0; i < count; i++) {
    assert.equal(buffer.readUInt32LE(offset), 0x02014b50);
    const method = buffer.readUInt16LE(offset + 10),
      size = buffer.readUInt32LE(offset + 20),
      nameLength = buffer.readUInt16LE(offset + 28),
      extraLength = buffer.readUInt16LE(offset + 30),
      commentLength = buffer.readUInt16LE(offset + 32),
      local = buffer.readUInt32LE(offset + 42);
    const name = buffer
      .subarray(offset + 46, offset + 46 + nameLength)
      .toString();
    const dataStart =
      local +
      30 +
      buffer.readUInt16LE(local + 26) +
      buffer.readUInt16LE(local + 28);
    const compressed = buffer.subarray(dataStart, dataStart + size);
    const contents = method === 8 ? inflateRawSync(compressed) : compressed;
    files.set(name, contents.toString("utf8"));
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return files;
}

test(
  "isolated HTTP API: preflight, source mapping, redaction, export, restart and local boundaries",
  { timeout: 35_000 },
  async (t) => {
    const directory = await mkdtemp(path.join(tmpdir(), "citadel-api-tests-"));
    const data = path.join(directory, "data");
    await mkdir(data);
    const secretsFile = path.join(directory, "mysecrets-fixture");
    const syntheticKey = "AIza" + "x".repeat(36);
    await writeFile(secretsFile, `GEMINI_API_KEY=${syntheticKey}\n`, {
      mode: 0o600,
    });
    const guard = path.join(directory, "no-network.mjs");
    await writeFile(
      guard,
      "globalThis.fetch=async()=>{throw new Error('External provider network is disabled by the API test harness')};\n",
    );
    const date = new Date().toISOString();
    const seedGraph = {
      id: "seed-graph",
      revision: 1,
      name: "Recovered project",
      description: "Fixture",
      nodes: [
        { id: "entry", role: "orchestrator", label: "Entry" },
        {
          id: "writer",
          role: "agent",
          label: "Writer",
          prompt: "Respond helpfully",
        },
        { id: "output", role: "output", label: "Output" },
      ],
      edges: [
        {
          id: "a",
          source: "entry",
          target: "writer",
          kind: "data",
          label: "input",
        },
        {
          id: "b",
          source: "writer",
          target: "output",
          kind: "data",
          label: "output",
        },
      ],
      limits: {
        maxCalls: 2,
        maxRevisions: 0,
        timeoutMs: 5000,
        maxOutputTokens: 128,
      },
    };
    const seedProject = {
      id: "restart-project",
      name: "Recovered project",
      brief: "fixture",
      graph: seedGraph,
      createdAt: date,
      updatedAt: date,
    };
    const seedRun = (id: string, status: string) => ({
      id,
      projectId: seedProject.id,
      graph: seedGraph,
      input: "fixture",
      config: { credentialId: "former-key", model: "former-model" },
      status,
      mode: "build",
      events: [],
      createdAt: date,
      usage: { inputTokens: 0, outputTokens: 0 },
    });
    const suite = {
      id: "restart-suite",
      projectId: seedProject.id,
      name: "Fixture",
      version: 1,
      cases: [{ id: "case", input: "x", assertions: [] }],
      createdAt: date,
    };
    await writeFile(
      path.join(data, "workspace.json"),
      JSON.stringify({
        projects: [seedProject],
        runs: [
          seedRun("was-running", "running"),
          seedRun("was-queued", "queued"),
        ],
        comparisons: [],
        suites: [suite],
        reports: [
          {
            id: "restart-report",
            suite,
            graphRevision: 1,
            createdAt: date,
            status: "running",
            results: [{ caseId: "case", verdict: "pending", reasons: [] }],
          },
        ],
        redPlans: [
          {
            id: "restart-redteam",
            projectId: seedProject.id,
            target: "manifest",
            scope: "local-test",
            brandRules: "",
            maxProbes: 1,
            createdAt: date,
            status: "running",
            probes: [],
            findings: [],
          },
        ],
      }),
    );
    let child: ChildProcess | undefined;
    let logs = "";
    const stop = async () => {
      if (!child || child.exitCode !== null || child.signalCode !== null)
        return;
      const current = child;
      current.kill("SIGTERM");
      await Promise.race([
        new Promise<void>((resolve) => current.once("exit", () => resolve())),
        delay(4500),
      ]);
      if (current.exitCode === null && current.signalCode === null) {
        current.kill("SIGKILL");
        await new Promise<void>((resolve) =>
          current.once("exit", () => resolve()),
        );
      }
      child = undefined;
    };
    const start = async (dev: boolean) => {
      logs = "";
      child = spawn(
        process.execPath,
        ["--import", "tsx", "--import", guard, "server/index.ts"],
        {
          cwd: workspace,
          env: {
            PORTFOLIO_AUTH_ENABLED: "0",
            PATH: process.env.PATH,
            HOME: directory,
            TMPDIR: process.env.TMPDIR,
            PORT: String(port),
            WORKBENCH_DATA_DIR: data,
            WORKBENCH_SECRETS_FILE: secretsFile,
            WORKBENCH_DEV: dev ? "1" : "0",
          },
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      child.stdout!.on("data", (chunk) => {
        logs = (logs + String(chunk)).slice(-8000);
      });
      child.stderr!.on("data", (chunk) => {
        logs = (logs + String(chunk)).slice(-8000);
      });
      for (let attempt = 0; attempt < 60; attempt++) {
        if (child.exitCode !== null || child.signalCode !== null)
          throw new Error(`API test server exited: ${logs}`);
        if (logs.includes("Agent Workbench:")) {
          const response = await fetch(base + "/api/health");
          if (response.ok) return;
        }
        await delay(100);
      }
      throw new Error(`API test server did not become ready: ${logs}`);
    };
    const api = async (route: string, method = "GET", body?: unknown) =>
      fetch(base + route, {
        method,
        headers:
          body === undefined
            ? undefined
            : { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    try {
      await start(true);
      await t.test(
        "restart converts unfinished runs/reports/campaigns to explicit interrupted evidence",
        async () => {
          const response = await api("/api/bootstrap");
          assert.equal(response.status, 200);
          assert.equal(response.headers.get("cache-control"), "no-store");
          const bootstrap: any = await response.json();
          assert.equal(bootstrap.credentials.length, 0);
          assert.equal(bootstrap.system.localSecretsAvailable, true);
          assert.ok(
            bootstrap.runs.every(
              (run: any) =>
                run.status === "interrupted" &&
                run.events.some((e: any) => e.type === "run.interrupted"),
            ),
          );
          assert.equal(bootstrap.reports[0].results[0].verdict, "error");
          assert.equal(
            bootstrap.redPlans[0].findings[0].evidenceType,
            "inconclusive",
          );
          assert.ok(!JSON.stringify(bootstrap).includes(syntheticKey));
        },
      );
      await t.test(
        "origin, Host and content-type boundaries reject foreign or malformed requests",
        async () => {
          assert.equal(
            (
              await fetch(base + "/api/bootstrap", {
                headers: { Origin: "https://attacker.example" },
              })
            ).status,
            403,
          );
          // Undici normalizes Host; use the HTTP primitive to test the actual wire header.
          const hostStatus = await new Promise<number | undefined>(
            (resolve, reject) => {
              const req = httpRequest(
                base + "/api/bootstrap",
                { headers: { Host: "attacker.example" } },
                (res) => {
                  res.resume();
                  resolve(res.statusCode);
                },
              );
              req.on("error", reject);
              req.end();
            },
          );
          assert.equal(hostStatus, 403);
          assert.equal(
            (
              await fetch(base + "/api/projects", {
                method: "POST",
                headers: { "Content-Type": "text/plain" },
                body: "x",
              })
            ).status,
            415,
          );
          assert.equal((await api("/api/projects", "POST", {})).status, 422);
          assert.equal((await api("/api/not-a-real-route")).status, 404);
        },
      );
      let importedCredential: any;
      await t.test(
        "synthetic local key import returns metadata only; invalid-key preflight never calls a provider",
        async () => {
          const short = await api("/api/credentials", "POST", {
            provider: "gemini",
            label: "Bad key",
            key: "short",
          });
          assert.equal(short.status, 422);
          const imported = await api("/api/credentials/import", "POST", {
            provider: "gemini",
          });
          assert.equal(imported.status, 200);
          const raw = await imported.text();
          assert.ok(!raw.includes(syntheticKey));
          importedCredential = JSON.parse(raw);
          assert.equal(importedCredential.valid, false);
          const preflight: any = await (
            await api("/api/preflight", "POST", {
              projectId: seedProject.id,
              input: "sample",
              config: {
                credentialId: importedCredential.id,
                model: "gemini-2.5-flash",
              },
            })
          ).json();
          assert.equal(preflight.ok, false);
          assert.ok(
            preflight.issues.some(
              (issue: any) => issue.code === "credential_model",
            ),
          );
          const run = await api("/api/runs", "POST", {
            projectId: seedProject.id,
            input: "sample",
            config: {
              credentialId: importedCredential.id,
              model: "gemini-2.5-flash",
            },
          });
          assert.equal(run.status, 400);
          assert.match(await run.text(), /Validate this credential/);
          assert.ok(
            !logs.includes("External provider network"),
            "No inference or metadata request should be attempted during failed preflight.",
          );
        },
      );
      let project: any;
      await t.test(
        "red-team run rejects absent or false approval before dispatch",
        async () => {
          for (const confirmed of [undefined, false]) {
            const response = await api(
              "/api/redteam/not-an-approved-plan/run",
              "POST",
              {
                config: {
                  credentialId: importedCredential.id,
                  model: "gemini-2.5-flash",
                },
                ...(confirmed === undefined ? {} : { confirmed }),
              },
            );
            assert.equal(response.status, 422);
            assert.match(await response.text(), /confirmed/);
          }
          assert.ok(!logs.includes("External provider network"));
        },
      );
      await t.test(
        "saved revisions and exported runnable ZIP remove keys and machine source references",
        async () => {
          const created = await api("/api/projects", "POST", {
            name: "Export fixture",
            brief: `Never reveal ${syntheticKey}`,
          });
          assert.equal(created.status, 200);
          project = await created.json();
          assert.ok(!JSON.stringify(project).includes(syntheticKey));
          const graph = structuredClone(project.graph);
          const writer = graph.nodes.find((node: any) => node.id === "writer");
          writer.prompt = `Do not expose ${syntheticKey}`;
          writer.source = {
            path: "/Users/synthetic/private/source.ts",
            line: 1,
          };
          const updated = await api(`/api/projects/${project.id}`, "PUT", {
            graph,
          });
          assert.equal(updated.status, 200);
          const updatedProject: any = await updated.json();
          assert.equal(updatedProject.graph.revision, 2);
          const exported = await api(`/api/projects/${project.id}/export`);
          assert.equal(exported.status, 200);
          assert.match(
            exported.headers.get("content-disposition") || "",
            /attachment/,
          );
          const members = zipMembers(Buffer.from(await exported.arrayBuffer()));
          for (const expected of [
            "app.ts",
            "graph.json",
            "package.json",
            "app.test.ts",
            "server/runtime.ts",
            ".env.example",
          ])
            assert.ok(members.has(expected), expected);
          const exportedGraph = JSON.parse(members.get("graph.json")!);
          assert.equal(exportedGraph.revision, 2);
          assert.ok(exportedGraph.nodes.every((node: any) => !node.source));
          for (const text of members.values()) {
            assert.ok(!text.includes(syntheticKey));
            assert.ok(!text.includes("/Users/synthetic/private"));
          }
          assert.match(members.get(".env.example")!, /^API_KEY=\n/);
          assert.ok(!members.has("workspace.json"));
          assert.ok(!members.has("events.jsonl"));
          assert.ok(
            !(
              await readFile(path.join(data, "workspace.json"), "utf8")
            ).includes(syntheticKey),
          );
        },
      );
      await t.test(
        "local source discovery is honest about execution coverage and rejects arbitrary execution",
        async () => {
          const target = path.join(directory, "source-target");
          await mkdir(path.join(target, "src"), { recursive: true });
          await writeFile(
            path.join(target, "package.json"),
            JSON.stringify({ name: "synthetic-target" }),
          );
          await writeFile(
            path.join(target, "src", "app.ts"),
            'export const greeting = "hello";',
          );
          await writeFile(
            path.join(target, ".env"),
            "UNREAD_SYNTHETIC_SECRET=do-not-load",
          );
          const response = await api("/api/repos/connect", "POST", {
            path: target,
          });
          assert.equal(response.status, 200);
          const connected: any = await response.json();
          assert.equal(connected.repo.adapter, "discovery-only");
          assert.ok(
            connected.graph.nodes.some((node: any) => node.role === "opaque"),
          );
          assert.ok(
            !connected.repo.sources.some(
              (source: any) => source.path === ".env",
            ),
          );
          const preflight: any = await (
            await api("/api/preflight", "POST", {
              projectId: connected.id,
              input: "sample",
              config: {
                credentialId: importedCredential.id,
                model: "gemini-2.5-flash",
              },
            })
          ).json();
          assert.ok(
            preflight.issues.some(
              (issue: any) => issue.code === "adapter_missing",
            ),
          );
          assert.equal(
            (
              await api(`/api/projects/${connected.id}`, "PUT", {
                graph: project.graph,
              })
            ).status,
            400,
          );
          assert.equal(
            (await api(`/api/projects/${connected.id}/export`)).status,
            400,
          );
        },
      );
      await t.test(
        "developer asset server blocks source, credentials and private paths",
        async () => {
          for (const route of [
            "/mysecrets",
            "/server/providers.ts",
            "/.local/workspace.json",
            "/.env",
            `/@fs/${secretsFile}`,
          ]) {
            const response = await api(route);
            assert.equal(response.status, 403, route);
            assert.ok(!(await response.text()).includes(syntheticKey));
          }
        },
      );
      await stop();
      await start(false);
      await t.test(
        "restart drops credential values while keeping saved project revisions",
        async () => {
          const bootstrap: any = await (await api("/api/bootstrap")).json();
          assert.equal(bootstrap.credentials.length, 0);
          assert.equal(
            bootstrap.projects.find((p: any) => p.id === project.id).graph
              .revision,
            2,
          );
          const check: any = await (
            await api("/api/preflight", "POST", {
              projectId: project.id,
              input: "x",
              config: {
                credentialId: importedCredential.id,
                model: "gemini-2.5-flash",
              },
            })
          ).json();
          assert.equal(check.ok, false);
          assert.match(check.issues[0].message, /missing|re-added/i);
        },
      );
      await t.test(
        "production SPA fallback never serves server source or local secret bytes",
        async () => {
          let production = true;
          try {
            await access(path.join(workspace, "dist/index.html"));
          } catch {
            production = false;
          }
          for (const route of [
            "/mysecrets",
            "/server/providers.ts",
            `/@fs/${secretsFile}`,
          ]) {
            const response = await api(route);
            const text = await response.text();
            assert.ok(!text.includes(syntheticKey));
            assert.ok(!text.includes("function getCredential"));
            if (response.status === 200) assert.match(text, /<html/i);
            else assert.ok([403, 404].includes(response.status));
          }
          t.diagnostic(
            production
              ? "Production bundle fallback exercised."
              : "No production bundle: development deny path exercised instead.",
          );
          if (production) {
            const page = await api("/");
            const html = await page.text();
            const entry = html.match(
              /<script\b[^>]*\bsrc="(\/assets\/[^\"]+\.js)"/,
            )?.[1];
            assert.ok(
              entry,
              "Published HTML identifies its exact JavaScript build",
            );
            assert.equal(page.headers.get("cache-control"), "no-store");
            const health: any = await (await api("/api/health")).json();
            assert.equal(
              health.uiEntry,
              entry,
              "Open clients can detect an outdated bundle",
            );
            assert.equal((await api(entry!)).status, 200);
          }
        },
      );
    } finally {
      await stop();
      await rm(directory, { recursive: true, force: true });
    }
  },
);
