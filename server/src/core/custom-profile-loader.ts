/*
 * custom-profile-loader.ts — turns a stack-profile NAME into a runnable
 * Preview profile, including the user's OWN profiles (project / user source)
 * that the bundled-snapshot loader (`profile-loader.ts`) cannot see.
 *
 * The shipwright resolver is the authority on WHICH file a name means and
 * whether it is valid (`validateStackProfile`, same bridge as Settings) — the
 * lookup order is never re-implemented here. A custom profile file is
 * UNTRUSTED input (a cloned repo can ship `.shipwright/profiles/x.json`), so:
 *   - it must lie inside `<project>/.shipwright/profiles` or
 *     `~/.shipwright/profiles` after realpath (path.relative, not startsWith);
 *   - it is read ONCE and only an allowlist of fields is copied (no env / cwd);
 *   - a PROJECT-source command must be a bare runner name from an allowlist
 *     (no path, no inline-eval flag) — a repo-relative binary never runs;
 *   - spawn stays `shell:false` through `preview-session-manager` only.
 * Bundled profiles keep their sync loader; when the resolver is unavailable
 * they fall back to it, so Preview for bundled stacks never regresses.
 */

import { closeSync, existsSync, fstatSync, lstatSync, openSync, readFileSync, realpathSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { PreviewSessionManager, type PreviewProfile } from "./preview-session-manager.js";
import { isProfileNameShape, validateStackProfile, type StackProfileDeps } from "./stack-profiles.js";
import { userProfilesDir } from "./stack-profiles-create.js";

export type ResolvedPreviewProfile = PreviewProfile & { stack?: { frontend?: unknown } };

export interface PreviewProfileLookup {
  profile: ResolvedPreviewProfile | null;
  /** Why there is no profile (diagnostics only; never shown as a verdict). */
  reason?: string;
}

export interface PreviewProfileResolverDeps {
  /** Bundled-snapshot loader (the existing sync one). */
  bundled: (name: string) => ResolvedPreviewProfile | null;
  validate?: typeof validateStackProfile;
  stack?: StackProfileDeps;
  homeDir?: string;
  now?: () => number;
  /** Max concurrent resolver processes. */
  maxConcurrent?: number;
}

export const POSITIVE_TTL_MS = 15_000;
export const NEGATIVE_TTL_MS = 30_000;
// `npx` is deliberately absent: it downloads and runs a package the repo names.
const RUNNERS = new Set(["npm", "pnpm", "yarn", "bun", "node", "vite", "next", "python", "python3", "uv", "deno"]);
const MAX_WAITING = 8;
const BUSY = "profile resolver busy";
const PACKAGE_MANAGERS = new Set(["npm", "pnpm", "yarn", "bun"]);
const SCRIPT_VERBS = new Set(["run", "run-script", "dev", "start", "serve", "preview"]);
// Interpreters take code from flags (-e, --eval=, -cprint, -Ic, --import data:...),
// subcommands (deno eval, -m) and URLs. For these the only accepted shape is
// "runner + plain file argument(s)": any dash-led argument, `eval`, or URL is refused.
const INTERPRETERS = new Set(["node", "python", "python3", "deno", "uv"]);

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Project-source command policy. Returns a refusal reason, or null when allowed. */
export function projectCommandRefusal(command: string): string | null {
  let argv: string[];
  try {
    argv = PreviewSessionManager.tokenizeCommand(command);
  } catch (err) {
    return err instanceof Error ? err.message : "unparseable command";
  }
  const exe = argv[0] ?? "";
  if (/[\\/:]/.test(exe)) return "a project profile may not run a path or a program inside the repo";
  const name = exe.toLowerCase().replace(/\.(cmd|exe|bat)$/, "");
  if (!RUNNERS.has(name)) return `“${exe}” is not an allowed runner for a project profile`;
  const args = argv.slice(1);
  const argRefusal = runnerArgRefusal(args);
  if (argRefusal) return argRefusal;
  if (PACKAGE_MANAGERS.has(name)) {
    // Run a script the repo's own package.json declares - the same trust as `npm run dev`.
    // exec / dlx / x / create fetch and run a package; -e / -c run inline code.
    if (!SCRIPT_VERBS.has((args[0] ?? "").toLowerCase())) return "a project profile may only run a package script (run, dev, start)";
    const verb = (args[0] ?? "").toLowerCase();
    const script = verb === "run" || verb === "run-script" ? (args[1] ?? "") : "dev";
    if (!script || script.startsWith("-") || /^[a-z][a-z0-9+.-]*:/i.test(script) || /[\\/]/.test(script)) {
      return "a project profile must name a plain package script";
    }
  }
  if (INTERPRETERS.has(name)) {
    if (args.some((a) => a.startsWith("-") || a.toLowerCase() === "eval" || /^[a-z][a-z0-9+.-]*:/i.test(a))) {
      return "flags, eval and URLs are not allowed for an interpreter in a project profile";
    }
    // a script INSIDE the repo only: no absolute / drive / UNC / parent-relative file argument
    if (args.some((a) => /^([\\/]|[a-z]:)/i.test(a) || a.split(/[\\/]/).includes(".."))) {
      return "an interpreter may only run a script inside the project";
    }
    if (name === "uv" && (args[0] !== "run" || INTERPRETERS.has((args[1] ?? "").toLowerCase().replace(/\.(cmd|exe|bat)$/, "")))) {
      return "uv may only run a script file in a project profile";
    }
  }
  return null;
}

/** User-source: any bare program, or an ABSOLUTE path - never a path relative to the repo. */
export function userCommandRefusal(command: string, projectPath = ""): string | null {
  let argv: string[];
  try {
    argv = PreviewSessionManager.tokenizeCommand(command);
  } catch (err) {
    return err instanceof Error ? err.message : "unparseable command";
  }
  const exe = argv[0] ?? "";
  if (/[\\/]/.test(exe) && !path.isAbsolute(exe)) return "a profile command must be a bare program or an absolute path";
  // an absolute path that points INTO the repository is the same thing as a repo-relative one
  if (projectPath && path.isAbsolute(exe)) {
    let root = projectPath;
    let target = exe;
    try {
      root = realpathSync(projectPath);
      target = realpathSync(exe);
    } catch {
      // a program that does not exist yet cannot be resolved - compare the literal paths
    }
    if (contained(root, target) || contained(path.resolve(projectPath), path.resolve(exe))) {
      return "a profile command may not point into the project";
    }
  }
  return null;
}

/** Arguments no runner may take: a path out of the project, a URL, or a config/eval flag. */
function runnerArgRefusal(args: string[]): string | null {
  for (const a of args) {
    if (/^([\\/]|[a-z]:)/i.test(a) || a.split(/[\\/]/).includes("..")) return "a project profile argument may not be an absolute path or leave the project";
    if (/^[a-z][a-z0-9+.-]*:/i.test(a) && !/^[a-z]:[\\/]/i.test(a)) return "a project profile argument may not be a URL";
    const flag = a.toLowerCase().split("=")[0];
    if (["-c", "--config", "-e", "--eval", "--print", "--require", "-r", "--import", "--loader", "--input-type"].includes(flag ?? "")) {
      return "config, eval and preload flags are not allowed in a project profile";
    }
  }
  return null;
}

function contained(root: string, target: string): boolean {
  const rel = path.relative(root, target);
  return rel !== "" && rel !== ".." && !rel.startsWith(".." + path.sep) && !path.isAbsolute(rel);
}

/** Copy ONLY the fields Preview uses; refuse anything malformed. */
function allowlisted(raw: unknown): ResolvedPreviewProfile | null {
  if (!isObject(raw)) return null;
  const dev = raw.dev_server;
  if (!isObject(dev) || typeof dev.command !== "string" || !dev.command.trim()) return null;
  const port = dev.port;
  if (typeof port !== "number" || !Number.isInteger(port) || port < 1024 || port > 65535) return null;
  const out: NonNullable<ResolvedPreviewProfile["dev_server"]> = { command: dev.command, port };
  if (typeof dev.ready_path === "string" && dev.ready_path.startsWith("/")) out.ready_path = dev.ready_path;
  const t = dev.ready_timeout_seconds;
  if (typeof t === "number" && Number.isInteger(t) && t >= 1 && t <= 600) out.ready_timeout_seconds = t;
  const frontend = isObject(raw.stack) ? raw.stack.frontend : undefined;
  return { dev_server: out, stack: { frontend: frontend ?? undefined } };
}

export function createPreviewProfileResolver(deps: PreviewProfileResolverDeps) {
  const validate = deps.validate ?? validateStackProfile;
  const now = deps.now ?? (() => Date.now());
  const home = deps.homeDir ?? os.homedir();
  const cache = new Map<string, { at: number; ttl: number; file?: string; mtimeMs?: number; value: PreviewProfileLookup }>();
  const inFlight = new Map<string, Promise<PreviewProfileLookup>>();
  const max = deps.maxConcurrent ?? 2;
  let running = 0;
  const waiters: Array<() => void> = [];

  async function slot<T>(fn: () => Promise<T>): Promise<T> {
    // Hand the slot straight to the next waiter (no decrement), so a newcomer can never
    // slip in between the release and the wake-up and exceed the cap.
    // A stuck resolver must not queue the hot actions endpoint without bound: past a
    // short queue the lookup degrades (no Preview for now) instead of waiting.
    if (running >= max && waiters.length >= MAX_WAITING) throw new Error(BUSY);
    if (running >= max) await new Promise<void>((r) => waiters.push(r));
    else running++;
    try {
      return await fn();
    } finally {
      const next = waiters.shift();
      if (next) next();
      else running--;
    }
  }

  function readCustom(source: "project" | "user", file: string, projectPath: string): PreviewProfileLookup {
    const base = source === "project" ? path.join(projectPath, ".shipwright", "profiles") : userProfilesDir({ homeDir: home });
    let realBase: string;
    let real: string;
    try {
      // the folder itself must not be a symlink out of the project / home
      if (lstatSync(base).isSymbolicLink()) return { profile: null, reason: "profiles folder is a symlink" };
      realBase = realpathSync(base);
      // an ancestor symlink (e.g. `.shipwright` -> elsewhere) must not relocate the folder
      const anchor = source === "project" ? projectPath : home;
      if (!contained(realpathSync(anchor), realBase)) {
        return { profile: null, reason: "profiles folder resolves outside its allowed location" };
      }
      real = realpathSync(file);
    } catch {
      return { profile: null, reason: "profile file unreadable" };
    }
    if (!contained(realBase, real)) return { profile: null, reason: "profile file is outside the profiles folder" };
    let raw: unknown;
    try {
      // one descriptor for the type check AND the read - no check-then-act window
      const fd = openSync(real, "r");
      try {
        if (!fstatSync(fd).isFile()) return { profile: null, reason: "profile is not a regular file" };
        raw = JSON.parse(readFileSync(fd, "utf-8"));
      } finally {
        closeSync(fd);
      }
    } catch {
      return { profile: null, reason: "profile file is not readable JSON" };
    }
    const profile = allowlisted(raw);
    if (!profile) return { profile: null, reason: "profile has no usable dev_server" };
    const command = profile.dev_server?.command ?? "";
    const refusal = source === "project" ? projectCommandRefusal(command) : userCommandRefusal(command, projectPath);
    if (refusal) return { profile: null, reason: refusal };
    return { profile };
  }

  async function lookup(name: string, projectPath: string): Promise<{ value: PreviewProfileLookup; file?: string; ttl: number }> {
    const bundled = (): PreviewProfileLookup => ({ profile: deps.bundled(name) });
    if (!isProfileNameShape(name)) return { value: bundled(), ttl: POSITIVE_TTL_MS };
    // (The resolver keys a profile on its FILE NAME - a file whose "name" differs is
    // invalid - so probing `<name>.json` is exactly its lookup, not a second opinion.)
    // Fast path: with no `<name>.json` in either custom folder nothing can shadow the
    // bundled profile, so a resolver process (uv start-up, on a hot endpoint) is
    // pointless - skip it. This only decides WHETHER to ask the resolver; which file a
    // name means is still always the resolver's answer.
    const candidates = [path.join(userProfilesDir({ homeDir: home }), `${name}.json`)];
    if (projectPath) candidates.push(path.join(projectPath, ".shipwright", "profiles", `${name}.json`));
    if (!candidates.some((c) => existsSync(c))) return { value: bundled(), ttl: POSITIVE_TTL_MS };
    const out = await slot(() => validate({ name, projectRoot: projectPath || undefined }, deps.stack));
    // Resolver unavailable / newer contract / crash => behave exactly as before.
    if (out.status !== "ok") return { value: bundled(), ttl: NEGATIVE_TTL_MS };
    const report = out.report;
    if (!report.valid) return { value: { profile: null, reason: "the resolver reports this profile as invalid" }, ttl: NEGATIVE_TTL_MS };
    if (!("source" in report) || typeof report.path !== "string") return { value: { profile: null, reason: "unexpected resolver answer" }, ttl: NEGATIVE_TTL_MS };
    if (report.source === "bundled") return { value: bundled(), ttl: POSITIVE_TTL_MS };
    if (report.source !== "project" && report.source !== "user") return { value: { profile: null, reason: `unsupported profile source “${report.source}”` }, ttl: NEGATIVE_TTL_MS };
    if (report.source === "project" && !projectPath) return { value: { profile: null, reason: "no project path" }, ttl: NEGATIVE_TTL_MS };
    const value = readCustom(report.source, report.path, projectPath);
    return { value, file: report.path, ttl: value.profile ? POSITIVE_TTL_MS : NEGATIVE_TTL_MS };
  }

  function stillFresh(entry: { at: number; ttl: number; file?: string; mtimeMs?: number }): boolean {
    if (now() - entry.at > entry.ttl) return false;
    if (!entry.file) return true;
    try {
      return lstatSync(entry.file).mtimeMs === entry.mtimeMs;
    } catch {
      return false; // deleted => re-resolve
    }
  }

  return {
    /** `fresh` bypasses the cache (spawn re-resolves right before it runs). Never throws. */
    async resolve(name: string, projectPath: string, opts: { fresh?: boolean } = {}): Promise<PreviewProfileLookup> {
      const key = `${projectPath}\0${name}`;
      const hit = cache.get(key);
      if (!opts.fresh && hit && stillFresh(hit)) return hit.value;
      const started = now();
      const pending = inFlight.get(key);
      if (!opts.fresh && pending) return pending;
      let p!: Promise<PreviewProfileLookup>;
      p = (async (): Promise<PreviewProfileLookup> => {
        try {
          const r = await lookup(name, projectPath);
          let mtimeMs: number | undefined;
          if (r.file) {
            try {
              mtimeMs = lstatSync(r.file).mtimeMs;
            } catch {
              mtimeMs = undefined;
            }
          }
          const newer = cache.get(key);
          if (!newer || newer.at <= started) cache.set(key, { at: now(), ttl: r.ttl, file: r.file, mtimeMs, value: r.value });
          return r.value;
        } catch (err) {
          const value = { profile: null, reason: err instanceof Error ? err.message.slice(0, 200) : "lookup failed" };
          // an overloaded resolver is transient - do not hide Preview for a whole TTL
          if (!(err instanceof Error && err.message === BUSY)) cache.set(key, { at: now(), ttl: NEGATIVE_TTL_MS, value });
          return value;
        } finally {
          if (inFlight.get(key) === p) inFlight.delete(key);
        }
      })();
      inFlight.set(key, p);
      return p;
    },
    clear(): void {
      cache.clear();
    },
  };
}
