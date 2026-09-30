// Real HTTP/Auth.js + disposable local PostgreSQL. No real provider credentials or calls.
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { randomUUID, randomBytes } from "node:crypto";
import pg from "pg";
import { compare } from "bcryptjs";
const connectionString = process.env.TEST_DATABASE_URL || "postgresql://macbook@127.0.0.1:55443/citadel_auth_test";
const target = new URL(connectionString);
assert(["localhost", "127.0.0.1"].includes(target.hostname) && target.pathname.endsWith("_test"), "Only disposable loopback test databases are permitted.");
const dir = await mkdtemp(path.join(tmpdir(), "citadel-auth-"));
const port = Number(process.env.TEST_PORT || 8953), base = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, ["--import", "tsx", "server/index.ts"], { env: {
  PATH: process.env.PATH, PORT: String(port), HOST: "127.0.0.1", NODE_ENV: "test", PORTFOLIO_AUTH_ENABLED: "1",
  WORKBENCH_DATA_DIR: dir, WORKBENCH_STORAGE_MODE: "fixture", WORKBENCH_PROVIDER_MODE: "mock",
  DATABASE_URL: connectionString, DATABASE_SSL: "disable", AUTH_SECRET: randomBytes(48).toString("hex"), APP_URL: base,
}, stdio: ["ignore", "pipe", "pipe"] });
let logs = ""; child.stdout.on("data", b => { logs += b; }); child.stderr.on("data", b => { logs += b; });
const db = new pg.Client({ connectionString, ssl: false });
function client() {
  const cookies = new Map();
  const call = async (url, body, options = {}) => {
    const headers = { cookie: [...cookies].map(([k,v]) => `${k}=${v}`).join("; "), ...(body === undefined ? {} : { origin: base, "content-type": "application/json" }), ...options.headers };
    const response = await fetch(base + url, { method: body === undefined ? "GET" : "POST", ...options, headers,
      body: body === undefined ? undefined : options.form ? new URLSearchParams(body) : JSON.stringify(body), redirect: "manual" });
    for (const value of response.headers.getSetCookie()) { const pair = value.split(";")[0], split = pair.indexOf("="); cookies.set(pair.slice(0,split), pair.slice(split+1)); }
    return response;
  };
  call.cookie = () => [...cookies].map(([k,v]) => `${k}=${v}`).join("; ");
  return call;
}
async function signin(c, email, password) {
  const csrf = await (await c("/auth/csrf")).json();
  const response = await c("/auth/callback/credentials", { email, password, csrfToken: csrf.csrfToken, callbackUrl: base },
    { form: true, headers: { "content-type": "application/x-www-form-urlencoded", "X-Auth-Return-Redirect": "1" } });
  assert.equal(response.status, 200); assert(!(await response.json()).url.includes("error="));
  assert(response.headers.getSetCookie().some(value => value.includes("session-token") && /HttpOnly/.test(value)));
}
try {
  let ready = false;
  for (let i=0; i<100; i++) { try { if ((await fetch(base + "/healthz")).ok) { ready=true; break; } } catch {} await new Promise(r=>setTimeout(r,100)); }
  assert(ready, "Main server must boot with PG and no provider keys"); await db.connect();
  const a = client(), b = client(), anonymous = client(), password = randomBytes(20).toString("base64url") + "Aa1!";
  const suffix = randomUUID().slice(0,8), emails = [`a-${suffix}@example.invalid`, `b-${suffix}@example.invalid`];
  assert.equal((await anonymous("/api/bootstrap")).status, 401);
  assert.equal((await anonymous("/api/auth/signup", { email: emails[0], password }, { headers: { origin: "https://foreign.invalid" } })).status, 403);
  for (const email of emails) assert.equal((await anonymous("/api/auth/signup", { email, password })).status, 201);
  assert.equal((await anonymous("/api/auth/signup", { email: emails[0].toUpperCase(), password })).status, 409);
  await signin(a, emails[0], password); await signin(b, emails[1], password);
  const users = await db.query("select id,password_hash from users where email=ANY($1)", [emails]);
  assert.equal(users.rows.length, 2); for (const user of users.rows) assert(await compare(password, user.password_hash));
  const sessionA = await (await a("/api/auth/session")).json(); assert(sessionA.enabled && sessionA.user.id);
  const bootA = await (await a("/api/bootstrap")).json(); assert.equal(bootA.projects.length,0);
  const example = await a("/api/examples", {}); assert.equal(example.status,200); const fixture = await example.json();
  assert.equal(fixture.project.example.kind,"source"); assert.equal(fixture.runnableProject.example.kind,"cached-workflow");
  const again = await (await a("/api/examples", {})).json(); assert.equal(again.project.id,fixture.project.id);
  const sourcePath = fixture.project.repo.sources[0].path;
  assert.equal((await a(`/api/projects/${fixture.project.id}/source?path=${encodeURIComponent(sourcePath)}`)).status,200);
  for (const url of [`/api/projects/${fixture.project.id}/source?path=${encodeURIComponent(sourcePath)}`, `/api/projects/${fixture.runnableProject.id}/export`, `/api/projects/${fixture.project.id}/connections`]) assert.equal((await b(url)).status,404);
  assert.equal((await b(`/api/projects/${fixture.project.id}`, {name:"foreign edit"},{method:"PUT"})).status,404);
  assert.equal((await a("/api/repos/connect", {path:"/etc"})).status,403);
  assert.equal((await a("/api/credentials/import", {provider:"gemini"})).status,400);
  assert.equal((await a(`/api/projects/${fixture.project.id}/langfuse`, {url:"http://127.0.0.1:80",publicKey:"synthetic-public",secretKey:"synthetic-private"})).status,400);
  assert.equal((await a("/api/preflight", {projectId:fixture.project.id,input:fixture.input,config:fixture.config})).status,400);
  const createdCredential = await (await a("/api/credentials", {provider:"gemini",label:"Synthetic fixture",key:"synthetic-not-a-provider-key"})).json();
  assert(!(await (await b("/api/credentials")).json()).some(c=>c.id===createdCredential.id));
  assert.equal((await b(`/api/credentials/${createdCredential.id}/models`)).status,400);
  const runResponse = await a("/api/runs", {projectId:fixture.runnableProject.id,input:fixture.input,config:fixture.config}); assert.equal(runResponse.status,200);
  const run = await runResponse.json();
  let done;
  for(let i=0;i<50;i++){done=await(await a(`/api/runs/${run.id}`)).json();if(done.status==="completed")break;await new Promise(r=>setTimeout(r,50));}
  assert.equal(done.status,"completed");assert.equal(done.usage.estimatedCostUsd,0);assert(done.output.includes("Cached workflow example"));
  for(const url of [`/api/runs/${run.id}`,`/api/runs/${run.id}/events`]) assert.equal((await b(url)).status,404);
  assert.equal((await b(`/api/runs/${run.id}/cancel`,{})).status,404);
  assert.equal((await a(`/api/projects/${fixture.runnableProject.id}/export`)).status,200);
  const token = await(await a(`/api/projects/${fixture.project.id}/telemetry/token`,{})).json();
  const trace={traceId:"synthetic-runtime",status:"completed",spans:[{id:"span-one",name:"Synthetic span",status:"completed",startTime:"2026-09-30T10:00:00Z",endTime:"2026-09-30T10:00:01Z",input:"Fixture only",output:"Fixture result"}]};
  const receiver = await anonymous(`/api/telemetry/${fixture.project.id}/spans`,trace,{headers:{authorization:`Bearer ${token.token}`,origin:""}});assert.equal(receiver.status,200);
  const observed=await receiver.json();assert.equal((await b(`/api/runs/${observed.runId}`)).status,404);
  await db.query("update users set disabled_at=now() where id=$1",[sessionA.user.id]);
  assert.equal((await anonymous(`/api/telemetry/${fixture.project.id}/spans`,trace,{headers:{authorization:`Bearer ${token.token}`}})).status,401);
  await db.query("update users set disabled_at=null where id=$1",[sessionA.user.id]);
  assert.equal((await anonymous(`/api/telemetry/${fixture.runnableProject.id}/spans`,trace,{headers:{authorization:`Bearer ${token.token}`}})).status,401);
  assert.equal((await a(`/api/projects/${fixture.project.id}/telemetry/token`,{}, {method:"DELETE"})).status,200);
  assert.equal((await anonymous(`/api/telemetry/${fixture.project.id}/spans`,trace,{headers:{authorization:`Bearer ${token.token}`}})).status,401);
  assert.equal((await(await b("/api/bootstrap")).json()).projects.length,0);
  const staleCookie=a.cookie(), csrf=await(await a("/auth/csrf")).json();
  const stream=await a(`/api/runs/${run.id}/events`);assert.equal(stream.status,200);const reader=stream.body.getReader();await reader.read();
  await a("/auth/signout",{csrfToken:csrf.csrfToken,callbackUrl:base},{form:true,headers:{"content-type":"application/x-www-form-urlencoded","X-Auth-Return-Redirect":"1"}});
  assert.equal((await fetch(base+"/api/bootstrap",{headers:{cookie:staleCookie}})).status,401);
  const closed=await Promise.race([(async()=>{while(!(await reader.read()).done){}return true;})(),new Promise(r=>setTimeout(()=>r(false),17000))]);assert(closed,"SSE closes after revocation heartbeat");
  let limited=false;for(let i=0;i<20;i++){if((await anonymous("/api/auth/signup",{})).status===429){limited=true;break;}}assert(limited);
  console.log("PASS: real Auth.js/PG bcrypt and revocation, CSRF/rates, A/B state/source/export/credential/run/SSE isolation, cached scheduler, owner-bound native ingestion, hosted local-path/connector denial; zero provider calls.");
} catch(error) {
  await writeFile(path.join(dir,"server-test.log"),logs,{mode:0o600});
  console.error("Auth integration failed; private server log:",path.join(dir,"server-test.log"));throw error;
} finally { child.kill("SIGTERM");await db.end().catch(()=>{}); }
