import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowRight,
  GitBranch,
  Layers3,
  Loader2,
  Moon,
  ShieldCheck,
  Sun,
  Workflow,
} from "lucide-react";

import { createSessionFence } from "./session-fence";

const sessionFence = createSessionFence();

type User = { id: string; email: string; name?: string | null };
type Session = { enabled: boolean; user: User | null };
export type PortfolioAccount = Session & {
  theme: string;
  setTheme: (theme: string) => void;
  signOut: () => Promise<void>;
};

export const captureSession = () => sessionFence.capture();
export function expireSession(captured = captureSession()) {
  sessionFence.runIfCurrent(captured, () => window.dispatchEvent(new Event("citadel-session-expired")));
}

async function readSession(): Promise<Session> {
  const response = await fetch("/api/auth/session", { cache: "no-store" });
  if (!response.ok)
    throw new Error("Could not reach your workspace. Please try again.");
  return response.json();
}

async function authAction(
  action: "callback/credentials" | "signout",
  fields: Record<string, string> = {},
) {
  const csrfResponse = await fetch("/auth/csrf", { cache: "no-store" });
  if (!csrfResponse.ok)
    throw new Error("Could not prepare a secure session. Please try again.");
  const { csrfToken } = await csrfResponse.json();
  if (typeof csrfToken !== "string" || !csrfToken)
    throw new Error("Could not prepare a secure session.");
  const response = await fetch(`/auth/${action}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "X-Auth-Return-Redirect": "1",
    },
    body: new URLSearchParams({
      csrfToken,
      callbackUrl: window.location.origin,
      ...fields,
    }),
  });
  const result = await response.json().catch(() => ({}));
  if (
    !response.ok ||
    result.error ||
    (result.url &&
      new URL(result.url, location.origin).searchParams.has("error"))
  ) {
    throw new Error(
      action === "signout"
        ? "Could not sign out. Please try again."
        : "Email or password is incorrect. Please try again.",
    );
  }
}

export function ThemeButton({
  theme,
  setTheme,
}: Pick<PortfolioAccount, "theme" | "setTheme">) {
  const dark =
    theme === "dark" ||
    (theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  return (
    <button
      className="icon-button"
      type="button"
      aria-label={`Switch to ${dark ? "light" : "dark"} theme`}
      title={`Switch to ${dark ? "light" : "dark"} theme`}
      onClick={() => setTheme(dark ? "light" : "dark")}
    >
      {dark ? <Sun size={18} /> : <Moon size={18} />}
    </button>
  );
}

export function PortfolioSession({
  children,
}: {
  children: (account: PortfolioAccount) => ReactNode;
}) {
  const [session, setSession] = useState<Session | null>(null);
  const sessionEpoch = useRef(0);
  function acceptSession(value: Session) {
    sessionFence.accept(value.enabled ? value.user?.id || null : "local-fixture");
    setSession(value);
  }
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [theme, setTheme] = useState(
    () => localStorage.getItem("workbench-theme") || "system",
  );
  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      document.documentElement.classList.add("lovable-ui");
      document.documentElement.dataset.theme =
        theme === "system" ? (media.matches ? "dark" : "light") : theme;
    };
    apply();
    localStorage.setItem("workbench-theme", theme);
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [theme]);
  useEffect(() => {
    let active = true;
    const check = () => {
      const epoch = ++sessionEpoch.current;
      return readSession()
        .then((value) => {
          if (active && epoch === sessionEpoch.current) {
            acceptSession(value);
            setError("");
          }
        })
        .catch((failure) => {
          if (active && epoch === sessionEpoch.current)
            setError(failure.message);
        })
        .finally(() => {
          if (active && epoch === sessionEpoch.current) setLoading(false);
        });
    };
    const expire = () => {
      sessionEpoch.current++;
      acceptSession({ enabled: true, user: null });
      setError("");
      setLoading(false);
    };
    check();
    window.addEventListener("focus", check);
    window.addEventListener("citadel-session-expired", expire);
    return () => {
      active = false;
      window.removeEventListener("focus", check);
      window.removeEventListener("citadel-session-expired", expire);
    };
  }, []);
  async function signOut() {
    await authAction("signout");
    sessionEpoch.current++;
    if (session?.user)
      localStorage.removeItem(`citadel-project:${session.user.id}`);
    localStorage.removeItem("workbench-project");
    acceptSession({ enabled: true, user: null });
  }
  if (!loading && session && (!session.enabled || session.user)) {
    return children({ ...session, theme, setTheme, signOut });
  }
  return (
    <div className="portfolio-auth-shell">
      <header className="portfolio-header">
        <div className="portfolio-brand">
          <Workflow size={22} />
          <strong>Citadel Studio</strong>
          <span>Agent workbench</span>
        </div>
        <ThemeButton theme={theme} setTheme={setTheme} />
      </header>
      {loading ? (
        <main className="loading-page" role="status">
          <Loader2 size={24} className="spin" />
          <p>Opening your workspace…</p>
        </main>
      ) : error && !session ? (
        <main className="portfolio-auth-retry">
          <h1>Your workspace is unavailable.</h1>
          <p role="alert">{error}</p>
          <button className="button primary" onClick={() => location.reload()}>
            Try again
          </button>
        </main>
      ) : (
        <AuthForm
          onSuccess={async () => {
            const epoch = ++sessionEpoch.current;
            const next = await readSession();
            if (epoch !== sessionEpoch.current)
              throw new Error("Your session changed. Please sign in again.");
            if (!next.user)
              throw new Error(
                "Sign-in could not be completed. Please try again.",
              );
            setError("");
            acceptSession(next);
          }}
        />
      )}
    </div>
  );
}

function AuthForm({ onSuccess }: { onSuccess: () => Promise<void> }) {
  const [signup, setSignup] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  return (
    <main className="portfolio-auth-layout">
      <section className="portfolio-auth-intro">
        <span className="eyebrow">CITADEL STUDIO</span>
        <h1>
          See how your
          <br />
          agents work.
        </h1>
        <p>
          Map your application, inspect its source and test a workflow with
          evidence at every step.
        </p>
        <div className="portfolio-auth-feature">
          <GitBranch size={20} />
          <span>Connect a public or private repository</span>
        </div>
        <div className="portfolio-auth-feature">
          <Layers3 size={20} />
          <span>Explore source maps and recorded runs</span>
        </div>
        <div className="portfolio-auth-feature">
          <ShieldCheck size={20} />
          <span>Keep your workspace and credentials scoped to you</span>
        </div>
      </section>
      <section
        className="portfolio-auth-card"
        aria-labelledby="portfolio-auth-title"
      >
        <h2 id="portfolio-auth-title">
          {signup ? "Create your workspace" : "Welcome back"}
        </h2>
        <p className="muted">
          {signup
            ? "Start with a free example, then bring your own app."
            : "Sign in to your projects, graphs and run history."}
        </p>
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            if (pending) return;
            setPending(true);
            setError("");
            try {
              if (signup) {
                const response = await fetch("/api/auth/signup", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ email: email.trim(), password }),
                });
                if (!response.ok) {
                  const result = await response.json().catch(() => ({}));
                  throw new Error(
                    result.error ||
                      "Could not create your account. Please try again.",
                  );
                }
              }
              await authAction("callback/credentials", {
                email: email.trim(),
                password,
              });
              setPassword("");
              await onSuccess();
            } catch (failure) {
              setError((failure as Error).message);
            } finally {
              setPending(false);
            }
          }}
        >
          <label htmlFor="portfolio-email">Email address</label>
          <input
            id="portfolio-email"
            type="email"
            autoComplete="email"
            required
            maxLength={254}
            value={email}
            disabled={pending}
            onChange={(event) => setEmail(event.target.value)}
          />
          <label htmlFor="portfolio-password">Password</label>
          <input
            id="portfolio-password"
            type="password"
            autoComplete={signup ? "new-password" : "current-password"}
            required
            minLength={12}
            maxLength={72}
            value={password}
            disabled={pending}
            onChange={(event) => setPassword(event.target.value)}
          />
          {signup && <p className="small muted">Use at least 12 characters.</p>}
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <button
            className="button primary full"
            disabled={pending}
            aria-busy={pending}
          >
            {pending ? (
              <Loader2 size={16} className="spin" />
            ) : (
              <ArrowRight size={16} />
            )}
            {pending ? "Please wait…" : signup ? "Create account" : "Sign in"}
          </button>
        </form>
        <p className="portfolio-auth-switch">
          {signup ? "Already have an account?" : "New to Citadel?"}{" "}
          <button
            disabled={pending}
            onClick={() => {
              setSignup(!signup);
              setPassword("");
              setError("");
            }}
          >
            {signup ? "Sign in" : "Create an account"}
          </button>
        </p>
        <button
          className="button full"
          disabled
          title="Google sign-in is not configured"
        >
          Google sign-in unavailable
        </button>
        <p className="small muted portfolio-auth-limit">
          Password reset by email is not available yet.
        </p>
      </section>
    </main>
  );
}
