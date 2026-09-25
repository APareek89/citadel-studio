import { readFileSync } from "node:fs";
import { request } from "node:http";
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
    const health = await new Promise((resolve, reject) => {
      const req = request(
        "http://127.0.0.1:3001/api/health",
        {
          headers: {
            Host: host,
            "X-Workbench-Proxy-Token": env.WORKBENCH_PROXY_TOKEN,
          },
          timeout: 1000,
        },
        (response) => {
          let body = "";
          response.on("data", (chunk) => {
            body += chunk;
            if (body.length > 10000)
              req.destroy(new Error("Oversized health response"));
          });
          response.on("error", reject);
          response.on("end", () => {
            try {
              resolve(response.statusCode === 200 ? JSON.parse(body) : null);
            } catch (error) {
              reject(error);
            }
          });
        },
      );
      req.on("timeout", () =>
        req.destroy(new Error("Health request timed out")),
      );
      req.on("error", reject);
      req.end();
    });
    if (health?.ok && health.uiEntry) {
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
