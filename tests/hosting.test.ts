import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { request as httpRequest } from "node:http";
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { tmpdir } from "node:os";
import { readHostingConfig } from "../server/hosting.js";
import {
  importedExecutionAvailability,
  LEARNING_REVISION,
} from "../server/importer.js";
import { defaultGraph } from "../server/graph.js";
import type { RepoInfo } from "../shared/types.js";

const proxyToken = "synthetic-proxy-token-for-hosted-test-only-123456";
const origin = "https://workbench.example.test";
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test("hosted settings fail closed without TLS, proxy authentication or production mode", () => {
  assert.deepEqual(readHostingConfig({}), {});
  assert.deepEqual(
    readHostingConfig({
      WORKBENCH_PUBLIC_ORIGIN: origin,
      WORKBENCH_PROXY_TOKEN: proxyToken,
    }),
    { publicOrigin: origin, publicHost: "workbench.example.test", proxyToken },
  );
  for (const candidate of [
    "http://workbench.example.test",
    "https://user:password@workbench.example.test",
    origin + "/app",
    origin + "?query=1",
    origin + "#fragment",
    "invalid",
  ])
    assert.throws(() =>
      readHostingConfig({
        WORKBENCH_PUBLIC_ORIGIN: candidate,
        WORKBENCH_PROXY_TOKEN: proxyToken,
      }),
    );
  assert.throws(
    () => readHostingConfig({ WORKBENCH_PUBLIC_ORIGIN: origin }),
    /PROXY_TOKEN/,
  );
  assert.throws(
    () =>
      readHostingConfig({
        WORKBENCH_PUBLIC_ORIGIN: origin,
        WORKBENCH_PROXY_TOKEN: "short",
      }),
    /PROXY_TOKEN/,
  );
  assert.throws(
    () =>
      readHostingConfig({
        WORKBENCH_PUBLIC_ORIGIN: origin,
        WORKBENCH_PROXY_TOKEN: proxyToken,
        WORKBENCH_DEV: "1",
      }),
    /production/,
  );
});

test("Learning Studio keeps its adapter identity while platform capabilities stay explicit", () => {
  const repo: RepoInfo = {
    path: "/synthetic",
    name: "agentic-learning-studio",
    revision: LEARNING_REVISION,
    adapter: "learning-studio",
    coverage: [],
    limitations: [],
    sources: [],
  };
  assert.equal(
    importedExecutionAvailability(repo, "darwin", true).executionAvailable,
    true,
  );
  const linux = importedExecutionAvailability(repo, "linux", true);
  assert.equal(linux.executionAvailable, false);
  assert.match(linux.executionUnavailableReason!, /macOS sandbox/);
  assert.equal(repo.adapter, "learning-studio");
  assert.equal(
    importedExecutionAvailability(repo, "darwin", false).executionAvailable,
    false,
  );
  assert.equal(
    importedExecutionAvailability(
      { ...repo, revision: "unreviewed" },
      "darwin",
      true,
    ).executionAvailable,
    false,
  );
});

test(
  "hosted HTTP boundary protects every route and retains bearer-authenticated trace ingestion",
  { timeout: 15000 },
  async (t) => {
    const directory = await mkdtemp(
      path.join(tmpdir(), "workbench-hosted-test-"),
    );
    const data = path.join(directory, "data");
    await mkdir(data);
    const guard = path.join(directory, "no-network.mjs");
    await writeFile(
      guard,
      "globalThis.fetch=async()=>{throw new Error('External network disabled for hosted QA')};Object.defineProperty(process,'platform',{value:'linux'});\n",
    );
    const graph = defaultGraph("Linux source fixture");
    const date = new Date().toISOString();
    await writeFile(
      path.join(data, "workspace.json"),
      JSON.stringify({
        projects: [
          {
            id: "linux-project",
            name: "Linux source fixture",
            brief: "Fixture",
            graph,
            repo: {
              path: directory,
              name: "agentic-learning-studio",
              revision: LEARNING_REVISION,
              adapter: "learning-studio",
              coverage: [],
              limitations: [],
              sources: [],
            },
            createdAt: date,
            updatedAt: date,
          },
        ],
        runs: [],
        comparisons: [],
        suites: [],
        reports: [],
        redPlans: [],
      }),
    );
    const reservation = createServer();
    await new Promise<void>((resolve) =>
      reservation.listen(0, "127.0.0.1", resolve),
    );
    const address = reservation.address();
    assert.ok(address && typeof address !== "string");
    const port = address.port;
    await new Promise<void>((resolve) => reservation.close(() => resolve()));
    let child: ChildProcess | undefined;
    let logs = "";
    const api = (
      route: string,
      method = "GET",
      body?: unknown,
      headers: Record<string, string> = {},
    ): Promise<Response> =>
      new Promise((resolve, reject) => {
        const payload = body === undefined ? undefined : JSON.stringify(body);
        const req = httpRequest(
          `http://127.0.0.1:${port}${route}`,
          {
            method,
            headers: {
              Host: "workbench.example.test",
              "X-Workbench-Proxy-Token": proxyToken,
              ...(payload === undefined
                ? {}
                : {
                    "Content-Type": "application/json",
                    "Content-Length": Buffer.byteLength(payload),
                  }),
              ...headers,
            },
          },
          (res) => {
            const chunks: Buffer[] = [];
            res.on("data", (chunk) => chunks.push(chunk));
            res.on("end", () =>
              resolve(
                new Response(Buffer.concat(chunks), {
                  status: res.statusCode || 500,
                }),
              ),
            );
            res.on("error", reject);
          },
        );
        req.on("error", reject);
        req.end(payload);
      });
    try {
      child = spawn(
        process.execPath,
        ["--import", "tsx", "--import", guard, "server/index.ts"],
        {
          cwd: path.resolve(new URL("..", import.meta.url).pathname),
          env: {
            PATH: process.env.PATH,
            HOME: directory,
            PORT: String(port),
            WORKBENCH_DATA_DIR: data,
            WORKBENCH_SECRETS_FILE: path.join(directory, "absent-secrets"),
            WORKBENCH_PUBLIC_ORIGIN: origin,
            WORKBENCH_PROXY_TOKEN: proxyToken,
          },
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      child.stdout!.on("data", (value) => {
        logs += value;
      });
      child.stderr!.on("data", (value) => {
        logs += value;
      });
      for (
        let attempt = 0;
        attempt < 100 && !logs.includes("Agent Workbench:");
        attempt++
      ) {
        if (child.exitCode !== null) throw new Error(logs);
        await pause(30);
      }
      assert.match(logs, /Agent Workbench:/);
      await t.test(
        "proxy token is mandatory for health, assets and application data",
        async () => {
          for (const route of ["/", "/api/health", "/api/bootstrap"])
            assert.equal(
              (
                await api(route, "GET", undefined, {
                  "X-Workbench-Proxy-Token": "",
                })
              ).status,
              403,
            );
          assert.equal(
            (
              await api("/api/health", "GET", undefined, {
                "X-Workbench-Proxy-Token": "wrong",
              })
            ).status,
            403,
          );
          assert.equal((await api("/api/health")).status, 200);
        },
      );
      await t.test(
        "spoofed hosts, forwarded hosts and foreign origins are rejected",
        async () => {
          for (const headers of [
            { Host: "attacker.example" },
            { Host: `127.0.0.1:${port}` },
            {
              Host: "attacker.example",
              "X-Forwarded-Host": "workbench.example.test",
            },
            { Origin: "https://attacker.example" },
            { Origin: "null" },
            { Origin: "http://workbench.example.test" },
            { "Sec-Fetch-Site": "cross-site" },
          ] as Record<string, string>[])
            assert.equal(
              (await api("/api/bootstrap", "GET", undefined, headers)).status,
              403,
              JSON.stringify(headers),
            );
          assert.equal(
            (await api("/api/bootstrap", "GET", undefined, { Origin: origin }))
              .status,
            200,
          );
        },
      );
      await t.test(
        "host filesystem and secret-file imports are unavailable before any read",
        async () => {
          const bootstrap = await (await api("/api/bootstrap")).json();
          assert.equal(bootstrap.system.localSecretsAvailable, false);
          assert.deepEqual(bootstrap.system.hosting, {
            mode: "hosted",
            publicOrigin: origin,
            localSource: false,
          });
          assert.ok(!JSON.stringify(bootstrap).includes(proxyToken));
          assert.equal(bootstrap.projects[0].repo.adapter, "learning-studio");
          assert.equal(bootstrap.projects[0].repo.executionAvailable, false);
          assert.equal(
            (await (await api("/api/repos/default")).json()).path,
            "",
          );
          assert.equal(
            (
              await api("/api/credentials/import", "POST", {
                provider: "gemini",
              })
            ).status,
            403,
          );
          assert.equal(
            (await api("/api/repos/connect", "POST", { path: "/etc" })).status,
            403,
          );
          const preflight = await (
            await api("/api/preflight", "POST", {
              projectId: "linux-project",
              input: "test",
              config: { credentialId: "", model: "" },
            })
          ).json();
          assert.ok(
            preflight.issues.some(
              (issue: any) =>
                issue.code === "adapter_missing" && /macOS/.test(issue.message),
            ),
          );
          assert.equal(
            (
              await api("/api/redteam/plan", "POST", {
                projectId: "linux-project",
                scope: "local-test",
                mode: "behavioral",
                brandRules: "Stay grounded",
              })
            ).status,
            400,
          );
        },
      );
      await t.test(
        "authenticated folder uploads remain available",
        async () => {
          const response = await api("/api/repos/upload", "POST", {
            name: "Hosted upload fixture",
            mapping: "static",
            files: [
              {
                path: "app.py",
                content: "def reply(text):\n    return text\n",
              },
            ],
          });
          assert.equal(response.status, 200);
          const imported = await response.json();
          assert.equal(imported.repo.sourceKind, "upload");
          assert.equal(imported.repo.executionAvailable, false);
        },
      );
      await t.test(
        "public receiver URLs still require per-project bearer tokens",
        async () => {
          const created = await api("/api/projects", "POST", {
            name: "Hosted telemetry fixture",
          });
          assert.equal(created.status, 200);
          const project = await created.json();
          const token = await (
            await api(`/api/projects/${project.id}/telemetry/token`, "POST", {})
          ).json();
          assert.equal(
            token.endpoint,
            `${origin}/api/telemetry/${project.id}/spans`,
          );
          assert.ok(token.snippet.includes(token.endpoint));
          const route = `/api/telemetry/${project.id}/spans`;
          const body = {
            traceId: "hosted-trace",
            status: "completed",
            spans: [
              {
                id: "span-1",
                name: "Synthetic observed operation",
                status: "completed",
                startTime: date,
                endTime: date,
                output: "Fixture",
              },
            ],
          };
          assert.equal((await api(route, "POST", body)).status, 401);
          // Authentication precedes the 2MB JSON parser, even for a large body.
          assert.equal(
            (await api(route, "POST", { payload: "x".repeat(2_100_000) }))
              .status,
            401,
          );
          assert.equal(
            (await api(route, "POST", body, { Authorization: "Bearer wrong" }))
              .status,
            401,
          );
          const result = await api(route, "POST", body, {
            Authorization: `Bearer ${token.token}`,
          });
          assert.equal(result.status, 200);
          assert.equal((await result.json()).status, "completed");
          assert.equal(
            (
              await api(route, "POST", body, {
                Authorization: `Bearer ${token.token}`,
                "X-Workbench-Proxy-Token": "",
              })
            ).status,
            403,
          );
        },
      );
      assert.ok(!logs.includes(proxyToken));
    } finally {
      if (child && child.exitCode === null && child.signalCode === null) {
        const closed = new Promise<void>((resolve) =>
          child!.once("close", () => resolve()),
        );
        child.kill("SIGTERM");
        await closed;
      }
      await rm(directory, { recursive: true, force: true });
    }
  },
);
