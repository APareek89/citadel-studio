import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import pg from "pg";
import { database } from "../server/db.js";

test("verified TLS survives connection-string SSL override parameters", async () => {
 const directory=mkdtempSync(path.join(tmpdir(),"citadel-tls-"));
 const ca=path.join(directory,"ca.pem"); writeFileSync(ca,"test CA marker; no connection is made");
 const prior={...process.env};
 try {
  process.env.DATABASE_URL="postgresql://fixture:synthetic@database.invalid/fixture?ssl=no-verify&SSLMODE=disable&sslrootcert=untrusted";
  process.env.DATABASE_SSL_CA_FILE=ca;delete process.env.DATABASE_SSL;
  const pool=database();
  try {
   const client=new pg.Client(pool.options);
   assert.deepEqual((client as unknown as {connectionParameters:{ssl:unknown}}).connectionParameters.ssl,{ca:"test CA marker; no connection is made",rejectUnauthorized:true});
  } finally { await pool.end(); }
 } finally {for(const k of Object.keys(process.env))if(!(k in prior))delete process.env[k];Object.assign(process.env,prior);rmSync(directory,{recursive:true,force:true});}
});
