import { AsyncLocalStorage } from "node:async_hooks";
import { mkdirSync, lstatSync, realpathSync, chmodSync } from "node:fs";
import path from "node:path";

export const authEnabled = () => process.env.PORTFOLIO_AUTH_ENABLED !== "0";
export const dataRoot = path.resolve(process.env.WORKBENCH_DATA_DIR || ".local");
export interface Tenant { id: string; root: string; values: Map<string, unknown> }
const context = new AsyncLocalStorage<Tenant>();
const tenants = new Map<string, Tenant>();

function privateRoot(root: string) {
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const stat = lstatSync(root);
  if (!authEnabled() && stat.isDirectory() && !stat.isSymbolicLink() && (!process.getuid || stat.uid === process.getuid())) chmodSync(root, 0o700);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (authEnabled() && (stat.mode & 0o077)) || (process.getuid && stat.uid !== process.getuid()))
    throw new Error("Workspace storage must be a private real directory.");
  return realpathSync(root);
}
function load(id: string): Tenant {
  const basePath = id === "fixture" ? path.resolve(process.env.WORKBENCH_DATA_DIR || ".local") : dataRoot;
  const cacheKey = basePath + ":" + id;
  let tenant = tenants.get(cacheKey);
  if (!tenant) {
    const base = privateRoot(basePath);
    const root = id === "fixture" ? base : privateRoot(path.join(privateRoot(path.join(base, "users")), id));
    tenant = { id, root, values: new Map() };
    tenants.set(cacheKey, tenant);
  }
  return tenant;
}
export function requireTenant(): Tenant {
  const tenant = context.getStore();
  if (tenant) return tenant;
  if (!authEnabled()) return load("fixture");
  throw new Error("A verified workspace owner is required.");
}
export function withTenant<T>(id: string, fn: () => T): T {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id))
    throw new Error("Invalid workspace owner.");
  return context.run(load(id), fn);
}
export const tenantRoot = () => requireTenant().root;
export const tenantKey = (id: string) => `${requireTenant().id}:${id}`;
export function tenantValue<T>(name: string, create: () => T): T {
  const tenant = requireTenant();
  if (!tenant.values.has(name)) tenant.values.set(name, create());
  return tenant.values.get(name) as T;
}
export function tenantMap<K, V>(name: string): Map<K, V> {
  return new Proxy(new Map<K, V>(), { get(_target, key) {
    const map = tenantValue(name, () => new Map<K, V>());
    const value = Reflect.get(map, key, map);
    return typeof value === "function" ? value.bind(map) : value;
  } });
}
export function tenantSet<T>(name: string): Set<T> {
  return new Proxy(new Set<T>(), { get(_target, key) {
    const set = tenantValue(name, () => new Set<T>());
    const value = Reflect.get(set, key, set);
    return typeof value === "function" ? value.bind(set) : value;
  } });
}
export const hasTenant = () => !!context.getStore() || !authEnabled();
/** Bind callbacks explicitly: EventEmitter and shared queues may invoke them in another actor's context. */
export function bindTenant<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  const tenant = requireTenant();
  return (...args) => context.run(tenant, () => fn(...args));
}
export function assertTenantPath(root: string): string {
  if (!authEnabled()) return root;
  const resolved = realpathSync(root), base = tenantRoot();
  if (lstatSync(root).isSymbolicLink() || !resolved.startsWith(base + path.sep))
    throw new Error("Source is outside this workspace.");
  return resolved;
}
