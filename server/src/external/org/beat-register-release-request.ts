/*
 * external/org/beat-register-release-request.ts — request validation +
 * `performRelease` call + error-to-status mapping, as ONE function shared by
 * both the secret-gated route (`beat-register-release.ts`) and the plain
 * browser-facing proxy (`routes/org.ts`) — review finding: the two route
 * shells were on track to duplicate this whole body, which would have let
 * their contracts drift silently. Split out of `beat-register-release-
 * core.ts` (which owns `performRelease` itself) to stay under the 300-line
 * file guideline.
 *
 * External-review fix (Branch A, GLM, medium): `lstat`/`lockOptions`/`now`
 * are defaulted HERE, once, rather than by each route shell separately —
 * two independent `?? realDefault` sites for the same three deps would
 * have been exactly the drift risk finding #5 already extracted this
 * function to prevent, just moved one layer down.
 */

import { lstatSync } from "node:fs";

import type { LstatFn } from "./beat-register.js";
import {
  performRelease,
  DEFAULT_LOCK_OPTIONS,
  OrgSymlinkEscapeError,
  BeatRegisterInvalidError,
  type BeatRegisterLockOptions,
  type ReleaseOutcome,
} from "./beat-register-release-core.js";

export interface HandleReleaseRequestDeps {
  leadsRoot: string;
  lstatSync?: LstatFn;
  lockOptions?: BeatRegisterLockOptions;
  now?: () => Date;
}

const RELEASE_REASON_MAX_LENGTH = 500;
// Doubt-review fix (Stage 3, medium/correctness): no `/i` flag. Entry
// matching in `beat-register-release-core.ts` is an exact `===` string
// comparison, never normalized — leadwright's own writer always produces
// `crypto.randomUUID()`, which is defined to be lowercase, so the register
// can never legitimately hold an uppercase-cased entry. Accepting a
// differently-cased-but-otherwise-valid sessionId here let it pass
// validation and then silently miss its real (lowercase) register entry,
// returning 404 not-found for an entry that genuinely exists.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export interface ReleaseRequestResult {
  status: 200 | 400 | 403 | 404 | 409 | 502;
  body: Record<string, unknown>;
}

/**
 * `rawBody` is the already-JSON-parsed request body (or `undefined`/`null`
 * on a parse failure the caller has already turned into its own 400) —
 * parsing itself stays in each Hono shell since only it knows how to read
 * `c.req`.
 */
export async function handleReleaseRequest(
  deps: HandleReleaseRequestDeps,
  leadId: string,
  rawBody: unknown,
): Promise<ReleaseRequestResult> {
  const { sessionId, reason } = (rawBody ?? {}) as { sessionId?: unknown; reason?: unknown };
  if (typeof sessionId !== "string" || !UUID_RE.test(sessionId)) {
    return { status: 400, body: { error: "sessionId_invalid" } };
  }
  // External-review fix (Branch A/OpenAI, medium): validate the TRIMMED
  // reason, not the raw string. The client-side prompt already trims before
  // calling, but this is the plain browser-facing route — any caller that
  // skips the UI (a script, a differently-behaved future client) could send
  // whitespace-only text, which `.length` alone would accept, forcing a
  // release with an audit record that carries no real justification.
  const trimmedReason = typeof reason === "string" ? reason.trim() : "";
  if (
    typeof reason !== "string" ||
    trimmedReason.length === 0 ||
    trimmedReason.length > RELEASE_REASON_MAX_LENGTH
  ) {
    return {
      status: 400,
      body: { error: "reason_invalid", detail: `must be 1-${RELEASE_REASON_MAX_LENGTH} chars` },
    };
  }

  const resolvedDeps = {
    leadsRoot: deps.leadsRoot,
    lockOptions: deps.lockOptions ?? DEFAULT_LOCK_OPTIONS,
    now: deps.now ?? (() => new Date()),
    lstat: deps.lstatSync ?? ((p: string) => lstatSync(p)),
  };

  let outcome: ReleaseOutcome;
  try {
    outcome = await performRelease(resolvedDeps, leadId, sessionId, trimmedReason);
  } catch (err) {
    if (err instanceof OrgSymlinkEscapeError) {
      return { status: 403, body: { error: "symlink_forbidden", path: err.path } };
    }
    if (err instanceof BeatRegisterInvalidError) {
      return { status: 502, body: { error: "beat_register_invalid", leadId } };
    }
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === "ELOCKED") {
      return { status: 409, body: { error: "beat_register_locked", leadId } };
    }
    throw err;
  }

  if (!outcome.ok) {
    // "fault" (duplicate sessionId — trap #3, never resolved by picking
    // one) is a structural data conflict, not "nothing here": 409, not 404.
    const status = outcome.reason === "fault" ? 409 : 404;
    return { status, body: { ok: false, reason: outcome.reason, detail: outcome.detail } };
  }
  if (!outcome.recovered) {
    return { status: 200, body: { ok: true, recovered: false } };
  }
  return {
    status: 200,
    body: { ok: true, recovered: true, residualLockWarning: outcome.residualLockWarning },
  };
}
