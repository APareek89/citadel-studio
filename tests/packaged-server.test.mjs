import test from "node:test";
import assert from "node:assert/strict";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { homedir, tmpdir } from "node:os";
import path from "node:path";

const execute = promisify(execFile);
const root = process.cwd();
const archive = path.join(root, "output/agent-workbench-release.tar.gz");
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
test(
  "packaged production release boots without development dependencies or provider access",
  { timeout: 90000 },
  async () => {
    await access(archive);
    const scratch = await mkdtemp(path.join(tmpdir(), "workbench-packaged-"));
    let child;
    try {
      await execute("tar", ["-xzf", archive, "-C", scratch]);
      await execute(
        "npm",
        [
          "ci",
          "--omit=dev",
          "--offline",
          "--ignore-scripts",
          "--no-audit",
          "--no-fund",
        ],
        {
          cwd: scratch,
          env: {
            PORTFOLIO_AUTH_ENABLED: "0",
            PATH: process.env.PATH,
            HOME: scratch,
            npm_config_cache: path.join(homedir(), ".npm"),
          },
          timeout: 60000,
        },
      );
      for (const missing of [
        "node_modules/tsx",
        "node_modules/vite",
        ".local",
        ".git",
      ])
        await assert.rejects(
          access(path.join(scratch, missing)),
          `Release must not contain ${missing}`,
        );
      await access(path.join(scratch, "node_modules/typescript/package.json"));
      await access(path.join(scratch, "node_modules/esbuild/package.json"));
      const guard = path.join(scratch, "no-provider.mjs");
      await writeFile(
        guard,
        "globalThis.fetch=async()=>{throw new Error('Provider networking disabled in packaged release smoke test')};\n",
      );
      const socket = createServer();
      await new Promise((resolve) => socket.listen(0, "127.0.0.1", resolve));
      const port = socket.address().port;
      await new Promise((resolve) => socket.close(resolve));
      let logs = "";
      child = spawn(
        process.execPath,
        ["--import", guard, "build-server/index.mjs"],
        {
          cwd: scratch,
          env: {
            PORTFOLIO_AUTH_ENABLED: "0",
            PATH: process.env.PATH,
            HOME: scratch,
            PORT: String(port),
            NODE_ENV: "production",
            WORKBENCH_DATA_DIR: path.join(scratch, "state"),
            WORKBENCH_SECRETS_FILE: path.join(scratch, "absent-secrets"),
            WORKBENCH_DEV: "0",
          },
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      child.stdout.on("data", (chunk) => {
        logs += chunk;
      });
      child.stderr.on("data", (chunk) => {
        logs += chunk;
      });
      for (let i = 0; i < 100 && !logs.includes("Agent Workbench:"); i++) {
        if (child.exitCode !== null) throw new Error(logs);
        await delay(30);
      }
      assert.match(logs, /Agent Workbench:/);
      const api = async (url, body) =>
        fetch(
          `http://127.0.0.1:${port}${url}`,
          body
            ? {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify(body),
              }
            : undefined,
        );
      const health = await (await api("/api/health")).json();
      assert.equal(health.ok, true);
      assert.match(health.uiEntry, /^\/assets\/.+\.js$/);
      const bootstrap = await (await api("/api/bootstrap")).json();
      assert.deepEqual(bootstrap.projects, []);
      assert.deepEqual(bootstrap.credentials, []);
      const createdResponse = await api("/api/projects", {
        name: "Packaged smoke",
        brief: "Synthetic build only",
      });
      assert.equal(createdResponse.status, 200);
      const project = await createdResponse.json();
      const exported = await api(`/api/projects/${project.id}/export`);
      assert.equal(exported.status, 200);
      const bytes = Buffer.from(await exported.arrayBuffer());
      assert.equal(
        bytes.subarray(0, 2).toString(),
        "PK",
        "Code export reads its shipped source assets",
      );
      const uploadedResponse = await api("/api/repos/upload", {
        name: "Packaged mapper fixture",
        mapping: "static",
        files: [
          {
            path: "agent.ts",
            content:
              "export async function respond(input: string) { return model.generateContent(input); }\n",
          },
        ],
      });
      assert.equal(
        uploadedResponse.status,
        200,
        await uploadedResponse.clone().text(),
      );
      const mapped = await uploadedResponse.json();
      assert.ok(
        mapped.repo.sources.some((source) => source.path === "agent.ts"),
      );
      assert.equal(mapped.repo.adapter, "discovery-only");
      assert.equal((await api("/api/telemetry/client.mjs")).status, 200);
      const saved = await readFile(
        path.join(scratch, "state/workspace.json"),
        "utf8",
      );
      assert.ok(saved.includes(project.id));
      assert.doesNotMatch(logs, /Provider networking disabled/);
    } finally {
      if (child && child.exitCode === null) {
        child.kill("SIGTERM");
        await Promise.race([
          new Promise((resolve) => child.once("exit", resolve)),
          delay(5000),
        ]);
        if (child.exitCode === null) child.kill("SIGKILL");
      }
      await rm(scratch, { recursive: true, force: true });
    }
  },
);
