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
import { AuditUnwritableError } from "./decisions-audit.js";
import { osAuthor, parseDecisionIdentity, auditUnwritableResult, FINGERPRINT_RE } from "./decision-request-common.js";

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
  const body = (rawBody ?? {}) as { timestamp?: unknown; leadId?: unknown; line?: unknown; fingerprint?: unknown };
  const id = parseDecisionIdentity(body);
  if (!id.ok) return { status: id.status, body: id.body };
  const { timestamp, leadId } = id;
  const { line, fingerprint } = body;

  if (line !== undefined && line !== null && typeof line !== "string") {
    return { status: 400, body: { error: "line_invalid" } };
  }
  if (fingerprint !== undefined && fingerprint !== null && (typeof fingerprint !== "string" || !FINGERPRINT_RE.test(fingerprint))) {
    return { status: 400, body: { error: "fingerprint_invalid" } };
  }

  let outcome: CountersignOutcome;
  try {
    outcome = await performCountersign({ ...deps, author: deps.author ?? osAuthor() }, timestamp, leadId, line, fingerprint);
  } catch (err) {
    // Code-review fix: without this, a symlinked decisions-proposed.md /
    // decision_log.md fell through to the generic 500 error handler
    // instead of the family's typed 403 symlink_forbidden (file-write.ts
    // applies the same defense class explicitly).
    if (err instanceof OrgSymlinkEscapeError) {
      return { status: 403, body: { error: "symlink_forbidden", path: err.path } };
    }
    if (err instanceof AuditUnwritableError) return auditUnwritableResult(err);
    throw err;
  }

  if (outcome.status === "not_found") {
    return { status: 404, body: { error: "proposal_not_found", timestamp, leadId } };
  }
  if (outcome.status === "line_rejected") {
    return { status: 400, body: { error: outcome.error, timestamp, leadId } };
  }
  if (outcome.status === "reject_pending") {
    return { status: 409, body: { error: "reject_pending", timestamp, leadId } };
  }
  if (outcome.status === "entry_changed") {
    return { status: 409, body: { error: "entry_changed", timestamp, leadId } };
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
      edited: outcome.status === "countersigned" ? outcome.edited : undefined,
      loggedLineDiffers: outcome.status === "already_countersigned" && outcome.loggedLineDiffers === true ? true : undefined,
      adr: `ADR-${String(outcome.number).padStart(4, "0")}`,
    },
  };
}
