import { lstat, readdir } from "node:fs/promises";
import path from "node:path";
import { tenantRoot, tenantValue, authEnabled, dataRoot } from "./tenant.js";
import { readdirSync, lstatSync } from "node:fs";

export const TENANT_LIMIT = 256 * 1024 * 1024, APP_LIMIT = 1024 * 1024 * 1024;
/** Count stored bytes without reading data or following source symlinks. */
function storedBytes(root: string, limit: number): number {
  let bytes = 0, entries = 0;
  const walk = (dir: string) => {
    let names: string[];
    try { names = readdirSync(dir); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
    for (const name of names) {
      if (++entries > 100000) throw new Error("Stored file count limit reached.");
      const file = path.join(dir, name);
      let stat;
      try { stat = lstatSync(file); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") continue; throw error; }
      if (stat.isDirectory() && !stat.isSymbolicLink()) walk(file); else bytes += stat.size;
      if (bytes > limit) throw new Error("Persistent storage limit reached. Existing data was preserved.");
    }
  };
  walk(root); return bytes;
}
export function checkPersistentSpace(extra = 0) {
  if (!authEnabled()) return;
  if (storedBytes(tenantRoot(), TENANT_LIMIT) + extra > TENANT_LIMIT || storedBytes(dataRoot, APP_LIMIT) + extra > APP_LIMIT)
    throw new Error("Persistent storage limit reached. Existing data was preserved.");
}

export async function directoryBytes(root: string, limit = 256 * 1024 * 1024): Promise<number> {
  let bytes = 0, entries = 0;
  async function walk(directory: string) {
    let items;
    try { items = await readdir(directory, { withFileTypes: true }); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
    for (const item of items) {
      if (++entries > 30000) throw new Error("Workspace has too many stored files.");
      const file = path.join(directory, item.name);
      let stat;
      // Git atomically renames/removes its pack and lock files while the size
      // monitor walks. Missing entries are not stored bytes; all other failures
      // and every byte/count cap still fail closed. Publication is rechecked.
      try { stat = await lstat(file); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") continue; throw error; }
      if (stat.isDirectory() && !stat.isSymbolicLink()) await walk(file);
      else bytes += stat.size;
      if (bytes > limit) throw new Error("Workspace storage limit reached. Use a smaller repository or source folder.");
    }
  }
  await walk(root); return bytes;
}
export async function checkWorkspaceSpace(additional = 0) {
  if (!authEnabled()) return;
  const limit = 256 * 1024 * 1024;
  if (additional + await directoryBytes(tenantRoot(), limit) > limit) throw new Error("Workspace storage limit reached.");
  checkPersistentSpace(additional);
}
let activeImports = 0;
export async function withImportSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (!authEnabled()) return fn();
  const slot = tenantValue("import-slot", () => ({ active: false }));
  if (slot.active || activeImports >= 2) throw new Error("An import is already running. Please retry after it finishes.");
  slot.active = true; activeImports++;
  try { await checkWorkspaceSpace(); return await fn(); }
  finally { slot.active = false; activeImports--; }
}
