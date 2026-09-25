import { spawn } from "node:child_process";
import {
  access,
  copyFile,
  mkdir,
  mkdtemp,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { build, type Plugin } from "esbuild";
import type {
  ModelConfig,
  RepoInfo,
  RunEvent,
  Usage,
} from "../shared/types.js";
import { committedSource, LEARNING_REVISION } from "./importer.js";

const require = createRequire(import.meta.url);
const workspace = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "..",
);
const MAX_MESSAGE = 2_000_000;
const MAX_OUTPUT = 12_000_000;
const ALLOWED_SOURCE = new Set([
  "src/agent/orchestrator.ts",
  "src/agent/nodes.ts",
  "src/agent/prompts.ts",
  "src/agent/calibration.ts",
  "src/agent/density.ts",
  "src/agent/codegate.ts",
  "src/render/index.ts",
  "src/render/schema.ts",
  "src/render/components.ts",
  "src/render/world.ts",
  "src/render/tokens.ts",
  "src/render/runtime.ts",
  "src/render/math.ts",
  "src/render/eligibility.ts",
]);
type Generate = (
  system: string,
  input: string,
  options?: { maxOutputTokens?: number },
) => Promise<{ text: string; usage: Usage }>;
type Event = Omit<RunEvent, "id" | "time">;

// This bridge is injected instead of the source app's provider clients. Original prompts,
// original Zod schemas, profile assembly, brief assembly and renderer run unchanged.
const bridge = String.raw`
import readline from 'node:readline';
export const emit=(message)=>process.stdout.write(JSON.stringify(message)+'\n');
const pending=new Map(); let serial=0;
export const usage=new Map();
const nodeFor=(name)=>name==='coverage-brief'||name==='coverage-brief-retry'?'coverageBrief':name||'overview';
export const inputReady=new Promise(resolve=>{
  const lines=readline.createInterface({input:process.stdin});
  lines.on('line',line=>{
    try { const msg=JSON.parse(line);
      if(msg.type==='start')resolve(msg.input);
      else if(msg.type==='model.result') {const p=pending.get(msg.id); if(p){pending.delete(msg.id);msg.error?p.reject(new Error(msg.error)):p.resolve(msg);}}
    } catch {process.exit(2);}
  });
});
for(const name of ['log','warn','error'])console[name]=(...args)=>emit({type:'event',event:{type:'feedback',nodeId:'overview',message:args.map(x=>typeof x==='string'?x:JSON.stringify(x)).join(' ').slice(0,2000)}});
export async function ask(messages,options={},config={}){
  const id=++serial; const nodeId=nodeFor(config.runName);
  const system=messages.filter(m=>m.role==='system').map(m=>m.text).join('\n');
  const input=messages.filter(m=>m.role!=='system').map(m=>m.text).join('\n');
  const response=await new Promise((resolve,reject)=>{pending.set(id,{resolve,reject});emit({type:'model.request',id,nodeId,system,input,maxOutputTokens:Math.min(options.maxTokens||3000,3000)});});
  const u=usage.get(nodeId)||{inputTokens:0,outputTokens:0,estimatedCostUsd:0};
  u.inputTokens+=response.usage?.inputTokens||0;u.outputTokens+=response.usage?.outputTokens||0;u.estimatedCostUsd+=response.usage?.estimatedCostUsd||0;usage.set(nodeId,u);
  return response.text;
}
const counts=new Map();
export function wrap(id,fn){return async(...args)=>{
 const invocation=(counts.get(id)||0)+1;counts.set(id,invocation);
 const start=Date.now();const before={...(usage.get(id)||{})};
 emit({type:'event',event:{type:'node.started',nodeId:id,invocation,input:JSON.stringify(args[0]??null)}});
 try{const output=await fn(...args);const u=usage.get(id);
 emit({type:'event',event:{type:'node.completed',nodeId:id,invocation,output:JSON.stringify(output===undefined?args[0]:output),latencyMs:Date.now()-start,...(u?{usage:{inputTokens:u.inputTokens-(before.inputTokens||0),outputTokens:u.outputTokens-(before.outputTokens||0),estimatedCostUsd:u.estimatedCostUsd-(before.estimatedCostUsd||0)}}:{})}});return output;
 }catch(e){const u=usage.get(id);emit({type:'event',event:{type:'node.failed',nodeId:id,invocation,message:e.message,latencyMs:Date.now()-start,...(u?{usage:{inputTokens:u.inputTokens-(before.inputTokens||0),outputTokens:u.outputTokens-(before.outputTokens||0),estimatedCostUsd:u.estimatedCostUsd-(before.estimatedCostUsd||0)}}:{})}});throw e;}
};}
export const artifacts=[];
`;

const modelShim = String.raw`
import {ask} from 'bridge';
export const gptFallbackEnabled=()=>false;
export const makeGptLLM=()=>null;
export const makeLLM=(_tier,_temperature,opts={})=>opts;
export const withOverloadRetry=fn=>fn();
export const invokeResilient=(runnable,input,config)=>runnable.invoke(input,config);
function schemaJson(s){const d=s._def;switch(d.typeName){
case 'ZodObject':{const properties={};const required=[];for(const [k,v]of Object.entries(d.shape())){properties[k]=schemaJson(v);if(!v.isOptional())required.push(k);}return {type:'object',properties,required};}
case 'ZodArray':return {type:'array',items:schemaJson(d.type)};
case 'ZodEnum':return {type:'string',enum:d.values};
case 'ZodString':return {type:'string'};case 'ZodNumber':return {type:'number'};case 'ZodBoolean':return {type:'boolean'};
case 'ZodOptional':case 'ZodDefault':return schemaJson(d.innerType);
case 'ZodNullable':return {anyOf:[schemaJson(d.innerType),{type:'null'}]};
case 'ZodLiteral':return {const:d.value};default:return {};
}}
function parse(text){const clean=text.trim().replace(/^\x60\x60\x60(?:json)?\s*/,'').replace(/\s*\x60\x60\x60$/,'');try{return JSON.parse(clean);}catch{const a=clean.indexOf('{'),b=clean.lastIndexOf('}');if(a<0||b<a)throw new Error('Model did not return JSON.');return JSON.parse(clean.slice(a,b+1));}}
export function structuredWithFallback(client,_gpt,schema,opts={}){return {invoke:async(messages,config)=>{
 const instruction={role:'system',text:'Return exactly one JSON object matching this schema. No markdown or commentary. '+JSON.stringify(schemaJson(schema))};
 const text=await ask([...messages,instruction],client,config);const parsed=schema.parse(parse(text));
 return opts.includeRaw?{parsed,raw:{content:text}}:parsed;
}};}
export const rawWithFallback=(client)=>({invoke:async(messages,config)=>({content:await ask(messages,client,config)})});
`;

const messagesShim = String.raw`
class Message {constructor(content,role){this.role=role;this.content=typeof content==='object'&&content.content!==undefined?content.content:content;this.text=typeof this.content==='string'?this.content:(this.content||[]).map(b=>b.text||'').join('\n');}}
export class SystemMessage extends Message{constructor(content){super(content,'system');}}
export class HumanMessage extends Message{constructor(content){super(content,'user');}}
`;

const stubs: Record<string, string> = {
  "src/agent/llm.ts": modelShim,
  "src/lib/db.ts":
    "export const ragEnabled=()=>false; export const dbEnabled=()=>false;",
  "src/rag/retrieve.ts":
    "export const retrieve=async()=>({chunks:[],coverage:0});",
  "src/lib/uploads.ts":
    "export const hasUploads=()=>false; export const getUploadTitles=()=>[]; export const retrieveFromUploads=async()=>[];",
  "src/lib/credits.ts":
    'export const spendOne=async()=>{throw new Error("Billing is disabled in the isolated adapter.")};',
  "src/lib/visuals.ts": "export const retrieveVisual=async()=>null;",
  "src/lib/jobs.ts":
    "export const releaseGenSlot=()=>{};export const lessonPercent=()=>0;",
  "src/lib/langfuse.ts": "export const makeRootedLangfuseHandler=()=>null;",
  "src/lib/artifacts.ts": String.raw`import{artifacts,emit}from'bridge';export async function registerArtifact(value){emit({type:'event',event:{type:'node.started',nodeId:'artifact',invocation:1,input:JSON.stringify({kind:value.kind,title:value.title})}});const artifact={...value,id:'isolated-overview'};artifacts.push(artifact);emit({type:'event',event:{type:'node.completed',nodeId:'artifact',invocation:1,output:JSON.stringify({id:artifact.id,storage:'isolated memory',databaseWrite:false})}});return {id:artifact.id,kind:artifact.kind,title:artifact.title};}export const getArtifact=async()=>null;export const updateArtifact=async()=>{throw new Error('Full build is outside this adapter.')};`,
};

const entry = String.raw`
import {runOverviewJob} from 'actual:src/agent/orchestrator.ts';
import {emit,inputReady,artifacts,wrap} from 'bridge';
const input=await inputReady;
const job={id:'isolated-job',userId:'test-user',status:'planning',isCourse:false,lessons:[],createdAt:Date.now()};
try{
 const execute=async(job,args)=>{await runOverviewJob(job,args);if(job.status==='error')throw new Error(job.error||'Original overview failed.');};
 await wrap('overview',execute)(job,{userPrompt:input,userId:'test-user',cards:{quick:'on'},uploadIds:[],readingMode:'vertical'});
 if(job.status==='error'||!artifacts.length)throw new Error(job.error||'Original overview produced no artifact.');
 const artifact=artifacts[0];
 emit({type:'result',output:JSON.stringify({adapter:'learning-studio/original-overview',revision:'${LEARNING_REVISION}',scope:'Overview only. Full lesson build requires a separate approval/runtime path.',grounding:'No external retrieval: original app reports model knowledge only.',persistence:'Isolated in-memory artifact, no database or billing calls.',blueprint:artifact.blueprint,htmlBytes:Buffer.byteLength(artifact.html)},null,2)});
 await new Promise(resolve=>process.stdout.write('',resolve));process.exit(0);
}catch(error){emit({type:'error',message:error.message});await new Promise(resolve=>process.stdout.write('',resolve));process.exit(1);}
`;

export async function learningSandboxAvailable(): Promise<boolean> {
  if (process.platform !== "darwin") return false;
  try {
    await access("/usr/bin/sandbox-exec");
    return true;
  } catch {
    return false;
  }
}

/** OS confinement for this reviewed adapter only; never used to permit arbitrary edited code. */
export function learningSandboxPolicy(
  directory: string,
  nodeExecutable: string,
): string {
  const q = (value: string) => JSON.stringify(value);
  return `(version 1)
(deny default)
(allow process-exec (literal ${q(nodeExecutable)}))
(allow sysctl-read)
(allow mach-lookup)
(allow file-read-metadata)
(allow file-read* (literal "/") (subpath "/System") (subpath "/usr") (subpath "/Library/Apple/System/Library") (subpath "/private/var/db/dyld") (subpath ${q(path.dirname(path.dirname(nodeExecutable)))}) (subpath ${q(directory)}) (literal "/dev/null") (literal "/dev/urandom") (literal "/dev/random"))
(deny network*)
(deny file-write*)
(deny process-fork)
`;
}

async function bundleSnapshot(
  repo: RepoInfo,
  directory: string,
): Promise<string> {
  const snapshot = new Map<string, string>();
  for (const file of ALLOWED_SOURCE)
    snapshot.set(file, await committedSource(repo, file));
  const plugin: Plugin = {
    name: "trusted-learning-snapshot",
    setup(builder) {
      builder.onResolve({ filter: /.*/ }, (args) => {
        if (args.path === "bridge")
          return { path: "bridge", namespace: "shim" };
        if (args.path === "@langchain/core/messages")
          return { path: "messages", namespace: "shim" };
        if (args.path.startsWith("actual:"))
          return { path: args.path.slice(7), namespace: "source" };
        if (args.namespace === "source" && args.path.startsWith(".")) {
          let target = path.posix.normalize(
            path.posix.join(path.posix.dirname(args.importer), args.path),
          );
          if (!target.endsWith(".ts")) target += ".ts";
          if (
            args.importer === "src/agent/orchestrator.ts" &&
            target === "src/agent/nodes.ts"
          )
            return { path: "nodes", namespace: "facade" };
          if (target === "src/render/index.ts")
            return { path: "render", namespace: "facade" };
          if (stubs[target]) return { path: target, namespace: "shim" };
          if (!ALLOWED_SOURCE.has(target))
            throw new Error(`Unapproved source dependency: ${target}`);
          return { path: target, namespace: "source" };
        }
        if (["zod", "yaml", "katex"].includes(args.path))
          return { path: require.resolve(args.path) };
        return null;
      });
      builder.onLoad({ filter: /.*/, namespace: "source" }, (args) => ({
        contents: snapshot.get(args.path) ?? "",
        loader: "ts",
        resolveDir: workspace,
      }));
      builder.onLoad({ filter: /.*/, namespace: "shim" }, (args) => ({
        contents:
          args.path === "bridge"
            ? bridge
            : args.path === "messages"
              ? messagesShim
              : stubs[args.path],
        loader: "js",
        resolveDir: workspace,
      }));
      builder.onLoad({ filter: /.*/, namespace: "facade" }, (args) => ({
        contents:
          args.path === "nodes"
            ? `import * as original from 'actual:src/agent/nodes.ts';import {wrap} from 'bridge';export const profiler=wrap('profiler',original.profiler);export const retriever=wrap('retriever',original.retriever);export const coverageBrief=wrap('coverageBrief',original.coverageBrief);export const planner=original.planner;export const architect=original.architect;export const runDeepDive=original.runDeepDive;export const writeOverviewProse=original.writeOverviewProse;`
            : `import {renderArtifact as original} from 'actual:src/render/index.ts';import{emit}from'bridge';export function renderArtifact(...args){const start=Date.now();emit({type:'event',event:{type:'node.started',nodeId:'render',invocation:1,input:JSON.stringify(args[0])}});const result=original(...args);emit({type:'event',event:{type:'node.completed',nodeId:'render',invocation:1,output:result,latencyMs:Date.now()-start}});return result;}`,
        loader: "js",
        resolveDir: workspace,
      }));
    },
  };
  const result = await build({
    stdin: {
      contents: entry,
      resolveDir: workspace,
      sourcefile: "learning-adapter-entry.mjs",
      loader: "js",
    },
    bundle: true,
    write: false,
    format: "esm",
    platform: "node",
    target: "node22",
    banner: {
      js: "import {createRequire as __adapterCreateRequire} from 'node:module'; const require=__adapterCreateRequire(import.meta.url);",
    },
    plugins: [plugin],
    logLevel: "silent",
  });
  const output = path.join(directory, "runner.mjs");
  await writeFile(output, result.outputFiles[0].contents, { mode: 0o600 });
  // The original math renderer uses createRequire for static CSS/fonts. Copy only these
  // public package assets; no source-repo environment or configuration is copied.
  const katexRoot = path.dirname(path.dirname(require.resolve("katex")));
  const targetRoot = path.join(directory, "node_modules/katex");
  await mkdir(path.join(targetRoot, "dist/fonts"), { recursive: true });
  await writeFile(path.join(targetRoot, "package.json"), "{}");
  await copyFile(
    path.join(katexRoot, "dist/katex.min.css"),
    path.join(targetRoot, "dist/katex.min.css"),
  );
  for (const font of [
    "Main-Regular",
    "Main-Bold",
    "Math-Italic",
    "AMS-Regular",
    "Size1-Regular",
    "Size2-Regular",
    "Size3-Regular",
    "Size4-Regular",
  ])
    await copyFile(
      path.join(katexRoot, `dist/fonts/KaTeX_${font}.woff2`),
      path.join(targetRoot, `dist/fonts/KaTeX_${font}.woff2`),
    );
  return output;
}

export async function runLearningStudio({
  repo,
  input,
  config: _config,
  signal,
  onEvent,
  generate,
}: {
  repo: RepoInfo;
  input: string;
  config: ModelConfig;
  signal: AbortSignal;
  onEvent: (event: Event) => void;
  generate: Generate;
}): Promise<string> {
  if (repo.adapter !== "learning-studio" || repo.revision !== LEARNING_REVISION)
    throw new Error(
      "Imported execution is available only for the inspected learning-studio revision.",
    );
  if (!(await learningSandboxAvailable()))
    throw new Error(
      "The trusted learning-studio adapter requires macOS sandbox-exec. This platform remains discovery-only.",
    );
  if (signal.aborted) throw new Error("Run cancelled.");
  if (!input.trim() || input.length > 20_000)
    throw new Error("Provide an input between 1 and 20,000 characters.");
  const directory = await realpath(
    await mkdtemp(path.join(tmpdir(), "citadel-learning-")),
  );
  try {
    const bundled = await bundleSnapshot(repo, directory);
    if (signal.aborted) throw new Error("Run cancelled.");
    const nodeExecutable = await realpath(process.execPath);
    const profile = path.join(directory, "sandbox.sb");
    await writeFile(profile, learningSandboxPolicy(directory, nodeExecutable), {
      mode: 0o600,
    });
    onEvent({
      type: "feedback",
      message:
        "Original overview source executes in a macOS sandbox. Provider calls are injected per run. Retrieval/database/auth/billing/Langfuse are disabled; artifact persistence is in memory. Full lesson build is discovery-only.",
    });
    return await new Promise<string>((resolve, reject) => {
      const child = spawn(
        "/usr/bin/sandbox-exec",
        ["-f", profile, nodeExecutable, "--max-old-space-size=256", bundled],
        { cwd: directory, env: {}, stdio: ["pipe", "pipe", "pipe"] },
      );
      let settled = false,
        buffer = "",
        stderr = "",
        bytes = 0,
        calls = 0;
      const cleanup = () => {
        clearTimeout(timeout);
        signal.removeEventListener("abort", abort);
      };
      const finish = (error?: Error, result?: string) => {
        if (settled) return;
        settled = true;
        cleanup();
        if (error) {
          child.kill("SIGKILL");
          reject(error);
        } else resolve(result ?? "");
      };
      const abort = () => finish(new Error("Run cancelled."));
      const timeout = setTimeout(
        () =>
          finish(new Error("Imported overview exceeded its 120-second limit.")),
        120_000,
      );
      signal.addEventListener("abort", abort, { once: true });
      const send = (msg: unknown) => {
        if (!settled && child.stdin.writable)
          child.stdin.write(JSON.stringify(msg) + "\n");
      };
      child.stdout.on("data", (chunk: Buffer) => {
        bytes += chunk.length;
        buffer += chunk.toString("utf8");
        if (bytes > MAX_OUTPUT || buffer.length > MAX_MESSAGE) {
          finish(new Error("Imported runtime exceeded its output limit."));
          return;
        }
        let newline: number;
        while ((newline = buffer.indexOf("\n")) >= 0 && !settled) {
          const line = buffer.slice(0, newline);
          buffer = buffer.slice(newline + 1);
          let msg: any;
          try {
            msg = JSON.parse(line);
          } catch {
            finish(new Error("Invalid imported runtime protocol."));
            return;
          }
          if (msg.type === "event") {
            if (
              !msg.event ||
              ![
                "node.started",
                "node.completed",
                "node.failed",
                "feedback",
              ].includes(msg.event.type)
            ) {
              finish(new Error("Invalid imported event."));
              return;
            }
            try {
              onEvent(msg.event);
            } catch (error) {
              finish(error instanceof Error ? error : new Error(String(error)));
            }
          } else if (msg.type === "model.request") {
            if (
              ++calls > 6 ||
              typeof msg.system !== "string" ||
              typeof msg.input !== "string" ||
              msg.system.length + msg.input.length > 250_000
            ) {
              finish(
                new Error(
                  "Imported model request exceeds the adapter contract.",
                ),
              );
              return;
            }
            void generate(msg.system, msg.input, {
              maxOutputTokens: Math.min(
                Number(msg.maxOutputTokens) || 3000,
                3000,
              ),
            }).then(
              (result) => {
                if (result.text.length > 300_000) {
                  finish(new Error("Model output exceeds adapter limit."));
                  return;
                }
                send({
                  type: "model.result",
                  id: msg.id,
                  text: result.text,
                  usage: result.usage,
                });
              },
              (error) =>
                send({
                  type: "model.result",
                  id: msg.id,
                  error: error instanceof Error ? error.message : String(error),
                }),
            );
          } else if (msg.type === "result")
            finish(undefined, String(msg.output));
          else if (msg.type === "error") finish(new Error(String(msg.message)));
          else finish(new Error("Unknown imported runtime message."));
        }
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderr = (stderr + chunk.toString()).slice(-4000);
      });
      child.on("error", (error) => finish(error));
      child.on("exit", (code) => {
        if (!settled)
          finish(
            new Error(
              `Isolated imported runtime exited (${code}): ${stderr.slice(-1500)}`,
            ),
          );
      });
      child.stdin.on("error", (error) => {
        if (!settled) finish(error);
      });
      send({ type: "start", input });
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
