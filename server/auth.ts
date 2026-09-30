import { ExpressAuth, getSession, type ExpressAuthConfig } from "@auth/express";
import Credentials from "@auth/express/providers/credentials";
import type { Express, Request, Response, NextFunction } from "express";
import { compare, hash, hashSync } from "bcryptjs";
import { randomBytes, randomUUID } from "node:crypto";
import rateLimit from "express-rate-limit";
import { query, migrateAuth } from "./db.js";
import { authEnabled, withTenant } from "./tenant.js";

export interface AuthUser { id: string; email: string; name: string | null }
const requestUsers = new WeakMap<Request, Promise<AuthUser | null>>();
const dummyHash = authEnabled() ? hashSync(randomBytes(32).toString("hex"), 12) : "";
let config: ExpressAuthConfig | undefined;
export const normalizeEmail = (value: unknown) => typeof value === "string" ? value.trim().toLowerCase() : "";
export const validPassword = (value: unknown): value is string => typeof value === "string" && value.length >= 12 && Buffer.byteLength(value) <= 72;
const validEmail = (email: string) => email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
export function authConfig(): ExpressAuthConfig {
  if (config) return config;
  if (!process.env.AUTH_SECRET || process.env.AUTH_SECRET.length < 32) throw new Error("AUTH_SECRET is required for authentication.");
  config = {
    secret: process.env.AUTH_SECRET, basePath: "/auth", trustHost: true,
    session: { strategy: "jwt", maxAge: 60 * 60 * 24 * 7 },
    providers: [Credentials({ credentials: { email: { type: "email" }, password: { type: "password" } },
      async authorize(credentials) {
        const email = normalizeEmail(credentials.email), password = typeof credentials.password === "string" ? credentials.password : "";
        if (!validEmail(email) || !password || Buffer.byteLength(password) > 72) return null;
        const user = (await query<AuthUser & { password_hash: string }>("select id,email,name,password_hash from users where lower(email)=$1 and disabled_at is null", [email]))[0];
        const matches = await compare(password, user?.password_hash || dummyHash);
        if (!user || !matches) return null;
        await query("update users set last_sign_in_at=now() where id=$1", [user.id]);
        return { id: user.id, email: user.email, name: user.name };
      } })],
    callbacks: {
      async jwt({ token, user }) {
        if (user?.id) {
          token.sub = user.id; token.sessionId = randomUUID();
          await query("insert into auth_sessions(id,user_id,expires_at) values($1,$2,now()+interval '7 days')", [token.sessionId, user.id]);
        }
        if (!token.sub || typeof token.sessionId !== "string") return null;
        const active = await query("select 1 from auth_sessions s join users u on u.id=s.user_id where s.id=$1 and s.user_id=$2 and s.revoked_at is null and s.expires_at>now() and u.disabled_at is null", [token.sessionId, token.sub]);
        return active.length ? token : null;
      },
      session({ session, token }) { if (session.user && token.sub) session.user.id = token.sub; return session; },
    },
    events: { async signOut(message) {
      if ("token" in message && typeof message.token?.sessionId === "string")
        await query("update auth_sessions set revoked_at=now() where id=$1", [message.token.sessionId]);
    } },
    logger: { error(error) { console.warn("[auth]", error.name); }, warn(code) { console.warn("[auth]", code); }, debug() {} },
  };
  return config;
}
export async function initializeAuth() {
  if (!authEnabled()) return;
  authConfig(); await migrateAuth();
}
export async function getUser(req: Request, fresh = false): Promise<AuthUser | null> {
  if (fresh) requestUsers.delete(req);
  let pending = requestUsers.get(req);
  if (!pending) {
    pending = (async () => {
      const session = await getSession(req, authConfig());
      if (!session?.user?.id) return null;
      return (await query<AuthUser>("select id,email,name from users where id=$1 and disabled_at is null", [session.user.id]))[0] || null;
    })();
    requestUsers.set(req, pending);
  }
  return pending;
}
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!authEnabled()) return next();
  try {
    const user = await getUser(req);
    if (!user) return res.status(401).json({ error: "Please sign in to continue." });
    res.locals.user = user; res.setHeader("Cache-Control", "private, no-store");
    return withTenant(user.id, next);
  } catch { return res.status(503).json({ error: "Sign-in is temporarily unavailable." }); }
}
export function sameOrigin(req: Request, res: Response, next: NextFunction) {
  if (!authEnabled() || ["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  const expected = new URL(process.env.WORKBENCH_PUBLIC_ORIGIN || process.env.APP_URL || `http://127.0.0.1:${process.env.PORT || 3001}`).origin;
  if (req.get("origin") !== expected) return res.status(403).json({ error: "This request must come from the application." });
  next();
}
export function mountAuth(app: Express) {
  app.get("/api/auth/session", async (req, res) => {
    res.setHeader("Cache-Control", "private, no-store");
    if (!authEnabled()) return res.json({ enabled: false, user: null });
    try { res.json({ enabled: true, user: await getUser(req) }); }
    catch { res.status(503).json({ error: "Sign-in is temporarily unavailable." }); }
  });
  if (!authEnabled()) return;
  const limiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 15, standardHeaders: "draft-8", legacyHeaders: false,
    skip: req => req.method === "GET", message: { error: "Too many sign-in attempts. Try again later." } });
  app.use("/auth", limiter, sameOrigin);
  // The SDK reads params[0] for its mount path; RegExp preserves that contract on Express5.
  app.use(/^\/auth\/(.*)$/, ExpressAuth(authConfig()));
  app.post("/api/auth/signup", limiter, sameOrigin, async (req, res) => {
    const email = normalizeEmail(req.body?.email), password = req.body?.password;
    if (!validEmail(email) || !validPassword(password)) return res.status(400).json({ error: "Use a valid email and a password of 12 characters or more (maximum72 UTF-8 bytes)." });
    try {
      const rows = await query("insert into users(id,email,password_hash,name) values($1,$2,$3,$4) on conflict do nothing returning id", [randomUUID(), email, await hash(password, 12), email.split("@")[0]]);
      if (!rows.length) return res.status(409).json({ error: "This account cannot be created. Try signing in." });
      return res.status(201).json({ ok: true });
    } catch { return res.status(503).json({ error: "Account creation is temporarily unavailable." }); }
  });
}
