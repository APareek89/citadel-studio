import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  lstat,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const execute = promisify(execFile);
const TIMEOUT = 90_000;
export interface GithubRepository {
  name: string;
  url: string;
  isPrivate: boolean;
  description?: string;
}

/** Intentionally narrower than URL(): no normalization, credentials, escapes or extra path. */
function githubUrl(value: string): { url: string; identity: string } {
  const match =
    /^https:\/\/github\.com\/([A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?)\/([A-Za-z0-9._-]{1,104})$/.exec(
      value,
    );
  if (!match || value !== value.trim())
    throw new Error(
      "Use an HTTPS github.com/owner/repository URL without credentials, query parameters or extra paths.",
    );
  const repo = match[2].replace(/\.git$/, "");
  if (!repo || repo === "." || repo === ".." || repo.length > 100)
    throw new Error("Invalid GitHub repository name.");
  const identity = `${match[1]}/${repo}`.toLowerCase();
  return { url: `https://github.com/${identity}.git`, identity };
}

export interface GithubStatus {
  connected: boolean;
  login?: string;
  authSource: "token" | "gh" | null;
  repositoryCount?: number;
}
let tokenSession: { token: string; login: string; valid: boolean } | undefined;
let repositoryCount: number | undefined;
let authGeneration = 0;
let redactionHook: (token: string | undefined) => void = () => {};
export function setGithubRedactionHook(
  hook: (token: string | undefined) => void,
): void {
  redactionHook = hook;
  hook(tokenSession?.token);
}
const repoRoute =
  "/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator,organization_member";

class GithubRequestError extends Error {}

async function tokenApi(route: string, token: string): Promise<unknown> {
  try {
    const response = await fetch("https://api.github.com" + route, {
      headers: {
        Authorization: "Bearer " + token,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      signal: AbortSignal.timeout(15000),
      redirect: "error",
    });
    if (!response.ok) {
      if (response.status === 401) {
        if (tokenSession?.token === token) tokenSession.valid = false;
        throw new GithubRequestError(
          "GitHub rejected this token. Reconnect with an active token.",
        );
      }
      if (response.status === 403 || response.status === 429)
        throw new GithubRequestError(
          "GitHub denied access or reached a rate limit. Check token permissions and retry later.",
        );
      throw new GithubRequestError(
        "GitHub request failed. Check repository access and retry.",
      );
    }
    if (!response.body)
      throw new GithubRequestError("GitHub returned invalid metadata.");
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.byteLength;
        if (size > 2_000_000) {
          await reader.cancel();
          throw new GithubRequestError(
            "GitHub metadata exceeded the response limit.",
          );
        }
        chunks.push(part.value);
      }
    } finally {
      reader.releaseLock();
    }
    try {
      return JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      throw new GithubRequestError("GitHub returned invalid metadata.");
    }
  } catch (error) {
    if (error instanceof GithubRequestError) throw error;
    throw new GithubRequestError(
      "GitHub request could not complete. Check network access and try again.",
    );
  }
}
function accountLogin(value: unknown): string {
  const login = (value as { login?: unknown })?.login;
  if (
    typeof login !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/.test(login)
  )
    throw new Error("GitHub returned invalid account metadata.");
  return login;
}
export async function connectGithubToken(value: string): Promise<GithubStatus> {
  if (typeof value !== "string" || !/^[A-Za-z0-9_]{12,512}$/.test(value.trim()))
    throw new Error("Enter a complete GitHub token without whitespace.");
  const token = value.trim(),
    generation = ++authGeneration;
  const login = accountLogin(await tokenApi("/user", token));
  if (generation !== authGeneration)
    throw new Error("GitHub connection was superseded by another request.");
  redactionHook(token);
  tokenSession = { token, login, valid: true };
  repositoryCount = undefined;
  return { connected: true, login, authSource: "token" };
}
export function disconnectGithubToken(): void {
  authGeneration++;
  tokenSession = undefined;
  repositoryCount = undefined;
  redactionHook(undefined);
}
export async function githubStatus(): Promise<GithubStatus> {
  if (tokenSession)
    return {
      connected: tokenSession.valid,
      login: tokenSession.login,
      authSource: "token",
      ...(repositoryCount === undefined ? {} : { repositoryCount }),
    };
  try {
    const login = accountLogin(
      JSON.parse(
        await command("gh", ["api", "user", "--hostname", "github.com"], 15000),
      ),
    );
    return {
      connected: true,
      login,
      authSource: "gh",
      ...(repositoryCount === undefined ? {} : { repositoryCount }),
    };
  } catch {
    return { connected: false, authSource: null };
  }
}

function environment(): NodeJS.ProcessEnv {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) =>
        !key.startsWith("GIT_") && key !== "WORKBENCH_GITHUB_CLONE_TOKEN",
    ),
  );
  return {
    ...env,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_SYSTEM: "/dev/null",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_TERMINAL_PROMPT: "0",
    GIT_LFS_SKIP_SMUDGE: "1",
    GH_HOST: "github.com",
    GH_PROMPT_DISABLED: "1",
    GH_PAGER: "cat",
  };
}

async function command(
  program: "git" | "gh",
  args: string[],
  timeout = TIMEOUT,
  extraEnv: NodeJS.ProcessEnv = {},
): Promise<string> {
  try {
    const result = await execute(program, args, {
      env: { ...environment(), ...extraEnv },
      timeout,
      killSignal: "SIGKILL",
      maxBuffer: 2_000_000,
      encoding: "utf8",
    });
    return result.stdout;
  } catch (error) {
    const e = error as NodeJS.ErrnoException & { killed?: boolean };
    // CLI stderr can contain remote URLs or credential-helper diagnostics: never forward it.
    if (e.code === "ENOENT")
      throw new Error(
        `${program === "gh" ? "GitHub CLI (gh)" : "Git"} is unavailable. Install it before connecting GitHub repositories.`,
      );
    if (e.killed)
      throw new Error(
        "GitHub operation exceeded its time or output limit. Retry with a smaller repository.",
      );
    throw new Error(
      "GitHub operation failed. Check GitHub CLI login, repository access and network connectivity. No repository code was executed.",
    );
  }
}

const gitArgs = [
  "--no-replace-objects",
  "-c",
  "core.hooksPath=/dev/null",
  "-c",
  "core.fsmonitor=false",
  "-c",
  "submodule.recurse=false",
  "-c",
  "protocol.allow=never",
  "-c",
  "protocol.https.allow=always",
  "-c",
  "http.followRedirects=false",
  "-c",
  "credential.helper=",
  "-c",
  "credential.https://github.com.helper=!gh auth git-credential",
];

export async function listGithubRepos(): Promise<GithubRepository[]> {
  const current = tokenSession;
  if (current && !current.valid)
    throw new Error(
      "GitHub token is no longer valid. Reconnect or disconnect it before using CLI authentication.",
    );
  let items: unknown;
  if (current) items = await tokenApi(repoRoute, current.token);
  else {
    const raw = await command(
      "gh",
      ["api", repoRoute.slice(1), "--hostname", "github.com"],
      30_000,
    );
    try {
      items = JSON.parse(raw);
    } catch {
      throw new Error("GitHub returned invalid repository metadata.");
    }
  }
  if (!Array.isArray(items) || items.length > 100)
    throw new Error("GitHub returned invalid repository metadata.");
  const result = items.map((item) => {
    if (
      !item ||
      typeof item.name !== "string" ||
      typeof item.html_url !== "string" ||
      typeof item.private !== "boolean"
    )
      throw new Error("GitHub returned invalid repository metadata.");
    const parsed = githubUrl(item.html_url);
    return {
      name: item.name.slice(0, 100),
      url: parsed.url.replace(/\.git$/, ""),
      isPrivate: item.private,
      ...(typeof item.description === "string"
        ? { description: item.description.slice(0, 1000) }
        : {}),
    };
  });
  if (current === tokenSession) repositoryCount = result.length;
  return result;
}

async function present(file: string): Promise<boolean> {
  try {
    await lstat(file);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function directory(file: string): Promise<string> {
  const stat = await lstat(file);
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    (process.getuid && stat.uid !== process.getuid())
  )
    throw new Error(
      "Managed repository directories must be real directories owned by the current user.",
    );
  return realpath(file);
}

async function verifyCheckout(
  target: string,
  root: string,
  identity: string,
): Promise<void> {
  const resolved = await directory(target);
  if (path.dirname(resolved) !== root)
    throw new Error("Managed repository path escaped its storage directory.");
  const git = path.join(target, ".git");
  await directory(git);
  await directory(path.join(git, "objects"));
  for (const relative of [
    "commondir",
    "worktrees",
    "objects/info/alternates",
    "objects/info/http-alternates",
    "info/grafts",
    "refs/replace",
  ]) {
    if (await present(path.join(git, relative)))
      throw new Error(
        "Managed repositories cannot use linked worktrees, alternate objects or replacement history.",
      );
  }
  for (const name of ["config", "HEAD"]) {
    const stat = await lstat(path.join(git, name));
    if (!stat.isFile() || stat.isSymbolicLink())
      throw new Error("Managed Git metadata must use regular local files.");
  }
  // --file + --no-includes avoids evaluating repository-supplied include paths.
  const raw = await command(
    "git",
    [
      ...gitArgs,
      "config",
      "--file",
      path.join(git, "config"),
      "--no-includes",
      "--null",
      "--list",
    ],
    10_000,
  );
  let remote = "";
  for (const entry of raw.split("\0").filter(Boolean)) {
    const newline = entry.indexOf("\n");
    const key = entry.slice(0, newline).toLowerCase();
    const value = entry.slice(newline + 1);
    if (key === "remote.origin.url") {
      if (remote)
        throw new Error("Managed repository has multiple origin URLs.");
      remote = githubUrl(value).identity;
    } else if (
      !/^(?:core\.(?:repositoryformatversion|filemode|bare|logallrefupdates|ignorecase|precomposeunicode)|remote\.origin\.(?:fetch|tagopt)|branch\.[^\n]+\.(?:remote|merge))$/.test(
        key,
      )
    ) {
      throw new Error(
        "Managed repository has unsupported Git configuration. Reconnect into a clean managed checkout.",
      );
    }
  }
  if (remote !== identity)
    throw new Error(
      "Managed repository origin does not match the requested GitHub repository. Existing files were preserved.",
    );
}

/** Read-only source acquisition: never install, execute, recurse submodules or refresh an existing checkout. */
export async function checkoutGithub(value: string): Promise<string> {
  const parsed = githubUrl(value); // Validate before filesystem or CLI activity.
  const data = path.resolve(process.env.WORKBENCH_DATA_DIR || ".local");
  await mkdir(data, { recursive: true, mode: 0o700 });
  await directory(data);
  const managed = path.join(data, "repos");
  await mkdir(managed, { mode: 0o700 }).catch((error) => {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  });
  const root = await directory(managed);
  const key = createHash("sha256")
    .update(parsed.identity)
    .digest("hex")
    .slice(0, 24);
  const target = path.join(root, key);
  const lock = path.join(root, `${key}.lock`);
  const deadline = Date.now() + TIMEOUT + 20_000;
  while (true) {
    try {
      await mkdir(lock, { mode: 0o700 });
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (Date.now() >= deadline)
        throw new Error(
          "This repository is already being connected. Retry after the other operation completes.",
        );
      await delay(100);
    }
  }
  let staging: string | undefined;
  try {
    if (await present(target)) {
      await verifyCheckout(target, root, parsed.identity);
      return target;
    }
    staging = await mkdtemp(path.join(root, ".clone-"));
    const checkout = path.join(staging, "checkout");
    const template = path.join(staging, "empty-template");
    await mkdir(template, { mode: 0o700 });
    const token = tokenSession;
    if (token && !token.valid)
      throw new Error(
        "GitHub token is no longer valid. Reconnect it before cloning.",
      );
    const cloneArgs = token ? gitArgs.slice(0, -2) : gitArgs;
    let cloneEnv: NodeJS.ProcessEnv = {};
    if (token) {
      const askpass = path.join(staging, "askpass.sh");
      await writeFile(
        askpass,
        `#!/bin/sh\ncase "$1" in *Username*|*username*) printf '%s\\n' 'x-access-token';; *Password*|*password*) printf '%s\\n' "$WORKBENCH_GITHUB_CLONE_TOKEN";; *) exit 1;; esac\n`,
        { mode: 0o700, flag: "wx" },
      );
      cloneEnv = {
        GIT_ASKPASS: askpass,
        WORKBENCH_GITHUB_CLONE_TOKEN: token.token,
      };
    }
    await command(
      "git",
      [
        ...cloneArgs,
        "clone",
        "--depth",
        "1",
        "--single-branch",
        "--no-tags",
        "--no-checkout",
        "--no-recurse-submodules",
        `--template=${template}`,
        "--",
        parsed.url,
        checkout,
      ],
      TIMEOUT,
      cloneEnv,
    );
    // Clone generated this local config with no user/system templates or filters.
    await verifyCheckout(checkout, await realpath(staging), parsed.identity);
    await command(
      "git",
      [
        ...gitArgs,
        "-C",
        checkout,
        "checkout",
        "--detach",
        "--force",
        "HEAD",
        "--",
      ],
      30_000,
    );
    // Our atomic directory lock serializes publication; never replace a pre-existing directory.
    if (await present(target)) {
      await verifyCheckout(target, root, parsed.identity);
      return target;
    }
    await rename(checkout, target);
    return target;
  } finally {
    if (staging) await rm(staging, { recursive: true, force: true });
    await rm(lock, { recursive: true, force: true });
  }
}
