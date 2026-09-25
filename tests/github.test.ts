import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  chmod,
  rm,
  access,
  readdir,
  symlink,
} from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import path from "node:path";
import { checkoutGithub, listGithubRepos } from "../server/github.js";
const exec = promisify(execFile);
const url = "https://github.com/APareek89/fixture-app";

test("GitHub URLs reject credentials, paths, escapes and shell syntax before IO", async () => {
  for (const invalid of [
    "http://github.com/u/r",
    "https://user:token@github.com/u/r",
    "https://github.com.evil/u/r",
    "https://github.com/u/r/tree/main",
    "https://github.com/u/r?token=x",
    "https://github.com/u/r#x",
    "https://github.com/u/..",
    "https://github.com/u/%2e%2e",
    "https://github.com/u/repo;touch-x",
    "https://github.com/u/repo$(echo-x)",
    "https://github.com/u/r/",
    "https://github.com/u/r\n",
    "git@github.com:u/r.git",
    "https://github.com/u/repo\\name",
  ]) {
    await assert.rejects(
      checkoutGithub(invalid),
      /HTTPS github.com|repository name/,
    );
  }
});

test("GitHub acquisition isolates Git config, lists authenticated metadata, reuses and preserves managed clones", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "workbench-github-test-"));
  const envBefore = { ...process.env };
  const cleanEnv = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
  );
  const gitPath = (await exec("/usr/bin/which", ["git"])).stdout.trim();
  const git = async (args: string[]) =>
    exec(gitPath, args, {
      env: {
        ...cleanEnv,
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_CONFIG_GLOBAL: "/dev/null",
      },
      maxBuffer: 1_000_000,
    });
  try {
    const fixture = path.join(root, "fixture");
    const bin = path.join(root, "bin");
    const log = path.join(root, "commands.jsonl");
    await mkdir(bin);
    await mkdir(fixture);
    await git(["init", "--initial-branch=main", fixture]);
    await writeFile(path.join(fixture, "payload.txt"), "source text");
    await writeFile(
      path.join(fixture, ".gitattributes"),
      "*.txt filter=smuggle\n",
    );
    await writeFile(
      path.join(fixture, "package.json"),
      JSON.stringify({
        name: "fixture",
        scripts: { postinstall: "touch NEVER_RUN" },
      }),
    );
    await git(["-C", fixture, "add", "."]);
    await git([
      "-C",
      fixture,
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "commit",
      "-m",
      "fixture",
    ]);
    const hooks = path.join(root, "hooks");
    await mkdir(hooks);
    await writeFile(
      path.join(hooks, "post-checkout"),
      '#!/bin/sh\ntouch "$HOOK_SENTINEL"\n',
      { mode: 0o700 },
    );
    const global = path.join(root, "global-git-config");
    await git(["config", "--file", global, "core.hooksPath", hooks]);
    await git([
      "config",
      "--file",
      global,
      "filter.smuggle.smudge",
      "sh -c 'touch \"$FILTER_SENTINEL\"; cat'",
    ]);
    const fixtureList = [
      {
        name: "fixture-app",
        url,
        isPrivate: true,
        description: "Private source fixture",
      },
    ];
    const wrapper = `#!${process.execPath}\nconst fs=require('node:fs'),cp=require('node:child_process');const args=process.argv.slice(2);fs.appendFileSync(process.env.FIXTURE_LOG,JSON.stringify({program:require('node:path').basename(process.argv[1]),args,gitDir:process.env.GIT_DIR,configCount:process.env.GIT_CONFIG_COUNT,global:process.env.GIT_CONFIG_GLOBAL})+'\\n');
if(process.argv[1].endsWith('/gh')){if(process.env.FAIL_GH){process.stderr.write('Bearer synthetic-test-secret');process.exit(1)}process.stdout.write(process.env.FIXTURE_LIST);process.exit(0)}
const clone=args.indexOf('clone');if(clone>=0){const separator=args.lastIndexOf('--');const remote=args[separator+1];args[separator+1]=process.env.FIXTURE_REPO;args.unshift('-c','protocol.file.allow=always');const r=cp.spawnSync(process.env.REAL_GIT,args,{env:process.env,encoding:'utf8'});if(r.status!==0){process.stderr.write(r.stderr||'');process.exit(r.status||1)}const dest=args[args.length-1];const c=cp.spawnSync(process.env.REAL_GIT,['-C',dest,'config','remote.origin.url',remote],{env:process.env,encoding:'utf8'});process.exit(c.status||0)}const r=cp.spawnSync(process.env.REAL_GIT,args,{env:process.env,encoding:'utf8'});process.stdout.write(r.stdout||'');process.stderr.write(r.stderr||'');process.exit(r.status||0);`;
    for (const name of ["git", "gh"]) {
      await writeFile(path.join(bin, name), wrapper);
      await chmod(path.join(bin, name), 0o700);
    }
    Object.assign(process.env, {
      PATH: bin + path.delimiter + envBefore.PATH,
      WORKBENCH_DATA_DIR: path.join(root, "data"),
      REAL_GIT: gitPath,
      FIXTURE_REPO: fixture,
      FIXTURE_LOG: log,
      FIXTURE_LIST: JSON.stringify(fixtureList),
      GIT_CONFIG_GLOBAL: global,
      GIT_DIR: "/invalid/inherited/git",
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: "core.hooksPath",
      GIT_CONFIG_VALUE_0: hooks,
      HOOK_SENTINEL: path.join(root, "hook-ran"),
      FILTER_SENTINEL: path.join(root, "filter-ran"),
    });
    const repos = await listGithubRepos();
    assert.deepEqual(repos, [{ ...fixtureList[0], url: url.toLowerCase() }]);
    const [first, second] = await Promise.all([
      checkoutGithub(url),
      checkoutGithub(url + ".git"),
    ]);
    assert.equal(first, second);
    assert.equal(
      await readFile(path.join(first, "payload.txt"), "utf8"),
      "source text",
    );
    await assert.rejects(access(process.env.HOOK_SENTINEL!));
    await assert.rejects(access(process.env.FILTER_SENTINEL!));
    await writeFile(path.join(first, "payload.txt"), "user modification");
    assert.equal(await checkoutGithub(url), first);
    assert.equal(
      await readFile(path.join(first, "payload.txt"), "utf8"),
      "user modification",
    );
    const commands = (await readFile(log, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    const clones = commands.filter((c) => c.args.includes("clone"));
    assert.equal(clones.length, 1);
    for (const c of commands) {
      assert.equal(c.gitDir, undefined);
      assert.equal(c.configCount, undefined);
      assert.equal(c.global, "/dev/null");
    }
    assert.ok(clones[0].args.includes("--no-checkout"));
    assert.ok(clones[0].args.includes("--no-recurse-submodules"));
    assert.ok(clones[0].args.includes("core.hooksPath=/dev/null"));
    assert.deepEqual(
      (await readdir(path.dirname(first))).filter(
        (p) => p.endsWith(".lock") || p.startsWith(".clone-"),
      ),
      [],
    );
    await git([
      "-C",
      first,
      "config",
      "remote.origin.url",
      "https://github.com/someone/another.git",
    ]);
    await assert.rejects(checkoutGithub(url), /origin does not match/);
    assert.equal(
      await readFile(path.join(first, "payload.txt"), "utf8"),
      "user modification",
    );
    await git(["-C", first, "config", "remote.origin.url", url + ".git"]);
    await git(["-C", first, "config", "filter.evil.smudge", "echo unsafe"]);
    await assert.rejects(checkoutGithub(url), /unsupported Git configuration/);
    await git(["-C", first, "config", "--unset", "filter.evil.smudge"]);
    await symlink(
      fixture,
      path.join(first, ".git", "objects", "info", "alternates"),
    );
    await assert.rejects(checkoutGithub(url), /alternate objects/);
    process.env.FAIL_GH = "1";
    await assert.rejects(listGithubRepos(), (error) => {
      assert.match((error as Error).message, /GitHub operation failed/);
      assert.doesNotMatch(
        (error as Error).message,
        /synthetic-test-secret|Bearer/,
      );
      return true;
    });
  } finally {
    for (const key of Object.keys(process.env))
      if (!(key in envBefore)) delete process.env[key];
    Object.assign(process.env, envBefore);
    await rm(root, { recursive: true, force: true });
  }
});
