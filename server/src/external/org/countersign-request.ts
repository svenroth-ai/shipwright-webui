/*
 * external/org/countersign-request.ts — request validation +
 * `performCountersign` call + error-to-status mapping, as ONE function
 * shared by both the secret-gated route (`countersign.ts`) and the plain
 * browser-facing proxy (`routes/org.ts`) — same rationale as
 * `beat-register-release-request.ts`: two independent route shells must not
 * be free to duplicate (and silently drift on) this body.
 */

import { performCountersign, type CountersignCoreDeps, type CountersignOutcome } from "./countersign-core.js";
import { OrgSymlinkEscapeError } from "./decisions-lock.js";
import { LEAD_ID_RE } from "./_helpers.js";

/** Canonical ISO-8601 UTC ('Z') timestamp — the transfer format's own shape
 *  (spec: "Design decisions I own"). Tolerates 0-N fractional-second digits. */
const ISO_TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

export type HandleCountersignRequestDeps = CountersignCoreDeps;

export interface CountersignRequestResult {
  status: 200 | 400 | 403 | 404 | 409;
  body: Record<string, unknown>;
}

/**
 * `rawBody` is the already-JSON-parsed request body (or `undefined`/`null`
 * on a parse failure the caller has already turned into its own 400) —
 * parsing itself stays in each Hono shell since only it knows how to read
 * `c.req`.
 */
export async function handleCountersignRequest(
  deps: HandleCountersignRequestDeps,
  rawBody: unknown,
): Promise<CountersignRequestResult> {
  const { timestamp, leadId } = (rawBody ?? {}) as { timestamp?: unknown; leadId?: unknown };
  if (typeof timestamp !== "string" || timestamp.length === 0) {
    return { status: 400, body: { error: "timestamp_required" } };
  }
  if (typeof leadId !== "string" || leadId.length === 0) {
    return { status: 400, body: { error: "leadId_required" } };
  }
  // External-review fix (MEDIUM, spec): the transfer format's identity pair
  // is a canonical ISO-8601 timestamp + a kebab-case lead id, not merely
  // "any non-empty string" — an arbitrary value silently 404s as
  // proposal_not_found instead of being rejected as malformed input.
  //
  // Doubt-review fix (LOW): `$` without the `/m` flag still matches just
  // before a single trailing "\n" (JS regex semantics, not just true
  // end-of-input) — reject a literal newline explicitly first, so
  // "<valid-ts>\n" 400s as timestamp_invalid instead of passing this check
  // and only failing later, less precisely, as proposal_not_found.
  if (timestamp.includes("\n") || !ISO_TIMESTAMP_RE.test(timestamp)) {
    return { status: 400, body: { error: "timestamp_invalid", timestamp } };
  }
  if (!LEAD_ID_RE.test(leadId)) {
    return { status: 400, body: { error: "leadId_invalid", leadId } };
  }

  let outcome: CountersignOutcome;
  try {
    outcome = await performCountersign(deps, timestamp, leadId);
  } catch (err) {
    // Code-review fix: without this, a symlinked decisions-proposed.md /
    // decision_log.md fell through to the generic 500 error handler
    // instead of the family's typed 403 symlink_forbidden (file-write.ts
    // applies the same defense class explicitly).
    if (err instanceof OrgSymlinkEscapeError) {
      return { status: 403, body: { error: "symlink_forbidden", path: err.path } };
    }
    throw err;
  }

  if (outcome.status === "not_found") {
    return { status: 404, body: { error: "proposal_not_found", timestamp, leadId } };
  }
  if (outcome.status === "duplicate_identity") {
    return {
      status: 409,
      body: { error: "duplicate_proposal_identity", timestamp, leadId, count: outcome.count },
    };
  }
  return {
    status: 200,
    body: {
      countersigned: true,
      alreadyCountersigned: outcome.status === "already_countersigned",
      number: outcome.number,
      adr: `ADR-${String(outcome.number).padStart(4, "0")}`,
    },
  };
}
