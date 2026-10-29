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

import { contained, projectCommandRefusal, userCommandRefusal } from "./custom-profile-command-policy.js";
import type { PreviewProfile } from "./preview-session-manager.js";
import { isProfileNameShape, validateStackProfile, type StackProfileDeps } from "./stack-profiles.js";
import { userProfilesDir } from "./stack-profiles-create.js";

export { projectCommandRefusal, userCommandRefusal };

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
const MAX_WAITING = 8;
const BUSY = "profile resolver busy";

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
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
  if (dev.host === "127.0.0.1" || dev.host === "localhost") out.host = dev.host;
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
