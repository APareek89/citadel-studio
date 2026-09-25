import { readFileSync } from "node:fs";
const env = Object.fromEntries(
  readFileSync("/etc/agent-workbench/app.env", "utf8")
    .split(/\r?\n/)
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => {
      const equals = line.indexOf("=");
      return [line.slice(0, equals), line.slice(equals + 1)];
    }),
);
const host = new URL(env.WORKBENCH_PUBLIC_ORIGIN).host;
let ready = false;
for (let attempt = 0; attempt < 20; attempt++) {
  try {
    const response = await fetch("http://127.0.0.1:3001/api/health", {
      headers: {
        Host: host,
        "X-Workbench-Proxy-Token": env.WORKBENCH_PROXY_TOKEN,
      },
      signal: AbortSignal.timeout(1000),
    });
    const health = await response.json();
    if (response.ok && health.ok && health.uiEntry) {
      ready = true;
      break;
    }
  } catch {}
  await new Promise((resolve) => setTimeout(resolve, 500));
}
if (!ready)
  throw new Error(
    "Application did not become healthy. Inspect the service log before sharing its URL.",
  );
console.log(
  "Authenticated backend health verified; public TLS/auth still require external verification.",
);
