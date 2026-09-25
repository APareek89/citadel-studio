// Node 18+. Server-side only. Dependency-free, best-effort tracing.
import { randomUUID } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
const context = new AsyncLocalStorage();
const bounded = value => {
  if (value === undefined) return undefined;
  try { const serialized = JSON.stringify(value); return serialized.length > 20000 ? serialized.slice(0,19950)+' [truncated]' : value; }
  catch { return '[not JSON serializable]'; }
};
export class WorkbenchTrace {
  constructor(name, {url=process.env.WORKBENCH_URL, token=process.env.WORKBENCH_TOKEN, input}={}) {
    this.name=name; this.url=url; this.token=token; this.input=bounded(input); this.traceId=randomUUID();
    if(!url||!token) throw new Error('Set server-side WORKBENCH_URL and WORKBENCH_TOKEN');
  }
  async send(spans, status, output) {
    try {
      const r=await fetch(this.url,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+this.token},body:JSON.stringify({traceId:this.traceId,name:this.name,input:this.input,spans,status,output:bounded(output)}),signal:AbortSignal.timeout(3000)});
      if(!r.ok) console.warn('[Workbench] Trace delivery rejected (HTTP '+r.status+'). Check the connection.');
    } catch { console.warn('[Workbench] Trace delivery unavailable; application execution continues.'); }
  }
  async span(name, operation, {role='tool',input,nodeId,source,model}={}) {
    const span={id:randomUUID(),name,parentId:context.getStore()?.spanId,role,input:bounded(input),nodeId,source,model,status:'running',startTime:new Date().toISOString()};
    await this.send([span]);
    return context.run({spanId:span.id},async()=>{
      try {const result=await operation();await this.send([{...span,status:'completed',endTime:new Date().toISOString(),output:bounded(result)}]);return result;}
      catch(error){await this.send([{...span,status:'failed',endTime:new Date().toISOString(),error:String(error.message||error).slice(0,20000)}]);throw error;}
    });
  }
  async run(operation) {
    const root={id:randomUUID(),name:this.name,role:'orchestrator',input:this.input,status:'running',startTime:new Date().toISOString()};
    await this.send([root],'running');
    return context.run({spanId:root.id},async()=>{
      try {const result=await operation();await this.send([{...root,status:'completed',endTime:new Date().toISOString(),output:bounded(result)}],'completed',result);return result;}
      catch(error){await this.send([{...root,status:'failed',endTime:new Date().toISOString(),error:String(error.message||error).slice(0,20000)}],'failed');throw error;}
    });
  }
}
