import { readFileSync } from "node:fs";

// Deliberately accept simple KEY=value files only. Do not source secrets in a
// shell or pass their values on process command lines.
function readEnv(file) {
  const values = {};
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const match = line.match(/^([A-Z_][A-Z_0-9]*)=(\S+)$/);
    if (!match || Object.hasOwn(values, match[1]))
      throw new Error(
        "Environment files must contain unique, unquoted KEY=value entries without whitespace.",
      );
    values[match[1]] = match[2];
  }
  return values;
}
const app = readEnv("/etc/agent-workbench/app.env");
const proxy = readEnv("/etc/agent-workbench/caddy.env");
const origin = new URL(app.WORKBENCH_PUBLIC_ORIGIN);
if (
  origin.protocol !== "https:" ||
  origin.origin !== app.WORKBENCH_PUBLIC_ORIGIN ||
  proxy.WORKBENCH_PUBLIC_ORIGIN !== app.WORKBENCH_PUBLIC_ORIGIN
)
  throw new Error(
    "Both environment files must use the same exact HTTPS origin.",
  );
if (
  !/^[A-Za-z0-9_-]{32,512}$/.test(app.WORKBENCH_PROXY_TOKEN || "") ||
  proxy.WORKBENCH_PROXY_TOKEN !== app.WORKBENCH_PROXY_TOKEN
)
  throw new Error(
    "Both environment files must use the same newly generated proxy token.",
  );
if (
  !/^[A-Za-z0-9_-]{1,64}$/.test(proxy.WORKBENCH_AUTH_USER || "") ||
  !/^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(proxy.WORKBENCH_AUTH_HASH || "")
)
  throw new Error("Caddy requires a simple username and bcrypt password hash.");
for (const [key, required] of Object.entries({
  NODE_ENV: "production",
  WORKBENCH_DEV: "0",
  PORT: "3001",
  WORKBENCH_DATA_DIR: "/var/lib/agent-workbench",
  WORKBENCH_SECRETS_FILE: "/var/lib/agent-workbench/no-local-secrets",
}))
  if (app[key] !== required)
    throw new Error(`Unexpected hosted setting: ${key}`);
if (
  !(Number(app.WORKBENCH_SPEND_LIMIT_USD) > 0) ||
  !Number.isFinite(Number(app.WORKBENCH_SPEND_LIMIT_USD))
)
  throw new Error("Set a finite, positive model spend cap before deploying.");
console.log(
  "Hosted environment contracts validated; no secret values printed.",
);
