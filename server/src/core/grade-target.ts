/*
 * grade-target — target validation + plugin resolution for the read-only Grade
 * route (A09b, FR-01.53). The "where + is-it-legit" half of the grade bridge;
 * `grade-runner.ts` owns the spawn + outcome mapping.
 *
 * Target validation is shape + existence, NOT path-confinement: grade may grade
 * ANY repo, so this is not a project-root guard. It rejects obviously-bad input
 * with an honest error BEFORE any spawn (empty/oversized, a NUL byte, a remote
 * that isn't a plausible git/GitHub URL, or a local path that isn't a real dir).
 * shell:false already makes injection impossible in the runner; this is honesty
 * + a fast, clear failure. Remote-ness is re-derived here — never trust a client
 * `isRemote` hint.
 *
 * Plugin resolution walks the versioned CACHE layout
 * (`<cacheRoot>/shipwright-grade/<version>/scripts/tools/grade.py` and the
 * `shipwright-compliance/<version>/` engine root), reusing readiness-probe's
 * `shipwrightCacheRoot` + `compareVersions`. Pure over its fs seams.
 */

import {
  existsSync as fsExistsSync,
  readdirSync as fsReaddirSync,
  statSync as fsStatSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

import { compareVersions, shipwrightCacheRoot } from "./readiness-probe.js";

/** grade.py's engine locator env var (engine_bridge._ENV_COMPLIANCE_ROOT). In
 *  the versioned plugin CACHE layout the default sibling-resolution fails, so we
 *  set this to the resolved shipwright-compliance plugin root. */
export const ENV_COMPLIANCE_ROOT = "SHIPWRIGHT_GRADE_COMPLIANCE_ROOT";

/* ── Target validation ────────────────────────────────────────────────────── */

const REMOTE_SCHEME_RE = /:\/\//;
const GIT_SSH_RE = /^git@[^\s:]+:[^\s/]+\/.+/i;
const HOST_SHORTHAND_RE = /^(?:www\.)?(?:github|gitlab)\.com[/:]/i;

/** Server-side remote detection — never trust the client's `isRemote` hint. */
export function looksRemote(target: string): boolean {
  return REMOTE_SCHEME_RE.test(target) || GIT_SSH_RE.test(target) || HOST_SHORTHAND_RE.test(target);
}

export interface TargetValidation {
  ok: boolean;
  kind?: "local" | "remote";
  reason?: string;
}

/** Extract the host from a remote target across all accepted forms, or null. */
function extractRemoteHost(t: string): string | null {
  let m = /^(?:https?|ssh|git):\/\/([^/]+)/i.exec(t);
  if (m) {
    let authority = m[1];
    const at = authority.lastIndexOf("@"); // strip any userinfo
    if (at >= 0) authority = authority.slice(at + 1);
    return authority.replace(/:\d+$/, "").replace(/^\[|\]$/g, "").toLowerCase();
  }
  m = /^git@([^:]+):/i.exec(t);
  if (m) return m[1].toLowerCase();
  m = /^(?:www\.)?((?:github|gitlab)\.com)\//i.exec(t);
  if (m) return m[1].toLowerCase();
  return null;
}

/** SSRF guard: block a remote host that is loopback / private / link-local /
 *  CGNAT — so an EXPOSED webui can't be turned into a metadata-endpoint or
 *  internal-network probe by a `git clone` of an attacker-chosen URL. Public
 *  hostnames (github.com, gitlab.com, self-hosted-by-name) are unaffected. */
export function hostIsBlocked(host: string): boolean {
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (host === "0.0.0.0" || host === "::1" || host === "::") return true;
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (v4) {
    const a = Number(v4[1]);
    const b = Number(v4[2]);
    if (a === 127 || a === 10 || a === 0) return true; // loopback / private / this-host
    if (a === 192 && b === 168) return true; // private
    if (a === 172 && b >= 16 && b <= 31) return true; // private
    if (a === 169 && b === 254) return true; // link-local / cloud metadata
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  }
  if (/^fe80:/i.test(host) || /^fc[0-9a-f]{2}:/i.test(host) || /^fd[0-9a-f]{2}:/i.test(host)) {
    return true; // IPv6 link-local / ULA
  }
  return false;
}

const PLAUSIBLE_URL_RES = [
  /^https?:\/\/[^\s/]+\/[^\s/]+\/[^\s]+/i, // https://host/owner/repo
  /^ssh:\/\/[^\s]+\/[^\s/]+\/[^\s]+/i, // ssh://host/owner/repo
  /^git:\/\/[^\s]+\/[^\s/]+\/[^\s]+/i, // git://host/owner/repo
  /^git@[^\s:]+:[^\s/]+\/[^\s]+/i, // git@host:owner/repo
  /^(?:www\.)?(?:github|gitlab)\.com\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+/i, // github.com/owner/repo
];

export function validateGradeTarget(
  target: unknown,
  statDir: (p: string) => boolean,
): TargetValidation {
  if (typeof target !== "string") return { ok: false, reason: "No repo was given." };
  const t = target.trim();
  if (t.length === 0) return { ok: false, reason: "No repo was given." };
  if (t.length > 400) return { ok: false, reason: "That path or URL is too long." };
  if (t.includes("\0")) return { ok: false, reason: "That path or URL is not valid." };

  if (looksRemote(t)) {
    // Reject credentials embedded in an http(s) URL (`https://user:pass@host/…`)
    // — a grade never needs them, and echoing one back would leak a secret. The
    // legitimate `git@host:owner/repo` SSH form (no scheme) is untouched.
    if (/^https?:\/\/[^/@\s]*@/i.test(t)) {
      return { ok: false, reason: "Remove the credentials from that URL — a grade never needs them." };
    }
    const plausible = PLAUSIBLE_URL_RES.some((re) => re.test(t));
    if (!plausible) {
      return { ok: false, reason: "That doesn't look like a git or GitHub repository URL." };
    }
    const host = extractRemoteHost(t);
    if (host && hostIsBlocked(host)) {
      return { ok: false, reason: "That host isn't allowed — a grade can't reach a private or loopback address." };
    }
    return { ok: true, kind: "remote" };
  }
  // A local target must resolve to a real directory on this machine.
  if (!statDir(t)) {
    return { ok: false, reason: "That folder doesn't exist on this machine (or isn't a folder)." };
  }
  return { ok: true, kind: "local" };
}

/** Default statDir seam — true iff `p` is an existing directory. */
export function defaultStatDir(p: string): boolean {
  try {
    return fsStatSync(p).isDirectory();
  } catch {
    return false;
  }
}

/* ── Plugin resolution (versioned cache layout) ──────────────────────────────
 * The highest semver dir that actually carries the file wins; an unversioned
 * monorepo layout is a defensive fallback. */

export interface PluginResolveDeps {
  homeDir?: string;
  existsFn?: (p: string) => boolean;
  readdirFn?: (p: string) => string[];
}

function resolveVersionedFile(
  pluginName: string,
  relFile: string[],
  deps: PluginResolveDeps,
): string | null {
  const existsFn = deps.existsFn ?? fsExistsSync;
  const readdirFn = deps.readdirFn ?? ((p: string) => fsReaddirSync(p));
  const homeDir = deps.homeDir ?? os.homedir();
  const pluginRoot = path.join(shipwrightCacheRoot(homeDir), pluginName);

  let versions: string[] = [];
  try {
    versions = readdirFn(pluginRoot).filter((v) => /^\d/.test(v));
  } catch {
    versions = [];
  }
  versions.sort((a, b) => compareVersions(b, a)); // highest first
  for (const v of versions) {
    const cand = path.join(pluginRoot, v, ...relFile);
    if (existsFn(cand)) return cand;
  }
  // Defensive: unversioned (monorepo-style) layout.
  const flat = path.join(pluginRoot, ...relFile);
  return existsFn(flat) ? flat : null;
}

/** Resolve `grade.py`, or an explicit `scriptOverride`. */
export function resolveGradeScript(
  deps: PluginResolveDeps & { scriptOverride?: string } = {},
): string | null {
  const existsFn = deps.existsFn ?? fsExistsSync;
  if (deps.scriptOverride) return existsFn(deps.scriptOverride) ? deps.scriptOverride : null;
  return resolveVersionedFile("shipwright-grade", ["scripts", "tools", "grade.py"], deps);
}

/** Resolve the shipwright-compliance plugin root (the dir carrying
 *  `scripts/lib/control_grade.py`), which grade.py's engine_bridge needs. */
export function resolveComplianceRoot(
  deps: PluginResolveDeps & { complianceOverride?: string } = {},
): string | null {
  if (deps.complianceOverride) return deps.complianceOverride;
  const file = resolveVersionedFile(
    "shipwright-compliance",
    ["scripts", "lib", "control_grade.py"],
    deps,
  );
  return file ? path.dirname(path.dirname(path.dirname(file))) : null;
}
