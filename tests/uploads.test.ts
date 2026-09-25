import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  access,
  symlink,
  realpath,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { importUploadedFolder, type FolderUpload } from "../server/uploads.js";
async function fixture(run: (root: string, data: string) => Promise<void>) {
  const root = await mkdtemp(path.join(tmpdir(), "citadel-upload-test-"));
  const before = process.env.WORKBENCH_DATA_DIR;
  const data = path.join(root, "data");
  process.env.WORKBENCH_DATA_DIR = data;
  try {
    await run(root, data);
  } finally {
    if (before === undefined) delete process.env.WORKBENCH_DATA_DIR;
    else process.env.WORKBENCH_DATA_DIR = before;
    await rm(root, { recursive: true, force: true });
  }
}
const entry = (file: string, content = "export const answer=42;") => ({
  path: file,
  content,
});

test("folder import stores private text files, strips the selected root, and reports excluded resources", async () =>
  fixture(async (root, data) => {
    const result = await importUploadedFolder({
      name: "Sample app",
      files: [
        entry(
          "Sample app/package.json",
          '{"name":"sample","scripts":{"postinstall":"touch NEVER_EXECUTE"}}',
        ),
        entry("Sample app/src/main.ts"),
        entry("Sample app/README.md", "# Sample"),
        entry("Sample app/.env", "DO_NOT_IMPORT=value"),
        entry("Sample app/.git/config", "do not import"),
        entry("Sample app/node_modules/lib.js"),
        entry("Sample app/dist/app.js"),
        entry("Sample app/private-credentials.json", '{"value":"synthetic"}'),
        entry("Sample app/logo.png", "text pretending to be PNG"),
        entry("Sample app/binary.ts", "source\x00binary"),
      ],
    });
    assert.equal(result.name, "Sample app");
    assert.equal(result.acceptedFiles, 3);
    assert.equal(result.skippedFiles, 7);
    assert.equal(result.skipped.length, 7);
    assert.ok(
      result.rootPath.startsWith(
        path.join(await realpath(data), "uploads") + path.sep,
      ),
    );
    assert.equal(
      await readFile(path.join(result.rootPath, "src/main.ts"), "utf8"),
      "export const answer=42;",
    );
    assert.equal((await stat(result.rootPath)).mode & 0o777, 0o700);
    assert.equal(
      (await stat(path.join(result.rootPath, "src"))).mode & 0o777,
      0o700,
    );
    assert.equal(
      (await stat(path.join(result.rootPath, "src/main.ts"))).mode & 0o777,
      0o600,
    );
    for (const missing of [
      ".env",
      ".git",
      "node_modules",
      "dist",
      "private-credentials.json",
      "logo.png",
      "binary.ts",
      "NEVER_EXECUTE",
    ])
      await assert.rejects(access(path.join(result.rootPath, missing)));
    assert.ok(
      (await readdir(path.join(data, "uploads"))).every(
        (name) => !name.startsWith(".incoming-"),
      ),
    );
    const expected =
      Buffer.byteLength("export const answer=42;") +
      Buffer.byteLength("# Sample") +
      Buffer.byteLength(
        '{"name":"sample","scripts":{"postinstall":"touch NEVER_EXECUTE"}}',
      );
    assert.equal(result.totalBytes, expected);
  }));

test("all unsafe paths are rejected before creating upload storage", async () =>
  fixture(async (_root, data) => {
    for (const bad of [
      "../outside.ts",
      "src/../../outside.ts",
      "/outside.ts",
      "C:/outside.ts",
      "C:\\outside.ts",
      "\\\\host\\share\\file.ts",
      "a//b.ts",
      "a/./b.ts",
      "a/../b.ts",
      "a/%2e%2e/file.ts",
      "src/evil\n.ts",
      "src/file.ts ",
      "src/file.ts.",
      "CON.ts",
      "src/LPT1",
      "src/COM¹.txt",
      "a".repeat(256) + ".ts",
      "cafe\u0301.ts",
    ]) {
      await assert.rejects(
        importUploadedFolder({
          name: "app",
          files: [entry("valid.ts"), entry(bad)],
        }),
        /path/,
      );
      await assert.rejects(access(data));
    }
  }));

test("duplicates, normalization/case collisions and file-directory collisions fail atomically", async () =>
  fixture(async (_root, data) => {
    for (const files of [
      [entry("a.ts"), entry("a.ts")],
      [entry("Src/a.ts"), entry("src/A.ts")],
      [entry("src"), entry("src/a.ts")],
      [entry("A"), entry("a/b.ts")],
    ]) {
      await assert.rejects(
        importUploadedFolder({ name: "app", files }),
        /duplicate|collid|collision/,
      );
      await assert.rejects(access(data));
    }
  }));

test("file count and UTF-8 budgets include excluded files and fail before writes", async () =>
  fixture(async (_root, data) => {
    const cases: FolderUpload[] = [
      {
        name: "app",
        files: Array.from({ length: 501 }, (_, i) => entry(`file${i}.ts`)),
      },
      {
        name: "app",
        files: [entry("valid.ts"), entry(".env", "x".repeat(900001))],
      },
      {
        name: "app",
        files: [entry("valid.ts"), entry("large.ts", "é".repeat(450001))],
      },
      {
        name: "app",
        files: Array.from({ length: 12 }, (_, i) =>
          entry(`file${i}.ts`, "x".repeat(900000)),
        ),
      },
    ];
    for (const value of cases) {
      await assert.rejects(importUploadedFolder(value), /1–500|900,000|10 MiB/);
      await assert.rejects(access(data));
    }
  }));

test("link descriptors and uploads without supported source cannot create a folder", async () =>
  fixture(async (_root, data) => {
    await assert.rejects(
      importUploadedFolder({
        name: "app",
        files: [{ ...entry("link.ts"), symlink: "../outside" } as any],
      }),
      /links/,
    );
    await assert.rejects(
      importUploadedFolder({
        name: "app",
        files: [entry(".env"), entry("file.png")],
      }),
      /No supported/,
    );
    await assert.rejects(
      importUploadedFolder({ name: ".git", files: [entry(".git/config.ts")] }),
      /No supported/,
    );
    await assert.rejects(access(data));
  }));

test("upload storage symlinks fail closed without changing external directories", async () =>
  fixture(async (root, data) => {
    const external = path.join(root, "external");
    await mkdir(external, { mode: 0o700 });
    await mkdir(data, { mode: 0o700 });
    await symlink(external, path.join(data, "uploads"));
    await assert.rejects(
      importUploadedFolder({ name: "app", files: [entry("source.ts")] }),
      /real directory/,
    );
    assert.deepEqual(await readdir(external), []);
    await rm(path.join(data, "uploads"));
    await rm(data, { recursive: true });
    await symlink(external, data);
    await assert.rejects(
      importUploadedFolder({ name: "app", files: [entry("source.ts")] }),
      /real directory/,
    );
    assert.deepEqual(await readdir(external), []);
  }));

test("concurrent imports publish independent complete folders", async () =>
  fixture(async (_root, data) => {
    const input = {
      name: "app",
      files: [entry("package.json", "{}"), entry("src/main.ts")],
    };
    const results = await Promise.all([
      importUploadedFolder(input),
      importUploadedFolder(input),
    ]);
    assert.notEqual(results[0].rootPath, results[1].rootPath);
    for (const result of results)
      assert.equal(
        await readFile(path.join(result.rootPath, "src/main.ts"), "utf8"),
        "export const answer=42;",
      );
    assert.equal((await readdir(path.join(data, "uploads"))).length, 2);
  }));
