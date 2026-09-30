import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, symlinkSync, rmSync, existsSync, truncateSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
const root = mkdtempSync(path.join(tmpdir(), "citadel-tenant-"));
process.env.PORTFOLIO_AUTH_ENABLED = "1";
process.env.WORKBENCH_DATA_DIR = root;
process.env.WORKBENCH_STORAGE_MODE = "fixture";
process.env.WORKBENCH_PROVIDER_MODE = "live";
process.env.WORKBENCH_SPEND_LIMIT_USD = "0.000000001";
process.env.GEMINI_API_KEY = ["synthetic", "not", "provider", "credential"].join("-");
const { withTenant, tenantRoot, bindTenant, tenantKey, assertTenantPath } = await import("../server/tenant.js");
const { state, save, projectById, journal, assertWriteCapacity } = await import("../server/store.js");
const { defaultGraph } = await import("../server/graph.js");
const { addCredential, credentials, getCredential, generate, spendStatus } = await import("../server/providers.js");
const { createReceiver, receiverOwner, disconnectReceiver, recordTrace } = await import("../server/telemetry.js");
const { bus, emit, cancelRun } = await import("../server/runs.js");
const { githubStatus, connectGithubToken } = await import("../server/github.js");
const { langfuseUrl } = await import("../server/langfuse.js");
const { examples } = await import("../server/examples.js");
const { redactIntegrationSecrets, registerIntegrationSecret, registerServerSecret } = await import("../server/integration-secrets.js");
const { TENANT_LIMIT, APP_LIMIT } = await import("../server/import-limits.js");
const { sourceFiles } = await import("../server/importer.js");
const a=randomUUID(), b=randomUUID();
const originalFetch=globalThis.fetch;
after(()=>{globalThis.fetch=originalFetch;rmSync(root,{recursive:true,force:true});});
const project=(id:string)=>({id,name:id,brief:"Synthetic fixture",graph:defaultGraph(id),createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()});
test("private startup fails closed without actor; proxy enumeration serializes only the selected workspace",()=>{
  assert.throws(()=>state.projects,/verified workspace owner/);
  assert.throws(()=>credentials(),/verified workspace owner/);
  withTenant(a,()=>{state.projects.push(project("owned-a"));save();assert.equal(JSON.parse(JSON.stringify(state)).projects.length,1);});
  withTenant(b,()=>{assert.equal(state.projects.length,0);assert.throws(()=>projectById("owned-a"),/not found/);state.projects.push(project("owned-b"));save();});
  assert.equal(JSON.parse(readFileSync(path.join(root,"users",a,"workspace.json"),"utf8")).projects[0].id,"owned-a");
});
test("concurrent delayed completions and callbacks invoked by another actor retain their creator",async()=>{
  const callback=withTenant(a,()=>bindTenant(()=>{assert.equal(projectById("owned-a").id,"owned-a");save();return tenantKey("run");}));
  assert.equal(withTenant(b,callback),`${a}:run`);
  await Promise.all([withTenant(a,async()=>{await new Promise(r=>setTimeout(r,20));state.projects[0].brief="A completion";save();}),withTenant(b,async()=>{await new Promise(r=>setTimeout(r,5));state.projects[0].brief="B completion";save();})]);
  withTenant(a,()=>assert.equal(state.projects[0].brief,"A completion"));withTenant(b,()=>assert.equal(state.projects[0].brief,"B completion"));
});
test("BYOK IDs and GitHub PAT/session metadata stay within owner",async()=>{
  const credential=withTenant(a,()=>addCredential("gemini","Synthetic A",["synthetic","owner","A","fixture"].join("-")));
  withTenant(b,()=>{assert.throws(()=>getCredential(credential.id),/missing/);assert(!credentials().some(c=>c.id===credential.id));});
  let calls=0;globalThis.fetch=async(input)=>{assert.equal(String(input),"https://api.github.com/user");calls++;return new Response(JSON.stringify({login:"SyntheticOwner"}),{status:200});};
  await withTenant(a,()=>connectGithubToken("synthetic_fixture_token_123456"));
  assert.equal((await withTenant(a,()=>githubStatus())).connected,true);
  assert.equal((await withTenant(b,()=>githubStatus())).connected,false);assert.equal(calls,1);
  globalThis.fetch=originalFetch;
});
test("user redaction values never censor another owner's source while configured secrets remain redacted",()=>{
  const phrase="This ordinary source phrase belongs to B";
  withTenant(a,()=>registerIntegrationSecret(phrase));
  withTenant(a,()=>assert.equal(redactIntegrationSecrets(phrase),"[REDACTED]"));
  withTenant(b,()=>assert.equal(redactIntegrationSecrets(phrase),phrase));
  const configured=["server","synthetic","redaction","fixture"].join("-");registerServerSecret(configured);
  for(const owner of [a,b]) withTenant(owner,()=>assert.equal(redactIntegrationSecrets(configured),"[REDACTED]"));
});
test("foreign run cancellation and SSE channel identity cannot cross workspaces",()=>{
  assert.equal(withTenant(b,()=>cancelRun("not-owned")),undefined);
  assert.notEqual(withTenant(a,()=>tenantKey("identical-run-id")),withTenant(b,()=>tenantKey("identical-run-id")));
  let delivered=0;const channel=withTenant(a,()=>tenantKey("probe"));const listener=()=>delivered++;
  bus.on(channel,listener);bus.emit(withTenant(b,()=>tenantKey("probe")),{});assert.equal(delivered,0);bus.off(channel,listener);
});
test("native capability resolves authoritative owner, wrong project and revocation fail",()=>{
  const receiver=withTenant(a,()=>createReceiver("owned-a"));
  assert.equal(receiverOwner("owned-a",`Bearer ${receiver.token}`),a);
  assert.throws(()=>receiverOwner("owned-b",`Bearer ${receiver.token}`),/unauthorized/);
  withTenant(b,()=>assert.throws(()=>disconnectReceiver("owned-a"),/not found/));
  withTenant(a,()=>disconnectReceiver("owned-a"));assert.throws(()=>receiverOwner("owned-a",`Bearer ${receiver.token}`),/unauthorized/);
});
test("configured user-cap failure leaves shared ledger and transport untouched",async()=>{
  let calls=0;globalThis.fetch=async()=>{calls++;throw new Error("Unexpected outbound request");};
  await withTenant(a,async()=>{
    const before=spendStatus();
    await assert.rejects(generate({credentialId:"configured-provider",model:"gemini-3.5-flash-lite"},"Synthetic","Fixture"),/spend cap/);
    assert.deepEqual(spendStatus(),before);
  });
  assert.equal(calls,0);assert(!existsSync(path.join(root,"configured-provider-usage.json")));globalThis.fetch=originalFetch;
});
test("hosted source paths, user symlink roots and private Langfuse URLs fail closed",()=>{
  withTenant(a,()=>assert.throws(()=>assertTenantPath(path.join(root,"users",b)),/outside/));
  const malicious=randomUUID();symlinkSync(path.join(root,"users",a),path.join(root,"users",malicious));
  assert.throws(()=>withTenant(malicious,()=>tenantRoot()),/real directory/);
  assert.throws(()=>langfuseUrl("http://127.0.0.1:80"),/Langfuse/);
  assert.throws(()=>langfuseUrl("http://169.254.169.254"),/Langfuse/);
});
test("source inventory cannot read another owner or a host folder",async()=>{
  await withTenant(a,()=>assert.rejects(sourceFiles(path.join(root,"users",b)),/outside/));
  await withTenant(a,()=>assert.rejects(sourceFiles(tmpdir()),/outside/));
});
test("tenant and application quotas reject durable and in-memory mutations without deleting history",()=>{
  withTenant(a,()=>{
    const file=path.join(tenantRoot(),"workspace.json"), before=readFileSync(file,"utf8");
    const ballast=path.join(tenantRoot(),"synthetic-sparse-quota");writeFileSync(ballast,"");truncateSync(ballast,TENANT_LIMIT);
    try {
      state.projects.push(project("must-not-persist"));assert.throws(()=>save(),/storage limit/);
      assert.equal(readFileSync(file,"utf8"),before);assert(!state.projects.some(p=>p.id==="must-not-persist"));
    } finally {rmSync(ballast);}
    const appBallast=path.join(root,"synthetic-app-sparse-quota");writeFileSync(appBallast,"");truncateSync(appBallast,APP_LIMIT);
    try {assert.throws(()=>assertWriteCapacity(),/storage limit/);assert.equal(readFileSync(file,"utf8"),before);}
    finally {rmSync(appBallast);}
  });
});
test("full event history denies a provider request before reservation or transport and preserves history",async()=>{
  let calls=0;globalThis.fetch=async()=>{calls++;throw new Error("Unexpected outbound request");};
  await withTenant(a,async()=>{
    const events=path.join(tenantRoot(),"events.jsonl");writeFileSync(events,"");truncateSync(events,16*1024*1024);
    const before=spendStatus();
    try {
      assert.throws(()=>journal({type:"synthetic"}),/Event history limit/);
      await assert.rejects(generate({credentialId:"configured-provider",model:"gemini-3.5-flash-lite"},"Synthetic","Fixture"),/history is full/);
      assert.equal(statSync(events).size,16*1024*1024);assert.deepEqual(spendStatus(),before);
      assert.equal(calls,0);assert(!existsSync(path.join(root,"configured-provider-usage.json")));
    } finally {rmSync(events);globalThis.fetch=originalFetch;}
  });
});
test("example creation is idempotent and source and cached runnable projects are distinct",async()=>{
  const [one,two]=await withTenant(a,()=>Promise.all([examples(),examples()])) as any[];
  assert.equal(one.project.id,two.project.id);assert.notEqual(one.project.id,one.runnableProject.id);
  assert.equal(one.project.repo.adapter,"discovery-only");assert(!one.runnableProject.repo);
  assert(one.project.graph.nodes.some((n:any)=>n.source?.symbol==="draft_response"));
  assert(one.project.graph.edges.some((e:any)=>e.provenance==="declared"));
  assert(!one.project.graph.nodes.some((n:any)=>n.label==="Execution entry unresolved"));
  withTenant(b,()=>assert(!state.projects.some(p=>p.id===one.project.id)));
});
