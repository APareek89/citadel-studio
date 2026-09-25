import archiver from "archiver";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { Response } from "express";
import type { Project } from "../shared/types.js";
import { validateGraph } from "./graph.js";
import { safeObject } from "./providers.js";
export async function exportProject(project: Project, res: Response) {
  if (project.repo)
    throw new Error(
      "Connected source stays in its repository. Export is available for apps built in this workbench.",
    );
  const validation = validateGraph(project.graph);
  if (!validation.ok)
    throw new Error("Fix graph validation issues before export");
  const graph = safeObject(structuredClone(project.graph));
  for (const n of graph.nodes) delete n.source;
  res.attachment(
    project.name.replace(/[^a-z0-9-_]/gi, "-") + "-r" + graph.revision + ".zip",
  );
  const zip = archiver("zip", { zlib: { level: 9 } });
  zip.on("error", () => res.destroy());
  zip.pipe(res);
  const include = ["server/runtime.ts", "server/graph.ts", "server/sandbox.ts"];
  for (const file of include) {
    let source = readFileSync(path.resolve(file), "utf8");
    if (file.endsWith("graph.ts"))
      source = source.replace(
        "import { id } from './store.js';",
        "import { randomUUID } from 'node:crypto'; const id=(prefix='id')=>prefix+'_'+randomUUID();",
      );
    zip.append(source, { name: file });
  }
  zip.append(readFileSync("shared/types.ts"), { name: "shared/types.ts" });
  zip.append(JSON.stringify(graph, null, 2), { name: "graph.json" });
  zip.append(
    JSON.stringify(
      {
        name: "exported-agent-app",
        version: "1.0.0",
        private: true,
        type: "module",
        scripts: {
          start: "tsx app.ts",
          serve: "tsx serve.ts",
          test: "tsx --test app.test.ts",
        },
        dependencies: { tsx: "4.20.5", zod: "3.25.76", ajv: "8.17.1" },
        engines: { node: ">=22" },
      },
      null,
      2,
    ),
    { name: "package.json" },
  );
  // Runtime imports only this TYPE. No workbench credential code is exported.
  zip.append(
    "export interface GenerateResult {text:string;usage:{inputTokens:number;outputTokens:number;estimatedCostUsd?:number}}\n",
    { name: "server/providers.ts" },
  );
  zip.append("API_KEY=\nPROVIDER=gemini\nMODEL=gemini-3.5-flash-lite\n", {
    name: ".env.example",
  });
  zip.append(".env*\n!.env.example\nnode_modules/\ntrace.json\n", {
    name: ".gitignore",
  });
  zip.append(
    `# ${graph.name}\n\nGraph revision ${graph.revision}. Requires Node 22+.\n\n1. Run npm install\n2. Copy .env.example to .env and add a provider key and compatible text model.\n3. Run npm test\n4. Run npm start -- "Your sample input" or npm run serve for the local browser app at http://127.0.0.1:8080\n\nProviders: gemini, openai, anthropic, groq, openrouter. Keys stay in the process environment. The runtime writes a local trace.json containing the sample input and output; do not publish it. Custom code needs Docker with node:22-alpine. No credentials, run histories, or machine paths are included. This export includes the same graph executor and validation as the workbench. Provider JSON output is prompted and validated locally. Calls have no automatic retry/fallback.\n`,
    { name: "README.md" },
  );
  zip.append(exportRunner, { name: "app.ts" });
  zip.append(exportBrowser, { name: "serve.ts" });
  zip.append(
    `import {test} from 'node:test'; import assert from 'node:assert/strict'; import {readFileSync} from 'node:fs'; import {validateGraph} from './server/graph.js'; test('exported graph is valid',()=>assert.equal(validateGraph(JSON.parse(readFileSync('graph.json','utf8'))).ok,true));`,
    { name: "app.test.ts" },
  );
  await zip.finalize();
}
const exportRunner = String.raw`import {readFileSync,writeFileSync} from 'node:fs';
import {executeGraph} from './server/runtime.js';
try{process.loadEnvFile('.env');}catch{}
const key=process.env.API_KEY;if(!key)throw new Error('Set API_KEY in .env');
const provider=process.env.PROVIDER||'gemini',model=process.env.MODEL||'gemini-3.5-flash-lite';
const graph=JSON.parse(readFileSync('graph.json','utf8'));const events:any[]=[];let calls=0,reservedUsd=0;
const signal=AbortSignal.timeout(graph.limits.timeoutMs);
const clean=(v:any)=>JSON.parse(JSON.stringify(v).split(key).join('[REDACTED]'));
const generate=async(system:string,input:string,options:any={})=>{
if(++calls>graph.limits.maxCalls)throw new Error('Model-call budget exhausted');
const max=options.maxOutputTokens||graph.limits.maxOutputTokens;if(graph.limits.maxCostUsd!==undefined){const prices:Record<string,number[]>={'gemini-3.5-flash-lite':[0.3,2.5],'gemini-3.5-flash':[0.75,3.75],'gemini-3.8-flash':[0.75,3.75],'gemini-2.5-flash-lite':[0.1,0.4],'gemini-2.5-flash':[0.3,2.5],'gemini-2.5-pro':[2.5,15]};const price=provider==='gemini'?prices[model]:undefined;if(!price)throw new Error('Dollar cap needs known model pricing');const reserve=(Buffer.byteLength(system+input)*price[0]+max*price[1])/1e6;if(reservedUsd+reserve>graph.limits.maxCostUsd)throw new Error('Cost budget exhausted');reservedUsd+=reserve;}const json=options.json?'\nReturn only valid JSON.':'';let url:string,headers:Record<string,string>,body:any;
if(provider==='gemini'){url='https://generativelanguage.googleapis.com/v1beta/models/'+encodeURIComponent(model)+':generateContent';headers={'x-goog-api-key':key};body={systemInstruction:{parts:[{text:system+json}]},contents:[{role:'user',parts:[{text:input}]}],generationConfig:{maxOutputTokens:max,temperature:0.2,...(options.json?{responseMimeType:'application/json'}:{}),...(model.startsWith('gemini-2.5-flash')?{thinkingConfig:{thinkingBudget:0}}:{})}};}
else if(provider==='anthropic'){url='https://api.anthropic.com/v1/messages';headers={'x-api-key':key,'anthropic-version':'2023-06-01'};body={model,max_tokens:max,system:system+json,messages:[{role:'user',content:input}]};}
else{const bases:any={openai:'https://api.openai.com/v1',groq:'https://api.groq.com/openai/v1',openrouter:'https://openrouter.ai/api/v1'};if(!bases[provider])throw new Error('Unsupported provider');url=bases[provider]+'/chat/completions';headers={Authorization:'Bearer '+key};body={model,messages:[{role:'system',content:system+json},{role:'user',content:input}],...(provider==='openai'?{max_completion_tokens:max}:{max_tokens:max}),...(provider==='openrouter'?{provider:{allow_fallbacks:false}}:{})};}
const r=await fetch(url,{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify(body),signal});if(!r.ok)throw new Error('Provider HTTP '+r.status);const d:any=await r.json();if(d.candidates?.[0]?.finishReason==='MAX_TOKENS'||d.stop_reason==='max_tokens'||d.choices?.[0]?.finish_reason==='length')throw new Error('Output token limit exceeded');const text=d.candidates?.[0]?.content?.parts?.filter((p:any)=>!p.thought).map((p:any)=>p.text||'').join('')||d.content?.filter((p:any)=>p.type==='text').map((p:any)=>p.text).join('')||d.choices?.[0]?.message?.content;if(!text)throw new Error('No text returned');return clean({text,usage:{inputTokens:d.usageMetadata?.promptTokenCount||d.usage?.input_tokens||d.usage?.prompt_tokens||0,outputTokens:d.usageMetadata?.candidatesTokenCount||d.usage?.output_tokens||d.usage?.completion_tokens||0}});
};
try{const output=await executeGraph(graph,process.argv.slice(2).join(' ')||'Hello',{signal,generate,emit:e=>{events.push(clean(e));console.error(e.type,e.nodeId||'');}});console.log(output);}finally{writeFileSync('trace.json',JSON.stringify(events,null,2),{mode:0o600});}
`;

const exportBrowser = String.raw`import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
try{process.loadEnvFile('.env');}catch{}
let busy=false;
const html='<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Agent app</title><style>:root{color-scheme:light dark}body{font:16px system-ui;max-width:760px;margin:8vh auto;padding:24px}textarea{box-sizing:border-box;width:100%;padding:16px;border:1px solid #8888;border-radius:14px;font:inherit}button{padding:12px 24px;border:0;border-radius:20px;margin:16px 0;cursor:pointer}pre{white-space:pre-wrap;line-height:1.6;padding:24px;border:1px solid #8888;border-radius:14px}</style><h1>Your agent app</h1><p>Runs the exported graph with your server-side provider credential.</p><form><label for="input">Your request</label><textarea id="input" required rows="6" placeholder="What would you like help with?"></textarea><button>Run workflow</button></form><pre id="output" aria-live="polite">Ready.</pre><script>document.querySelector("form").onsubmit=async(e)=>{e.preventDefault();const button=document.querySelector("button"),output=document.querySelector("pre");button.disabled=true;output.textContent="Running…";try{const r=await fetch("/run",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({input:document.querySelector("textarea").value})});const result=await r.json();if(!r.ok)throw new Error(result.error);output.textContent=result.output;}catch(error){output.textContent=error.message;}finally{button.disabled=false;}};</script></html>';
createServer(async(req,res)=>{
 if(!['127.0.0.1:8080','localhost:8080'].includes(req.headers.host||'')){res.writeHead(403);return res.end();}
 if(req.headers.origin&&!['http://127.0.0.1:8080','http://localhost:8080'].includes(req.headers.origin)){res.writeHead(403);return res.end();}
 res.setHeader('X-Content-Type-Options','nosniff');
 if(req.method==='GET'&&req.url==='/'){res.setHeader('Content-Type','text/html; charset=utf-8');return res.end(html);}
 if(req.method!=='POST'||req.url!=='/run'||req.headers['content-type']!=='application/json'){res.writeHead(404);return res.end();}
 res.setHeader('Content-Type','application/json');
 if(busy){res.writeHead(429);return res.end(JSON.stringify({error:'One run is already active. Please wait.'}));}
 let body='';for await(const chunk of req){body+=chunk;if(body.length>50000){res.writeHead(413);return res.end(JSON.stringify({error:'Input too large'}));}}
 let input:string;try{input=JSON.parse(body).input;if(typeof input!=='string'||!input.trim()||input.length>40000)throw new Error();}catch{res.writeHead(400);return res.end(JSON.stringify({error:'Add a text input under 40,000 characters.'}));}
 busy=true;const child=spawn(process.execPath,['--import','tsx','app.ts',input],{env:process.env,stdio:['ignore','pipe','pipe'],timeout:180000});let out='',err='';child.stdout.on('data',b=>{out+=b;if(out.length>150000)child.kill('SIGKILL');});child.stderr.on('data',b=>{err+=b;});child.on('error',()=>{busy=false;res.writeHead(500);res.end(JSON.stringify({error:'Could not start the runtime'}));});child.on('close',code=>{busy=false;if(res.writableEnded)return;if(code!==0){res.writeHead(400);res.end(JSON.stringify({error:'Workflow did not complete. Check the local terminal and trace.json.'}));}else res.end(JSON.stringify({output:out.trim()}));});
}).listen(8080,'127.0.0.1',()=>console.log('Agent app: http://127.0.0.1:8080'));
`;
