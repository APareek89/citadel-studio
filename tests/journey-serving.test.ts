import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

test(
  "production startup cannot silently turn into a development server when the build is missing",
  { timeout: 10000 },
  async () => {
    const root = process.cwd();
    const isolated = await mkdtemp(path.join(tmpdir(), "workbench-serving-"));
    try {
      const child = spawn(
        process.execPath,
        [
          "--import",
          pathToFileURL(path.join(root, "node_modules/tsx/dist/loader.mjs"))
            .href,
          path.join(root, "server/index.ts"),
        ],
        {
          cwd: isolated,
          env: {
            PORTFOLIO_AUTH_ENABLED: "0",
            PATH: process.env.PATH,
            HOME: isolated,
            PORT: "3928",
            WORKBENCH_DEV: "0",
            WORKBENCH_DATA_DIR: path.join(isolated, "data"),
            WORKBENCH_SECRETS_FILE: path.join(isolated, "absent"),
          },
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      let log = "";
      child.stdout.on("data", (chunk) => (log += chunk));
      child.stderr.on("data", (chunk) => (log += chunk));
      const timeout = setTimeout(() => child.kill("SIGKILL"), 7000);
      const code = await new Promise<number | null>((resolve, reject) => {
        child.once("error", reject);
        child.once("close", resolve);
      });
      clearTimeout(timeout);
      assert.equal(code, 1);
      assert.match(log, /app build is missing/);
      assert.doesNotMatch(log, /Agent Workbench:|VITE/);
    } finally {
      await rm(isolated, { recursive: true, force: true });
    }
  },
);
