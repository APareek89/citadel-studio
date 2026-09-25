import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, symlink, rm } from "node:fs/promises";
import { createServer, request } from "node:http";
import { connect } from "node:net";
import { spawn, type ChildProcess } from "node:child_process";
import { PassThrough } from "node:stream";
import { inflateRawSync } from "node:zlib";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Response } from "express";
import type { Project } from "../shared/types.js";

function zipMembers(buffer: Buffer) {
  let end = buffer.length - 22;
  while (end >= 0 && buffer.readUInt32LE(end) !== 0x06054b50) end--;
  assert.ok(end >= 0, "Export must be a ZIP archive");
  const files = new Map<string, string>();
  let offset = buffer.readUInt32LE(end + 16);
  for (let index = 0; index < buffer.readUInt16LE(end + 10); index++) {
    assert.equal(buffer.readUInt32LE(offset), 0x02014b50);
    const method = buffer.readUInt16LE(offset + 10);
    const size = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const local = buffer.readUInt32LE(offset + 42);
    const name = buffer
      .subarray(offset + 46, offset + 46 + nameLength)
      .toString();
    const start =
      local +
      30 +
      buffer.readUInt16LE(local + 26) +
      buffer.readUInt16LE(local + 28);
    const compressed = buffer.subarray(start, start + size);
    files.set(
      name,
      (method === 8 ? inflateRawSync(compressed) : compressed).toString(),
    );
    offset +=
      46 +
      nameLength +
      buffer.readUInt16LE(offset + 30) +
      buffer.readUInt16LE(offset + 32);
  }
  return files;
}

async function unusedPort() {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return address.port;
}

test(
  "exported browser server preserves local boundaries and survives interrupted request bodies",
  { timeout: 15000 },
  async (t) => {
    const directory = await mkdtemp(
      path.join(tmpdir(), "citadel-export-http-tests-"),
    );
    process.env.WORKBENCH_DATA_DIR = path.join(directory, "data");
    process.env.WORKBENCH_SECRETS_FILE = path.join(directory, "absent-secrets");
    const { exportProject } = await import("../server/export.js");
    const { defaultGraph } = await import("../server/graph.js");
    const project: Project = {
      id: "export-http-fixture",
      name: "Export HTTP fixture",
      brief: "Test",
      graph: defaultGraph(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const stream = new PassThrough();
    const buffers: Buffer[] = [];
    stream.on("data", (chunk) => buffers.push(chunk));
    const ended = new Promise<void>((resolve, reject) => {
      stream.on("end", resolve);
      stream.on("error", reject);
    });
    Object.assign(stream, { attachment: () => stream });
    let child: ChildProcess | undefined;
    try {
      await exportProject(project, stream as unknown as Response);
      await ended;
      const members = zipMembers(Buffer.concat(buffers));
      const port = await unusedPort();
      for (const [name, content] of members) {
        assert.ok(!path.isAbsolute(name) && !name.split("/").includes(".."));
        const target = path.join(directory, name);
        await mkdir(path.dirname(target), { recursive: true });
        // Only the listen port and its Host/Origin allowlist change for isolation.
        // The exported browser's request handling runs exactly as shipped.
        await writeFile(
          target,
          name === "serve.ts"
            ? content
                .replaceAll(":8080", `:${port}`)
                .replace(".listen(8080,", `.listen(${port},`)
            : content,
        );
      }
      await symlink(
        path.resolve("node_modules"),
        path.join(directory, "node_modules"),
        "dir",
      );
      const guard = path.join(directory, "no-network.mjs");
      await writeFile(
        guard,
        "globalThis.fetch=async()=>{throw new Error('Provider network disabled in export HTTP test')};\n",
      );
      child = spawn(process.execPath, ["--import", "tsx", "serve.ts"], {
        cwd: directory,
        env: {
          PATH: process.env.PATH,
          HOME: directory,
          NODE_OPTIONS: `--import=${guard}`,
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stderr = "";
      child.stderr!.on("data", (chunk) => {
        stderr = (stderr + chunk).slice(-4000);
      });
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error("Export server startup timed out: " + stderr)),
          5000,
        );
        child!.stdout!.on("data", (chunk) => {
          if (String(chunk).includes("Agent app:")) {
            clearTimeout(timer);
            resolve();
          }
        });
        child!.once("error", (error) => {
          clearTimeout(timer);
          reject(error);
        });
        child!.once("exit", (code) => {
          clearTimeout(timer);
          reject(new Error(`Export server exited ${code}: ${stderr}`));
        });
      });
      const base = `http://127.0.0.1:${port}`;
      const post = (body: unknown) =>
        fetch(base + "/run", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });

      await t.test(
        "page and package are usable without exposing server files",
        async () => {
          const page = await fetch(base);
          assert.equal(page.status, 200);
          assert.equal(page.headers.get("x-content-type-options"), "nosniff");
          assert.match(await page.text(), /Your agent app/);
          for (const pathname of [
            "/.env",
            "/app.ts",
            "/serve.ts",
            "/graph.json",
            "/trace.json",
            "/server/runtime.ts",
          ]) {
            const response = await fetch(base + pathname);
            assert.equal(response.status, 404);
            assert.equal(await response.text(), "");
          }
          const packageJson = JSON.parse(members.get("package.json")!);
          assert.equal(packageJson.scripts.serve, "tsx serve.ts");
          assert.deepEqual(Object.keys(packageJson.dependencies).sort(), [
            "ajv",
            "tsx",
            "zod",
          ]);
          assert.ok(!members.has(".env") && !members.has("trace.json"));
          assert.ok(
            ![...members.values()].some((text) =>
              /AIza[\w-]{25,}|sk-(?:ant-)?[\w-]{18,}|\/Users\/macbook/.test(
                text,
              ),
            ),
          );
        },
      );
      await t.test(
        "foreign Origin and Host cannot invoke the app",
        async () => {
          assert.equal(
            (
              await fetch(base + "/run", {
                method: "POST",
                headers: {
                  Origin: "https://attacker.example",
                  "Content-Type": "application/json",
                },
                body: '{"input":"hello"}',
              })
            ).status,
            403,
          );
          const status = await new Promise<number | undefined>(
            (resolve, reject) => {
              const req = request(
                base,
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
          assert.equal(status, 403);
          assert.equal(
            (
              await fetch(base + "/run", {
                method: "POST",
                headers: { "Content-Type": "text/plain" },
                body: "hello",
              })
            ).status,
            404,
          );
        },
      );
      await t.test(
        "invalid and oversized inputs stop before a provider call",
        async () => {
          for (const input of [
            "",
            "   ",
            null,
            42,
            {},
            [],
            "a".repeat(40001),
          ]) {
            const response = await post({ input });
            assert.equal(response.status, 400);
            assert.match((await response.json()).error, /Add a text input/);
          }
          assert.equal((await post({ input: "a".repeat(51000) })).status, 413);
          assert.equal(
            (
              await fetch(base + "/run", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: "{",
              })
            ).status,
            400,
          );
          const missingCredential = await post({ input: "Valid input" });
          assert.equal(missingCredential.status, 400);
          assert.match(
            (await missingCredential.json()).error,
            /Workflow did not complete/,
          );
        },
      );
      await t.test(
        "disconnecting during upload does not crash the server",
        async () => {
          await new Promise<void>((resolve, reject) => {
            const socket = connect(port, "127.0.0.1", () => {
              socket.write(
                `POST /run HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nContent-Type: application/json\r\nContent-Length: 30000\r\n\r\n{"input":"unfinished`,
                () => {
                  setTimeout(() => {
                    socket.destroy();
                    resolve();
                  }, 30);
                },
              );
            });
            socket.once("error", reject);
          });
          await new Promise((resolve) => setTimeout(resolve, 50));
          assert.equal(
            child!.exitCode,
            null,
            `Export server crashed: ${stderr}`,
          );
          assert.equal((await fetch(base)).status, 200);
          assert.equal((await post({ input: "" })).status, 400);
        },
      );
    } finally {
      if (child && child.exitCode === null) {
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
