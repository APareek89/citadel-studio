import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
const exec = promisify(execFile);
export async function dockerAvailable() {
  try {
    await exec("docker", ["image", "inspect", "node:22-alpine"], {
      timeout: 3000,
      maxBuffer: 1024 * 1024,
    });
    return true;
  } catch {
    return false;
  }
}
export async function runCode(
  code: string,
  input: string,
  signal: AbortSignal,
): Promise<string> {
  if (!(await dockerAvailable()))
    throw new Error(
      "Docker with the node:22-alpine image is required for custom code. Start Docker and run docker pull node:22-alpine.",
    );
  const name = "workbench-" + randomUUID();
  try {
    return await new Promise<string>((resolve, reject) => {
      const script = `const fs=require('fs'); const input=fs.readFileSync(0,'utf8'); (async()=>{const run=async(input)=>{${code}\n}; const result=await run(input); process.stdout.write(typeof result==='string'?result:JSON.stringify(result));})().catch(()=>{process.stderr.write('Code execution failed');process.exit(1);});`;
      const child = spawn(
        "docker",
        [
          "run",
          "--name",
          name,
          "--rm",
          "-i",
          "--network=none",
          "--read-only",
          "--cap-drop=ALL",
          "--security-opt=no-new-privileges",
          "--pids-limit=32",
          "--memory=128m",
          "--cpus=0.5",
          "--user=65534:65534",
          "--stop-timeout=1",
          "node:22-alpine",
          "node",
          "-e",
          script,
        ],
        { signal, timeout: 15000, stdio: ["pipe", "pipe", "pipe"] },
      );
      let output = "";
      child.stdout.on("data", (b) => {
        output += b;
        if (output.length > 100000) {
          child.kill("SIGKILL");
          reject(new Error("Code output limit exceeded"));
        }
      });
      child.stderr.resume();
      child.on("error", reject);
      child.on("close", (status) =>
        status === 0
          ? resolve(output)
          : reject(new Error("Sandboxed code failed or was cancelled")),
      );
      child.stdin.end(input);
    });
  } finally {
    await exec("docker", ["rm", "-f", name], { timeout: 5000 }).catch(() => {});
  }
}
