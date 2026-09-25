import { build } from "esbuild";

// Keep one directory level below the repository/release root: the imported
// adapter resolves its workspace from import.meta.url. Dependencies remain
// external so production installs select the correct native Linux packages.
await build({
  entryPoints: ["server/index.ts"],
  outfile: "build-server/index.mjs",
  bundle: true,
  packages: "external",
  platform: "node",
  target: "node22",
  format: "esm",
  sourcemap: false,
  logLevel: "info",
});
