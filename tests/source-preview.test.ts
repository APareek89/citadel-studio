import test from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  writeFile,
  rm,
  realpath,
  symlink,
} from "node:fs/promises";
import { createServer } from "node:net";
import { createServer as createHttpServer } from "node:http";
import { once } from "node:events";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const workspace = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function unusedPort() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const port = address.port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

test(
  "source preview HTTP API enforces inventory, source boundaries, redaction and bounded line windows",
  { timeout: 20000 },
  async (t) => {
    const directory = await mkdtemp(
      path.join(tmpdir(), "workbench-source-preview-test-"),
    );
    const data = path.join(directory, "state");
    const source = path.join(directory, "source");
    await mkdir(data);
    await mkdir(path.join(source, "src"), { recursive: true });
    const root = await realpath(source);
    const secret = "fixture-literal-access-token-123456789";
    const lines = Array.from(
      { length: 500 },
      (_, index) => `// source line ${index + 1}`,
    );
    lines[249] = `const accessToken = "${secret}";`;
    await writeFile(path.join(source, "src/main.ts"), lines.join("\n"));
    await writeFile(
      path.join(source, "src/small.ts"),
      "export const result = 42;\n",
    );
    await writeFile(path.join(source, "src/long.ts"), "a".repeat(50000));
    await writeFile(
      path.join(source, "src/unlisted.ts"),
      "UNLISTED_PRIVATE_FIXTURE",
    );
    await writeFile(path.join(source, ".env"), "NEVER_READ_ENV_FIXTURE");
    await writeFile(path.join(directory, "outside.ts"), "OUTSIDE_ROOT_FIXTURE");
    await symlink(
      path.join(directory, "outside.ts"),
      path.join(source, "src/link.ts"),
    );
    const date = new Date().toISOString();
    const graph = {
      id: "source-graph",
      revision: 1,
      name: "Source",
      description: "Fixture",
      nodes: [],
      edges: [],
      limits: {
        maxCalls: 1,
        maxRevisions: 0,
        timeoutMs: 10000,
        maxOutputTokens: 128,
      },
    };
    const project = {
      id: "source-project",
      name: "Source fixture",
      brief: "",
      graph,
      createdAt: date,
      updatedAt: date,
      repo: {
        name: "Source fixture",
        path: root,
        revision: "fixture",
        adapter: "discovery-only",
        coverage: [],
        limitations: [],
        // Malicious/obsolete persisted paths test readSource's independent boundary checks.
        sources: [
          "src/main.ts",
          "src/small.ts",
          "src/long.ts",
          "src/link.ts",
          "../outside.ts",
          ".env",
        ].map((value) => ({ path: value, category: "Fixture" })),
      },
    };
    await writeFile(
      path.join(data, "workspace.json"),
      JSON.stringify({
        projects: [
          project,
          { ...project, id: "unconnected-project", repo: undefined },
        ],
        runs: [],
        comparisons: [],
        suites: [],
        reports: [],
        redPlans: [],
      }),
    );
    const guard = path.join(directory, "no-provider-network.mjs");
    await writeFile(
      guard,
      `import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
const readdir = fs.promises.readdir;
fs.promises.readdir = async function (directory, ...args) {
  if (fs.existsSync(String(directory) + '/.delay-source-discovery'))
    await new Promise(resolve => setTimeout(resolve, 200));
  return readdir.call(this, directory, ...args);
};
syncBuiltinESMExports();
globalThis.fetch = async () => { throw new Error('Provider network is disabled in source preview tests'); };
`,
    );
    const port = await unusedPort(),
      base = `http://127.0.0.1:${port}`;
    let child: ChildProcess | undefined;
    let logs = "";
    const request = (
      file: string,
      line?: number | string,
      projectId = project.id,
    ) => {
      const query = new URLSearchParams({ path: file });
      if (line !== undefined) query.set("line", String(line));
      return fetch(`${base}/api/projects/${projectId}/source?${query}`);
    };
    try {
      child = spawn(
        process.execPath,
        ["--import", "tsx", "--import", guard, "server/index.ts"],
        {
          cwd: workspace,
          env: {
            PATH: process.env.PATH,
            TMPDIR: process.env.TMPDIR,
            PORT: String(port),
            WORKBENCH_DATA_DIR: data,
            WORKBENCH_SECRETS_FILE: path.join(directory, "absent-secrets"),
            WORKBENCH_DEV: "0",
            WORKBENCH_SPEND_LIMIT_USD: "0",
          },
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      child.stdout!.on("data", (chunk) => {
        logs = (logs + String(chunk)).slice(-5000);
      });
      child.stderr!.on("data", (chunk) => {
        logs = (logs + String(chunk)).slice(-5000);
      });
      let ready = false;
      for (let attempt = 0; attempt < 70; attempt++) {
        if (child.exitCode !== null || child.signalCode !== null)
          throw new Error(`Source preview test server exited: ${logs}`);
        if (logs.includes("Agent Workbench:")) {
          const health = await fetch(base + "/api/health");
          if (health.ok) {
            ready = true;
            break;
          }
        }
        await delay(75);
      }
      assert.ok(ready, `Source preview test server did not start: ${logs}`);

      await t.test(
        "selected source line is returned with accurate line numbers and literal credentials redacted",
        async () => {
          const response = await request("src/main.ts", 250);
          assert.equal(response.status, 200);
          assert.equal(response.headers.get("cache-control"), "no-store");
          const result = await response.json();
          assert.equal(result.path, "src/main.ts");
          assert.equal(result.startLine, 230);
          assert.equal(result.truncated, true);
          const excerpt = result.content.split("\n");
          assert.equal(excerpt.length, 201);
          assert.equal(excerpt[0], "// source line 230");
          assert.equal(excerpt.at(-1), "// source line 430");
          assert.match(excerpt[20], /accessToken.*REDACTED/);
          assert.ok(!result.content.includes(secret));
        },
      );

      await t.test(
        "small files are complete; distant line requests clamp and long content stays within 40,000 characters",
        async () => {
          const small = await (await request("src/small.ts")).json();
          assert.deepEqual(small, {
            path: "src/small.ts",
            content: "export const result = 42;\n",
            startLine: 1,
            truncated: false,
          });
          const clamped = await (await request("src/main.ts", 99999)).json();
          assert.equal(clamped.startLine, 480);
          assert.equal(
            clamped.content.split("\n").at(-1),
            "// source line 500",
          );
          const long = await (await request("src/long.ts")).json();
          assert.equal(long.content.length, 40000);
          assert.equal(long.truncated, true);
        },
      );

      await t.test(
        "files outside the project inventory are denied without reading their contents",
        async () => {
          for (const file of [
            "src/unlisted.ts",
            "not-found.ts",
            "/etc/passwd",
            "src/../../outside.ts",
          ]) {
            const response = await request(file);
            assert.equal(response.status, 404, file);
            const body = await response.text();
            assert.match(body, /inventory/);
            assert.doesNotMatch(
              body,
              /UNLISTED_PRIVATE_FIXTURE|OUTSIDE_ROOT_FIXTURE/,
            );
          }
        },
      );

      await t.test(
        "even an inventory entry cannot authorize traversal, symlinks or sensitive source",
        async () => {
          for (const file of ["../outside.ts", "src/link.ts", ".env"]) {
            const response = await request(file);
            assert.ok(
              response.status >= 400 && response.status < 500,
              `${file}: ${response.status}`,
            );
            const body = await response.text();
            assert.doesNotMatch(
              body,
              /OUTSIDE_ROOT_FIXTURE|NEVER_READ_ENV_FIXTURE/,
            );
          }
        },
      );

      await t.test(
        "invalid line numbers and projects without source are rejected",
        async () => {
          for (const line of [0, -1, 1.5, "invalid"]) {
            const response = await request("src/main.ts", line);
            assert.equal(response.status, 422);
          }
          const response = await request(
            "src/main.ts",
            1,
            "unconnected-project",
          );
          assert.equal(response.status, 400);
          assert.match(await response.text(), /Connect source first/);
        },
      );

      const api = (url: string, body?: unknown, token?: string) =>
        fetch(base + url, {
          method: body === undefined ? "GET" : "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
      const replacement = path.join(directory, "replacement-source");
      await mkdir(replacement);
      await writeFile(
        path.join(replacement, "workflow.ts"),
        "export async function workflow() { return 'replacement'; }\n",
      );
      const replacementRoot = await realpath(replacement);

      await t.test(
        "same-source reconnect preserves tracing; replacing the repository revokes native and Langfuse connections",
        async () => {
          const remote = createHttpServer((req, res) => {
            assert.equal(req.url, "/api/public/projects");
            res
              .writeHead(200, { "Content-Type": "application/json" })
              .end(
                JSON.stringify({
                  data: [{ id: "fixture-remote", name: "Fixture app" }],
                }),
              );
          });
          remote.listen(0, "127.0.0.1");
          await once(remote, "listening");
          const address = remote.address();
          assert.ok(address && typeof address !== "string");
          try {
            const receiver = await (
              await api(`/api/projects/${project.id}/telemetry/token`, {})
            ).json();
            assert.equal(typeof receiver.token, "string");
            const connected = await api(
              `/api/projects/${project.id}/langfuse`,
              {
                url: `http://127.0.0.1:${address.port}`,
                publicKey: "pk-lf-synthetic-fixture-123456",
                secretKey: "sk-lf-synthetic-fixture-123456",
              },
            );
            assert.equal(connected.status, 200);

            const same = await api("/api/repos/connect", {
              path: root,
              projectId: project.id,
              mapping: "static",
            });
            assert.equal(same.status, 200);
            const sameProject = await same.json();
            assert.equal(sameProject.graph.id, graph.id);
            assert.equal(sameProject.graph.revision, 2);
            const before = await (
              await api(`/api/projects/${project.id}/connections`)
            ).json();
            assert.equal(before.native.enabled, true);
            assert.equal(before.langfuse.connected, true);

            const changed = await api("/api/repos/connect", {
              path: replacementRoot,
              projectId: project.id,
              mapping: "static",
            });
            assert.equal(changed.status, 200);
            const changedProject = await changed.json();
            assert.equal(changedProject.repo.path, replacementRoot);
            assert.equal(changedProject.graph.id, graph.id);
            assert.equal(changedProject.graph.revision, 3);
            const after = await (
              await api(`/api/projects/${project.id}/connections`)
            ).json();
            assert.equal(after.native.enabled, false);
            assert.equal(after.langfuse.connected, false);
            const staleTrace = await api(
              `/api/telemetry/${project.id}/spans`,
              { traceId: "old-app", spans: [] },
              receiver.token,
            );
            assert.equal(staleTrace.status, 401);
            const staleSync = await api(
              `/api/projects/${project.id}/langfuse/sync`,
              { hours: 1 },
            );
            assert.equal(staleSync.status, 400);
            assert.match(await staleSync.text(), /Connect Langfuse/);
          } finally {
            remote.closeAllConnections();
            await new Promise<void>((resolve) => remote.close(() => resolve()));
          }
        },
      );

      await t.test(
        "concurrent remaps reject a stale completion and increment the graph only once",
        async () => {
          // The preload delays this directory's discovery so both requests capture the same revision.
          await writeFile(
            path.join(replacement, ".delay-source-discovery"),
            "fixture barrier",
          );
          const results = await Promise.all([
            api(`/api/projects/${project.id}/remap`, { mapping: "static" }),
            api(`/api/projects/${project.id}/remap`, { mapping: "static" }),
          ]);
          assert.deepEqual(
            results.map((result) => result.status).sort(),
            [200, 409],
          );
          const succeeded = await results
            .find((result) => result.status === 200)!
            .json();
          assert.equal(succeeded.graph.revision, 4);
          const rejected = await results
            .find((result) => result.status === 409)!
            .json();
          assert.match(rejected.error, /newer connection was retained/);
          const workspace = await (await api("/api/bootstrap")).json();
          const saved = workspace.projects.find(
            (item: { id: string }) => item.id === project.id,
          );
          assert.equal(saved.repo.path, replacementRoot);
          assert.equal(saved.graph.revision, 4);
        },
      );
    } finally {
      if (child && child.exitCode === null && child.signalCode === null) {
        child.kill("SIGTERM");
        await Promise.race([once(child, "exit"), delay(4500)]);
        if (child.exitCode === null && child.signalCode === null) {
          child.kill("SIGKILL");
          await once(child, "exit");
        }
      }
      await rm(directory, { recursive: true, force: true });
    }
  },
);
