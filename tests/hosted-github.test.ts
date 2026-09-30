import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

test("hosted Git clones use private owner caches and never inherit application secrets or gh login", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "citadel-hosted-git-"));
  const before = { ...process.env }, originalFetch = globalThis.fetch, exec = promisify(execFile);
  const git = (await exec("/usr/bin/which", ["git"])).stdout.trim();
  const fixture = path.join(root, "fixture"), bin = path.join(root, "bin"), log = path.join(root, "calls.jsonl");
  try {
    await mkdir(fixture); await mkdir(bin);
    const gitEnv = { PATH: before.PATH, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" };
    await exec(git, ["init", "--initial-branch=main", fixture], { env: gitEnv });
    await writeFile(path.join(fixture, "example.py"), "def review(value):\n    return value\n");
    await exec(git, ["-C", fixture, "add", "."], { env: gitEnv });
    await exec(git, ["-C", fixture, "-c", "user.name=Synthetic", "-c", "user.email=fixture@example.invalid", "commit", "-m", "Fixture"], { env: gitEnv });
    // Constants here are temporary local fixture paths. No credential values are written.
    const wrapper = `#!${process.execPath}
const fs=require('node:fs'),cp=require('node:child_process');
const args=process.argv.slice(2),clone=args.includes('clone');
if(Object.keys(process.env).some(k=>/^(DATABASE_|AUTH_SECRET$|GEMINI_API_KEY$|AWS_|SHOULD_NOT_INHERIT$)/.test(k)))process.exit(71);
if(!clone&&process.env.WORKBENCH_GITHUB_CLONE_TOKEN)process.exit(72);
if(args.some(a=>a.includes('!gh')))process.exit(73);
fs.appendFileSync(${JSON.stringify(log)},JSON.stringify({clone,hasToken:!!process.env.WORKBENCH_GITHUB_CLONE_TOKEN})+'\\n');
if(clone){const at=args.lastIndexOf('--'),remote=args[at+1];args[at+1]=${JSON.stringify(fixture)};args.unshift('-c','protocol.file.allow=always');const result=cp.spawnSync(${JSON.stringify(git)},args,{env:process.env,encoding:'utf8'});if(result.status!==0)process.exit(74);const fixed=cp.spawnSync(${JSON.stringify(git)},['-C',args.at(-1),'config','remote.origin.url',remote],{env:process.env,encoding:'utf8'});process.exit(fixed.status||0);}
const result=cp.spawnSync(${JSON.stringify(git)},args,{env:process.env,encoding:'utf8'});process.stdout.write(result.stdout||'');process.exit(result.status||0);
`;
    await writeFile(path.join(bin,"git"),wrapper,{mode:0o700});
    await writeFile(path.join(bin,"gh"),`#!${process.execPath}\nprocess.exit(75);\n`,{mode:0o700});
    Object.assign(process.env, { PORTFOLIO_AUTH_ENABLED:"1", WORKBENCH_DATA_DIR:path.join(root,"workspaces"), PATH:bin+path.delimiter+before.PATH,
      AUTH_SECRET:"synthetic-env-only", GEMINI_API_KEY:"synthetic-env-only", DATABASE_URL:"synthetic-env-only", AWS_SECRET_ACCESS_KEY:"synthetic-env-only", SHOULD_NOT_INHERIT:"synthetic-env-only" });
    const { withTenant } = await import("../server/tenant.js");
    const { checkoutGithub, connectGithubToken, githubStatus } = await import("../server/github.js");
    globalThis.fetch = async input => { assert.equal(String(input),"https://api.github.com/user"); return new Response(JSON.stringify({login:"Synthetic"}),{status:200}); };
    const a=randomUUID(),b=randomUUID(),url="https://github.com/synthetic-owner/source-fixture";
    await withTenant(a,()=>connectGithubToken(["synthetic","owner","token","fixture"].join("_")));
    const first=await withTenant(a,()=>checkoutGithub(url));
    const second=await withTenant(b,()=>checkoutGithub(url));
    assert.notEqual(first,second);assert(first.includes(a));assert(second.includes(b));
    assert.equal(await withTenant(a,()=>checkoutGithub(url)),first);
    assert.equal((await withTenant(b,()=>githubStatus())).connected,false);
    const calls=(await readFile(log,"utf8")).trim().split("\n").map(v=>JSON.parse(v));
    assert.equal(calls.filter(c=>c.clone).length,2);assert.equal(calls.filter(c=>c.hasToken).length,1);
    assert.equal(await readFile(path.join(first,"example.py"),"utf8"),await readFile(path.join(second,"example.py"),"utf8"));
  } finally {
    globalThis.fetch=originalFetch;for(const key of Object.keys(process.env))if(!(key in before))delete process.env[key];Object.assign(process.env,before);
    await rm(root,{recursive:true,force:true});
  }
});
