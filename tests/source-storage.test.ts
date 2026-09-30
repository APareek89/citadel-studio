import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import {
  createSourceBundleStore,
  persistSourceBundle,
  hydrateSourceBundle,
  type SourceBundleRef,
} from "../server/source-storage.js";
const A = "550e8400-e29b-41d4-a716-446655440000",
  B = "550e8400-e29b-41d4-a716-446655440001";
const input = [{ path: "src/main.ts", content: "export const value = 1;\n" }];
function fixture() {
  const objects = new Map<
    string,
    { raw: Buffer; metadata: Record<string, string>; checksum: string }
  >();
  const calls: (GetObjectCommand | PutObjectCommand)[] = [];
  let alter: ((value: any) => any) | undefined;
  const store = createSourceBundleStore("portfolio-citadel-source-test", {
    async send(command) {
      calls.push(command);
      if (command instanceof PutObjectCommand) {
        assert.equal(command.input.IfNoneMatch, "*");
        assert.equal(command.input.ExpectedBucketOwner, "511833557379");
        assert.equal(command.input.ServerSideEncryption, "AES256");
        objects.set(command.input.Key!, {
          raw: Buffer.from(command.input.Body as Buffer),
          metadata: command.input.Metadata!,
          checksum: command.input.ChecksumSHA256!,
        });
        return { VersionId: "version-one" };
      }
      assert.equal(command.input.VersionId, "version-one");
      assert.equal(command.input.ChecksumMode, "ENABLED");
      const item = objects.get(command.input.Key!)!;
      const response = {
        VersionId: "version-one",
        ContentLength: item.raw.length,
        Metadata: item.metadata,
        ChecksumSHA256: item.checksum,
        Body: Readable.from([item.raw]),
      };
      return alter ? alter(response) : response;
    },
  });
  return {
    store,
    calls,
    objects,
    change(fn: (value: any) => any) {
      alter = fn;
    },
  };
}
test("source bundle saves privately, verifies exact version and hydrates canonical bytes", async () => {
  const f = fixture();
  const ref = await f.store.persist(A, [
    ...input,
    { path: "README.md", content: "Fixture" },
  ]);
  assert.equal(f.calls.length, 2);
  assert.match(
    ref.key,
    new RegExp(`^private/users/${A}/uploads/[a-f0-9-]+\\.json$`),
  );
  assert.equal(ref.ownerId, A);
  assert.equal(ref.versionId, "version-one");
  assert.match(ref.sha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(await f.store.hydrate(A, ref), [
    { path: "README.md", content: "Fixture" },
    ...input,
  ]);
  assert.equal(f.calls.length, 3);
});
test("foreign owner and forged references reject before any storage request", async () => {
  const f = fixture();
  const ref = await f.store.persist(A, input),
    n = f.calls.length;
  for (const altered of [
    ref,
    { ...ref, ownerId: B },
    { ...ref, ownerId: B, key: ref.key.replace(A, B) },
  ]) {
    if (altered.ownerId === B && altered.key.includes(B))
      await assert.rejects(f.store.hydrate(A, altered));
    else await assert.rejects(f.store.hydrate(B, altered));
  }
  for (const altered of [
    { ...ref, versionId: "null" },
    { ...ref, key: ref.key + "/extra" },
    { ...ref, bytes: 99_000_000 },
    { ...ref, sha256: "x" },
    { ...ref, key: ref.key.replace("uploads/", "uploads/../") },
  ])
    await assert.rejects(f.store.hydrate(A, altered));
  assert.equal(f.calls.length, n);
});
test("wrong version, owner metadata, checksum, truncated and expanded bodies never hydrate", async () => {
  for (const alter of [
    (v: any) => ({ ...v, VersionId: "other-version" }),
    (v: any) => ({ ...v, Metadata: { ...v.Metadata, owner: B } }),
    (v: any) => ({ ...v, ChecksumSHA256: "invalid" }),
    (v: any) => ({ ...v, Body: Readable.from([Buffer.from("{}")]) }),
    (v: any) => ({
      ...v,
      Body: Readable.from([Buffer.alloc(v.ContentLength + 1)]),
    }),
  ]) {
    const f = fixture(),
      ref = await f.store.persist(A, input);
    f.change(alter);
    await assert.rejects(f.store.hydrate(A, ref), /could not be verified/);
  }
});
test("unsafe or excessive source never causes PutObject", async () => {
  const f = fixture();
  for (const entries of [
    [],
    [{ path: "../escape.ts", content: "x" }],
    [{ path: ".env", content: "x" }],
    [{ path: "src/key.pem", content: "x" }],
    [
      { path: "a", content: "x" },
      { path: "a/file.ts", content: "x" },
    ],
    [
      { path: "A.ts", content: "x" },
      { path: "a.ts", content: "x" },
    ],
    [{ path: "x.ts", content: "\0" }],
    [{ path: "x.ts", content: "\ud800" }],
    [{ path: "x.ts", content: "x".repeat(900001) }],
    Array.from({ length: 501 }, (_, i) => ({ path: `${i}.ts`, content: "x" })),
    Array.from({ length: 12 }, (_, i) => ({
      path: `${i}.ts`,
      content: "x".repeat(900000),
    })),
  ])
    await assert.rejects(f.store.persist(A, entries));
  await assert.rejects(f.store.persist("../invalid", input));
  assert.equal(f.calls.length, 0);
});
test("failed readback prevents a successful upload reference, raw provider errors stay private", async () => {
  const f = fixture();
  f.change(() => {
    throw new Error("private transport detail");
  });
  await assert.rejects(
    f.store.persist(A, input),
    (error) =>
      String(error).includes("could not be verified") &&
      !String(error).includes("private transport detail"),
  );
  const g = createSourceBundleStore("test-bucket", {
    async send() {
      throw new Error("private transport detail");
    },
  });
  await assert.rejects(
    g.persist(A, input),
    (error) =>
      String(error).includes("could not be saved") &&
      !String(error).includes("private transport detail"),
  );
});
test("missing hosted configuration fails; fixture disable is explicit and forbidden in production", async () => {
  const names = [
    "PORTFOLIO_STORAGE_BUCKET",
    "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY",
    "AWS_REGION",
    "WORKBENCH_STORAGE_MODE",
    "NODE_ENV",
  ];
  const before = Object.fromEntries(
    names.map((name) => [name, process.env[name]]),
  );
  try {
    for (const name of names) delete process.env[name];
    await assert.rejects(persistSourceBundle(A, input), /not configured/);
    process.env.WORKBENCH_STORAGE_MODE = "fixture";
    assert.equal(await persistSourceBundle(A, input), undefined);
    process.env.NODE_ENV = "production";
    await assert.rejects(persistSourceBundle(A, input), /forbidden/);
    const ref = {
      ownerId: A,
      key: `private/users/${A}/uploads/${A}.json`,
      versionId: "version-one",
      sha256: "0".repeat(64),
      bytes: 20,
    } as SourceBundleRef;
    await assert.rejects(hydrateSourceBundle(B, ref), /not owned/);
  } finally {
    for (const name of names)
      if (before[name] === undefined) delete process.env[name];
      else process.env[name] = before[name];
  }
});
