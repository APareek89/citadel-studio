import { createHash, randomUUID } from "node:crypto";
import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

export interface SourceFile {
  path: string;
  content: string;
}
export interface SourceBundleRef {
  ownerId: string;
  key: string;
  versionId: string;
  sha256: string;
  bytes: number;
}
export interface SourceObjectTransport {
  send(command: GetObjectCommand | PutObjectCommand): Promise<any>;
}
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MAX_BYTES = 10 * 1024 * 1024,
  MAX_JSON = 16 * 1024 * 1024;
const excluded =
  /^(?:\.git|\.env.*|\.ssh|\.aws|\.npmrc|\.pypirc|\.netrc|node_modules|vendor|dist|build|coverage|\.next|\.nuxt|\.cache|\.venv|venv|__pycache__|target)$/i;
const sensitive =
  /(?:secret|credential|access.?keys)|\.(?:pem|key|p12|pfx|keystore)$/i;
const digest = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
const fail = () =>
  new Error("Source bundle is invalid or is not owned by this account.");
function owner(value: string): void {
  if (!UUID.test(value)) throw fail();
}
function files(value: unknown): SourceFile[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 500)
    throw fail();
  let bytes = 0;
  const seen = new Set<string>();
  const result = value.map((entry): SourceFile => {
    if (
      !entry ||
      typeof entry !== "object" ||
      Object.keys(entry).sort().join(",") !== "content,path" ||
      typeof entry.path !== "string" ||
      typeof entry.content !== "string"
    )
      throw fail();
    const parts = entry.path.split("/");
    if (
      !entry.path ||
      entry.path.length > 512 ||
      entry.path !== entry.path.normalize("NFC") ||
      /[\\:%?*|<>\x00-\x1f\x7f-\x9f]/.test(entry.path) ||
      parts.length > 16 ||
      parts.some(
        (p: string) =>
          !p ||
          p === "." ||
          p === ".." ||
          p !== p.trim() ||
          Buffer.byteLength(p) > 255 ||
          /[. ]$/.test(p) ||
          excluded.test(p) ||
          sensitive.test(p) ||
          /^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(p),
      )
    )
      throw fail();
    if (
      /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(entry.content) ||
      Buffer.from(entry.content).toString("utf8") !== entry.content
    )
      throw fail();
    const size = Buffer.byteLength(entry.content);
    bytes += size;
    const key = entry.path.toLowerCase();
    if (size > 900_000 || bytes > MAX_BYTES || seen.has(key)) throw fail();
    seen.add(key);
    return { path: entry.path, content: entry.content };
  });
  for (const key of seen) {
    const parts = key.split("/");
    for (let i = 1; i < parts.length; i++)
      if (seen.has(parts.slice(0, i).join("/"))) throw fail();
  }
  return result.sort((a, b) =>
    a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
  );
}
function reference(actor: string, ref: SourceBundleRef): void {
  owner(actor);
  if (
    !ref ||
    Object.keys(ref).sort().join(",") !==
      "bytes,key,ownerId,sha256,versionId" ||
    ref.ownerId !== actor ||
    typeof ref.key !== "string" ||
    !ref.key.startsWith(`private/users/${actor}/uploads/`) ||
    !UUID.test(
      ref.key
        .slice(`private/users/${actor}/uploads/`.length)
        .replace(/\.json$/, ""),
    ) ||
    !ref.key.endsWith(".json") ||
    typeof ref.versionId !== "string" ||
    ref.versionId === "null" ||
    !/^[A-Za-z0-9+/=._-]{1,1024}$/.test(ref.versionId) ||
    !/^[a-f0-9]{64}$/.test(ref.sha256) ||
    !Number.isSafeInteger(ref.bytes) ||
    ref.bytes < 1 ||
    ref.bytes > MAX_JSON
  )
    throw fail();
}
async function bodyBytes(body: any, expected: number): Promise<Buffer> {
  if (!body || typeof body[Symbol.asyncIterator] !== "function") throw fail();
  const chunks: Buffer[] = [];
  let length = 0;
  try {
    for await (const chunk of body) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      length += bytes.length;
      if (length > expected || length > MAX_JSON) throw fail();
      chunks.push(bytes);
    }
  } finally {
    body.destroy?.();
  }
  if (length !== expected) throw fail();
  return Buffer.concat(chunks, length);
}

/** Small injected transport supports offline tests; production always uses the fixed AWS region. */
export function createSourceBundleStore(
  bucket: string,
  transport: SourceObjectTransport,
) {
  if (
    !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket) ||
    bucket.includes("..")
  )
    throw new Error("Source storage configuration is invalid.");
  const hydrate = async (
    actor: string,
    ref: SourceBundleRef,
  ): Promise<SourceFile[]> => {
    reference(actor, ref); // Never reach S3 for a foreign reference.
    try {
      const response = await transport.send(
        new GetObjectCommand({
          Bucket: bucket,
          Key: ref.key,
          VersionId: ref.versionId,
          ChecksumMode: "ENABLED",
          ExpectedBucketOwner: "511833557379",
        }),
      );
      if (
        response.VersionId !== ref.versionId ||
        response.ContentLength !== ref.bytes ||
        response.Metadata?.owner !== actor ||
        response.Metadata?.sha256 !== ref.sha256
      ) {
        response.Body?.destroy?.();
        throw fail();
      }
      const raw = await bodyBytes(response.Body, ref.bytes);
      if (
        digest(raw) !== ref.sha256 ||
        (response.ChecksumSHA256 &&
          response.ChecksumSHA256 !==
            Buffer.from(ref.sha256, "hex").toString("base64"))
      )
        throw fail();
      const parsed = JSON.parse(raw.toString("utf8"));
      if (
        !parsed ||
        Object.keys(parsed).sort().join(",") !== "files,ownerId,version" ||
        parsed.version !== 1 ||
        parsed.ownerId !== actor
      )
        throw fail();
      return files(parsed.files);
    } catch {
      throw new Error(
        "Private source bundle could not be verified. Retry after checking storage availability.",
      );
    }
  };
  return {
    async persist(
      actor: string,
      input: SourceFile[],
    ): Promise<SourceBundleRef> {
      owner(actor);
      const accepted = files(input);
      const raw = Buffer.from(
        JSON.stringify({ version: 1, ownerId: actor, files: accepted }),
      );
      if (raw.length > MAX_JSON) throw fail();
      const sha256 = digest(raw),
        key = `private/users/${actor}/uploads/${randomUUID()}.json`;
      let versionId: string;
      try {
        const response = await transport.send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: key,
            Body: raw,
            ContentLength: raw.length,
            ContentType: "application/json",
            CacheControl: "private, no-store",
            ServerSideEncryption: "AES256",
            ChecksumSHA256: Buffer.from(sha256, "hex").toString("base64"),
            IfNoneMatch: "*",
            Metadata: { owner: actor, sha256 },
            ExpectedBucketOwner: "511833557379",
          }),
        );
        versionId = response.VersionId;
      } catch {
        throw new Error(
          "Private source upload could not be saved. No workspace was published.",
        );
      }
      const ref = { ownerId: actor, key, versionId, sha256, bytes: raw.length };
      reference(actor, ref);
      await hydrate(actor, ref);
      return ref;
    },
    hydrate,
  };
}
let runtime: ReturnType<typeof createSourceBundleStore> | undefined;
function configured() {
  if (runtime) return runtime;
  const bucket = process.env.PORTFOLIO_STORAGE_BUCKET,
    accessKeyId = process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
  if (
    !bucket ||
    !accessKeyId ||
    !secretAccessKey ||
    process.env.AWS_REGION !== "ap-south-1"
  )
    throw new Error(
      "Private source storage is not configured. Upload is unavailable.",
    );
  const client = new S3Client({
    region: "ap-south-1",
    credentials: { accessKeyId, secretAccessKey },
    endpoint: "https://s3.ap-south-1.amazonaws.com",
    followRegionRedirects: false,
    maxAttempts: 1,
  });
  runtime = createSourceBundleStore(bucket, {
    send: (command) =>
      command instanceof GetObjectCommand
        ? client.send(command, { abortSignal: AbortSignal.timeout(30_000) })
        : client.send(command, { abortSignal: AbortSignal.timeout(30_000) }),
  });
  return runtime;
}
export async function persistSourceBundle(
  ownerId: string,
  input: SourceFile[],
): Promise<SourceBundleRef | undefined> {
  if (process.env.WORKBENCH_STORAGE_MODE === "fixture") {
    if (process.env.NODE_ENV === "production")
      throw new Error("Fixture source storage is forbidden in production.");
    owner(ownerId);
    files(input);
    return undefined;
  }
  return configured().persist(ownerId, input);
}
export async function hydrateSourceBundle(
  ownerId: string,
  ref: SourceBundleRef,
): Promise<SourceFile[]> {
  reference(ownerId, ref);
  return configured().hydrate(ownerId, ref);
}
