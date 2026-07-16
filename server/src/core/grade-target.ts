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
const HOST_SHORTHAND_RE = /^(?:www\.)?(?:(?:github|gitlab)\.com|bitbucket\.org)[/:]/i;

/** Server-side remote detection — never trust the client's `isRemote` hint. */
export function looksRemote(target: string): boolean {
  return REMOTE_SCHEME_RE.test(target) || GIT_SSH_RE.test(target) || HOST_SHORTHAND_RE.test(target);
}

export interface TargetValidation {
  ok: boolean;
  kind?: "local" | "remote";
  reason?: string;
}

/**
 * The feature is explicitly "a GitHub URL" — a bare read of a PUBLIC repo. So
 * remote targets are gated by an ALLOWLIST of public git hosts, not a blocklist
 * of private ranges. An allowlist eliminates the whole SSRF / IP-encoding-bypass
 * class BY CONSTRUCTION: a lexical private-IP blocklist is bypassable (a hostname
 * that DNS-resolves to a private address, integer/short/hex/octal IPv4 literals,
 * IPv4-mapped IPv6, a trailing-dot FQDN) — every one of those simply isn't on the
 * allowlist, so it never reaches `git clone`.
 */
export const ALLOWED_REMOTE_HOSTS = new Set(["github.com", "gitlab.com", "bitbucket.org"]);

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
  m = /^(?:www\.)?((?:github|gitlab)\.com|bitbucket\.org)\//i.exec(t);
  if (m) return m[1].toLowerCase();
  return null;
}

/** True iff `host` is an allowed PUBLIC git host. Normalizes a leading `www.`
 *  and a single trailing FQDN dot before the exact-match check (so `github.com.`
 *  / `www.github.com` still resolve to GitHub) — everything else is rejected. */
export function hostIsAllowed(host: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, "").replace(/^www\./, "");
  return ALLOWED_REMOTE_HOSTS.has(h);
}

const PLAUSIBLE_URL_RES = [
  /^https?:\/\/[^\s/]+\/[^\s/]+\/[^\s]+/i, // https://host/owner/repo
  /^ssh:\/\/[^\s]+\/[^\s/]+\/[^\s]+/i, // ssh://host/owner/repo
  /^git:\/\/[^\s]+\/[^\s/]+\/[^\s]+/i, // git://host/owner/repo
  /^git@[^\s:]+:[^\s/]+\/[^\s]+/i, // git@host:owner/repo
  /^(?:www\.)?(?:(?:github|gitlab)\.com|bitbucket\.org)\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+/i, // host/owner/repo
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
    // ALLOWLIST gate (SSRF): only public GitHub / GitLab / Bitbucket hosts. Any
    // other host — a private-IP literal in ANY encoding, a rebinding hostname, an
    // internal name — is rejected here and never reaches `git clone`.
    const host = extractRemoteHost(t);
    if (!host || !hostIsAllowed(host)) {
      return {
        ok: false,
        reason: "Only public GitHub, GitLab or Bitbucket repository URLs are supported.",
      };
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
