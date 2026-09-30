import { readFileSync } from "node:fs";
import pg from "pg";
let pool: pg.Pool | undefined;
export function database(): pg.Pool {
  if (pool) return pool;
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error("Authentication database is not configured.");
  const url = new URL(raw);
  const fixture = process.env.DATABASE_SSL === "disable" && ["127.0.0.1", "localhost"].includes(url.hostname);
  for (const key of ["sslmode", "sslrootcert", "sslcert", "sslkey"]) url.searchParams.delete(key);
  const caFile = process.env.DATABASE_SSL_CA_FILE;
  if (!fixture && !caFile) throw new Error("Verified database TLS requires a CA file.");
  pool = new pg.Pool({ connectionString: url.toString(), max: 6, connectionTimeoutMillis: 8000,
    ssl: fixture ? false : { ca: readFileSync(caFile!, "utf8"), rejectUnauthorized: true } });
  pool.on("error", () => console.warn("[database] connection unavailable"));
  return pool;
}
export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(sql: string, args: unknown[] = []): Promise<T[]> {
  return (await database().query<T>(sql, args)).rows;
}
export async function migrateAuth() {
  await query(`CREATE TABLE IF NOT EXISTS users (
    id uuid PRIMARY KEY, email text NOT NULL, password_hash text NOT NULL,
    name text, created_at timestamptz NOT NULL DEFAULT now(), last_sign_in_at timestamptz,
    disabled_at timestamptz);
    CREATE UNIQUE INDEX IF NOT EXISTS users_email_normalized ON users(lower(email));
    CREATE TABLE IF NOT EXISTS auth_sessions (
      id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id),
      expires_at timestamptz NOT NULL, revoked_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now());
    CREATE INDEX IF NOT EXISTS auth_sessions_user ON auth_sessions(user_id);`);
}
