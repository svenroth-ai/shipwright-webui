/*
 * external/org/_helpers.ts — shared primitives for the leadwright
 * org-directory route family (`/api/external/org/*`, FR-04.38,
 * iterate-2026-08-17-org-route-leads).
 *
 * Three independent gates + one allowlist, kept pure/side-effect-free so
 * each is unit-testable without a running Hono app:
 *   - `isAllowedOrgRouteHost`  — the bind-host allowlist (loopback ∪
 *     Tailscale 100.64.0.0/10). Checked against the resolved bind host
 *     PASSED IN by the caller (`resolveHonoHost` computed once at startup),
 *     never re-derived per request.
 *   - `checkOrgSecret`        — the shared-secret gate, constant-time.
 *   - `resolveOrgAllowlistedTarget` — the six-target allowlist for both
 *     GET and PUT (`org-chart.json` is deliberately absent — it has its
 *     own typed endpoint, see `org-chart.ts`).
 *   - `LEADS_USAGE_REFRESH_INTERVAL_MS` — the named refresh-cadence
 *     constant for Punkt 8's consumption read interface.
 */

import { timingSafeEqual, createHash } from "node:crypto";

import { pathGuard } from "../../core/path-guard.js";

// ---------------------------------------------------------------------------
// Host allowlist (FR-04.38 Auflage 1) — PO decision 2026-08-16: loopback OR
// Tailscale (100.64.0.0/10), NOT a denylist of the three known open-bind
// values (see lead-model-spec.md:2465, and the iterate spec's Architecture
// Review reconciliation for why this supersedes the triage doc's stale
// "Tailscale denied" bullet).
// ---------------------------------------------------------------------------

const IPV4_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

function parseIPv4(host: string): number[] | null {
  const m = IPV4_RE.exec(host);
  if (!m) return null;
  const octets = [m[1], m[2], m[3], m[4]].map(Number);
  if (octets.some((o) => o > 255)) return null;
  return octets;
}

/** 127.0.0.0/8 — IPv4 loopback range (not just 127.0.0.1). */
function isLoopbackIPv4(host: string): boolean {
  const octets = parseIPv4(host);
  return octets !== null && octets[0] === 127;
}

/** 100.64.0.0/10 — Carrier-Grade NAT range Tailscale allocates from. */
function isTailscaleRangeIPv4(host: string): boolean {
  const octets = parseIPv4(host);
  return octets !== null && octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127;
}

/**
 * True when `host` (the application's resolved BIND host — see
 * `resolveHonoHost.ts`, passed through, never re-derived here) is loopback
 * or within the Tailscale CGNAT range. `0.0.0.0`, `::`, and any other
 * wide-open or unrecognized value are denied — this is an ALLOWLIST, not a
 * denylist of known-bad values.
 */
export function isAllowedOrgRouteHost(host: string): boolean {
  const h = host.trim();
  if (h === "::1") return true;
  return isLoopbackIPv4(h) || isTailscaleRangeIPv4(h);
}

// ---------------------------------------------------------------------------
// Secret gate (FR-04.38 Auflage 2).
// ---------------------------------------------------------------------------

export type OrgSecretCheckResult = "ok" | "not_configured" | "invalid";

/**
 * Constant-time comparison against the configured secret. Returns
 * `"not_configured"` when the server has no secret set (fail-closed —
 * distinguishable from a wrong/missing header so an operator can tell
 * "misconfigured" from "unauthorized").
 *
 * Code-review fix: an `a.length !== b.length` short-circuit BEFORE
 * `timingSafeEqual` — the obvious first draft — reintroduces the exact
 * timing side-channel `timingSafeEqual` exists to close (a wrong-length
 * guess returns fast; a same-length wrong guess is measurably slower).
 * Both inputs are hashed to a fixed-length digest first, so the two
 * `timingSafeEqual` operands are ALWAYS 32 bytes regardless of the
 * provided header's length, and the length check is gone entirely.
 */
export function checkOrgSecret(
  configuredSecret: string | undefined,
  providedHeader: string | undefined | null,
): OrgSecretCheckResult {
  if (!configuredSecret) return "not_configured";
  if (!providedHeader) return "invalid";
  const a = createHash("sha256").update(configuredSecret, "utf8").digest();
  const b = createHash("sha256").update(providedHeader, "utf8").digest();
  return timingSafeEqual(a, b) ? "ok" : "invalid";
}

// ---------------------------------------------------------------------------
// Write/read allowlist (FR-04.38 Auflage 3) — six named target kinds.
// `org-chart.json` is deliberately NOT here (readable only, via its own
// typed endpoint — see org-chart.ts).
// ---------------------------------------------------------------------------

export type OrgAllowlistedKind =
  | "conventions"
  | "decision_log"
  | "principal"
  | "agents"
  | "decisions_proposed"
  | "charter";

/** The five literal, lead-independent org documents. */
export const ORG_ALLOWLIST_LITERALS: ReadonlyArray<{
  path: string;
  kind: OrgAllowlistedKind;
}> = [
  { path: "conventions.md", kind: "conventions" },
  { path: "decision_log.md", kind: "decision_log" },
  { path: "principal.md", kind: "principal" },
  { path: "AGENTS.md", kind: "agents" },
  { path: "decisions-proposed.md", kind: "decisions_proposed" },
];

const CHARTER_SUFFIX = "/charter.md";
/**
 * Mirrors `leadwright/lib/org-chart.ts`'s `LEAD_ID_RE` (kebab-case,
 * lowercase-alnum start). Exported so every consumer of a lead-id
 * (the charter-pattern check here, and the usage route's `:leadId` param)
 * shares ONE validator rather than drifting apart — plan-review finding
 * (iterate-2026-08-17-org-route-leads plan review, both reviewers).
 */
export const LEAD_ID_RE = /^[a-z0-9][a-z0-9-]*$/;

export type OrgTargetReason =
  | "traversal"
  | "absolute_input"
  | "drive_change"
  | "not_allowlisted";

export type OrgTargetResolution =
  | { ok: true; absolute: string; kind: OrgAllowlistedKind }
  | { ok: false; reason: OrgTargetReason };

/**
 * Resolve `relpath` against `leadsRoot`, requiring BOTH a clean
 * (non-traversing) path AND membership in the six-entry allowlist — the
 * sixth entry (`<lead-id>/charter.md`) is a pattern, not a literal, so the
 * "six allowed target kinds" is `ORG_ALLOWLIST_LITERALS.length + 1`.
 *
 * Classification runs against the path-guard's NORMALIZED relative path
 * (post `..`/`.`-resolution), not the raw input string, so `./conventions.md`
 * and `conventions.md` classify identically.
 */
export function resolveOrgAllowlistedTarget(
  leadsRoot: string,
  relpath: string,
): OrgTargetResolution {
  const guard = pathGuard(leadsRoot, relpath);
  if (!guard.ok) {
    return {
      ok: false,
      reason: guard.reason === "symlink_escape" ? "traversal" : guard.reason,
    };
  }

  const normalizedRel = guard.absolute
    .slice(leadsRoot.length)
    .replace(/^[/\\]+/, "")
    .replace(/\\/g, "/");

  const literal = ORG_ALLOWLIST_LITERALS.find((l) => l.path === normalizedRel);
  if (literal) {
    return { ok: true, absolute: guard.absolute, kind: literal.kind };
  }

  if (normalizedRel.endsWith(CHARTER_SUFFIX)) {
    const leadId = normalizedRel.slice(0, -CHARTER_SUFFIX.length);
    if (LEAD_ID_RE.test(leadId) && !leadId.includes("/")) {
      return { ok: true, absolute: guard.absolute, kind: "charter" };
    }
  }

  return { ok: false, reason: "not_allowlisted" };
}

// ---------------------------------------------------------------------------
// Consumption read interface (Punkt 8) — refresh cadence.
// ---------------------------------------------------------------------------

/**
 * Named refresh-cadence constant for the usage read interface
 * (`GET /api/external/org/leads/:leadId/usage`). This route itself does no
 * polling (stateless read, like every other external GET in this codebase)
 * — the constant documents the interval a future client poller should use,
 * so it doesn't have to invent its own.
 */
export const LEADS_USAGE_REFRESH_INTERVAL_MS = 5 * 60 * 1000;
