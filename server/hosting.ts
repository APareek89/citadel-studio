import { createHash, timingSafeEqual } from "node:crypto";

export interface HostingConfig {
  publicOrigin?: string;
  publicHost?: string;
  proxyToken?: string;
}

export function readHostingConfig(
  env: NodeJS.ProcessEnv = process.env,
): HostingConfig {
  if (!env.WORKBENCH_PUBLIC_ORIGIN) return {};
  let url: URL;
  try {
    url = new URL(env.WORKBENCH_PUBLIC_ORIGIN);
  } catch {
    throw new Error("WORKBENCH_PUBLIC_ORIGIN must be a valid HTTPS origin.");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw new Error(
      "WORKBENCH_PUBLIC_ORIGIN must be an HTTPS origin without credentials, path, query or fragment.",
    );
  const proxyToken = env.WORKBENCH_PROXY_TOKEN;
  if ((env.PORTFOLIO_AUTH_ENABLED ?? process.env.PORTFOLIO_AUTH_ENABLED) === "0" && (
    !proxyToken ||
    proxyToken.length < 32 ||
    proxyToken.length > 512 ||
    /\s/.test(proxyToken)
  ))
    throw new Error(
      "Hosted mode requires a random WORKBENCH_PROXY_TOKEN of 32–512 non-whitespace characters.",
    );
  if (env.WORKBENCH_DEV === "1")
    throw new Error(
      "Hosted mode requires a production build; development serving is disabled.",
    );
  return { publicOrigin: url.origin, publicHost: url.host, proxyToken };
}

export const hosting = readHostingConfig();
export function validProxyToken(value: unknown): boolean {
  if (!hosting.proxyToken || typeof value !== "string" || value.length > 512)
    return false;
  const digest = (text: string) => createHash("sha256").update(text).digest();
  return timingSafeEqual(digest(value), digest(hosting.proxyToken));
}
