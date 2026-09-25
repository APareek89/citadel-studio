import { cp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";

const execute = promisify(execFile);
const output = path.resolve("output");
const stage = path.join(output, "agent-workbench-release");
const archive = path.join(output, "agent-workbench-release.tar.gz");
const included = [
  "package.json",
  "package-lock.json",
  "build-server/index.mjs",
  "dist",
  "sdk/workbench-client.mjs",
  "sdk/workbench-client.py",
  // These exact originals are read when a built application is exported.
  "server/runtime.ts",
  "server/graph.ts",
  "server/sandbox.ts",
  "server/pricing.ts",
  "shared/types.ts",
  "deployment",
  "docs/DEPLOYMENT.md",
];
for (const file of included) await stat(file);
await mkdir(output, { recursive: true });
await rm(stage, { recursive: true, force: true });
await mkdir(stage, { recursive: true });
for (const file of included) {
  const destination = path.join(stage, file);
  await mkdir(path.dirname(destination), { recursive: true });
  await cp(file, destination, {
    recursive: true,
    dereference: false,
    filter: async (source) => {
      const { lstat } = await import("node:fs/promises");
      if ((await lstat(source)).isSymbolicLink())
        throw new Error(
          `Release allowlist cannot contain a symbolic link: ${source}`,
        );
      return true;
    },
  });
}
const sourceCommit = (
  await execute("git", ["rev-parse", "HEAD"])
).stdout.trim();
const sourceDirty =
  (await execute("git", ["status", "--porcelain"])).stdout.trim().length > 0;
const packageFile = JSON.parse(await readFile("package.json", "utf8"));
await writeFile(
  path.join(stage, "release.json"),
  JSON.stringify(
    {
      name: packageFile.name,
      version: packageFile.version,
      createdAt: new Date().toISOString(),
      sourceCommit,
      sourceDirty,
      included,
    },
    null,
    2,
  ) + "\n",
);
await execute("tar", ["--no-xattrs", "-czf", archive, "-C", stage, "."], {
  env: { ...process.env, COPYFILE_DISABLE: "1" },
});
console.log(`Release prepared: ${archive}`);
console.log(
  "No local state, repository checkouts, model keys or AWS credentials are included.",
);
