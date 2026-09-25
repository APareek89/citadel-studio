import {
  mkdir,
  mkdtemp,
  lstat,
  realpath,
  writeFile,
  rename,
  rm,
} from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";

export interface FolderUpload {
  name: string;
  files: { path: string; content: string }[];
}
export interface UploadedFolder {
  rootPath: string;
  name: string;
  acceptedFiles: number;
  skippedFiles: number;
  skipped: { path: string; reason: string }[];
  totalBytes: number;
}
const MAX_FILES = 500,
  MAX_BYTES = 10 * 1024 * 1024,
  MAX_FILE_BYTES = 900_000;
const excludedSegment =
  /^(?:\.git|\.env.*|\.ssh|\.aws|\.npmrc|\.pypirc|\.netrc|node_modules|vendor|dist|build|coverage|\.next|\.nuxt|\.cache|\.venv|venv|__pycache__|target)$/i;
const sensitive =
  /(?:secret|credential|access.?keys)|\.(?:pem|key|p12|pfx|keystore)$/i;
const source =
  /\.(?:[cm]?[jt]sx?|py|go|rs|java|kts?|swift|rb|php|cs|[ch]|[ch]pp|cc|scala|vue|svelte|mdx?|rst|txt|json|ya?ml|toml|ini|cfg|css|scss|sass|less|html?|xml|sql|graphql|gql|proto)$/i;

function validPath(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length > 512 ||
    !value ||
    value !== value.normalize("NFC") ||
    /[\\:%?*|<>\x00-\x1f\x7f-\x9f]/.test(value) ||
    path.posix.isAbsolute(value)
  )
    throw new Error(
      "Upload paths must be relative portable source paths without escapes or control characters.",
    );
  const parts = value.split("/");
  if (
    parts.length > 16 ||
    parts.some(
      (p) =>
        !p ||
        p === "." ||
        p === ".." ||
        p !== p.trim() ||
        Buffer.byteLength(p, "utf8") > 255 ||
        /[. ]$/.test(p) ||
        /^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(p),
    )
  )
    throw new Error(
      "Upload path contains an unsafe or unsupported path segment.",
    );
  return value;
}
async function privateDirectory(file: string): Promise<string> {
  const stat = await lstat(file);
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    (process.getuid && stat.uid !== process.getuid())
  )
    throw new Error(
      "Upload storage must be a real directory owned by the current user.",
    );
  if ((stat.mode & 0o077) !== 0)
    throw new Error(
      "Upload storage must be private to the current user (directory mode 0700).",
    );
  return realpath(file);
}

/** Store reviewed text bytes only. Uploaded code, package hooks and Git metadata never execute. */
export async function importUploadedFolder(
  value: FolderUpload,
): Promise<UploadedFolder> {
  if (
    !value ||
    typeof value.name !== "string" ||
    !value.name.trim() ||
    value.name.length > 100 ||
    /[\x00-\x1f\x7f]/.test(value.name) ||
    !Array.isArray(value.files) ||
    !value.files.length ||
    value.files.length > MAX_FILES
  )
    throw new Error("Choose a named folder containing 1–500 source files.");
  const name = value.name.trim();
  const entries: { path: string; content: string; bytes: number }[] = [];
  const names = new Set<string>();
  let incomingBytes = 0;
  // Validate the entire request, including excluded entries, before any writes.
  for (const file of value.files) {
    if (
      !file ||
      typeof file.content !== "string" ||
      Object.keys(file).some((key) => key !== "path" && key !== "content")
    )
      throw new Error(
        "Each uploaded file must contain only a relative path and text content; links and binary metadata are unsupported.",
      );
    const relative = validPath(file.path),
      key = relative.toLowerCase();
    if (names.has(key))
      throw new Error("Upload has duplicate or case-colliding paths.");
    names.add(key);
    const bytes = Buffer.byteLength(file.content, "utf8");
    incomingBytes += bytes;
    if (bytes > MAX_FILE_BYTES)
      throw new Error(
        "Each uploaded file must be at most 900,000 UTF-8 bytes.",
      );
    if (incomingBytes > MAX_BYTES)
      throw new Error("Uploaded source must be at most 10 MiB in total.");
    entries.push({ path: relative, content: file.content, bytes });
  }
  for (const name of names) {
    const segments = name.split("/");
    for (let i = 1; i < segments.length; i++)
      if (names.has(segments.slice(0, i).join("/")))
        throw new Error("Upload contains a file/directory prefix collision.");
  }
  // Browser directory inputs include a common root folder; strip it only when it matches the declared name.
  const rooted = entries.every((file) => file.path.startsWith(name + "/"));
  const accepted: typeof entries = [];
  const skipped: UploadedFolder["skipped"] = [];
  let totalBytes = 0;
  for (const file of entries) {
    const relative = rooted ? file.path.slice(name.length + 1) : file.path;
    const segments = file.path.split("/");
    let reason = "";
    if (
      segments.some(
        (segment) => excludedSegment.test(segment) || sensitive.test(segment),
      )
    )
      reason = "Excluded generated, Git or sensitive resource";
    else if (
      !source.test(relative) &&
      !/^(?:Dockerfile|Makefile|README|LICENSE|NOTICE|\.gitignore|\.gitattributes)$/i.test(
        segments.at(-1)!,
      )
    )
      reason = "Not a supported text source file";
    else if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(file.content))
      reason = "Binary or non-text content";
    if (reason) skipped.push({ path: file.path, reason });
    else {
      accepted.push({ ...file, path: relative });
      totalBytes += file.bytes;
    }
  }
  if (!accepted.length)
    throw new Error(
      "No supported non-sensitive source files remain after filtering.",
    );
  const data = path.resolve(process.env.WORKBENCH_DATA_DIR || ".local");
  await mkdir(data, { recursive: true, mode: 0o700 });
  const base = await privateDirectory(data),
    uploads = path.join(base, "uploads");
  await mkdir(uploads, { mode: 0o700 }).catch((error) => {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  });
  const root = await privateDirectory(uploads);
  let staging: string | undefined = await mkdtemp(
    path.join(root, ".incoming-"),
  );
  try {
    for (const file of accepted) {
      const destination = path.join(staging, file.path);
      await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
      await writeFile(destination, file.content, {
        encoding: "utf8",
        mode: 0o600,
        flag: "wx",
      });
    }
    const destination = path.join(root, "folder-" + randomUUID());
    await rename(staging, destination);
    staging = undefined;
    return {
      rootPath: destination,
      name,
      acceptedFiles: accepted.length,
      skippedFiles: skipped.length,
      skipped,
      totalBytes,
    };
  } finally {
    if (staging) await rm(staging, { recursive: true, force: true });
  }
}
