/*
 * external/org/countersign.ts — POST /api/external/org/decisions/countersign.
 *
 * Moves EXACTLY ONE entry from `decisions-proposed.md` to `decision_log.md`,
 * assigning the next sequential `ADR-NNNN` number inside the FR-04.28 lock
 * (`decisions-lock.ts`). Two plan-review fixes baked in from the start:
 *
 *   - Request identifies the entry by `{timestamp, leadId}`, not timestamp
 *     alone (two leads, or two proposals in the same wall-clock second,
 *     could otherwise collide).
 *   - Crash-safe / idempotent retry: `decision_log.md` is the source of
 *     truth for "already done" — if an entry with the same
 *     (timestamp, leadId) is already logged, the action does NOT mint a
 *     second number; it just makes sure the proposed-side copy is (still)
 *     removed and returns the existing number. This is why the log write
 *     happens BEFORE the proposed-side removal: a crash between the two
 *     leaves `decision_log.md` durable and the retry finds it there.
 *
 * External-review fix (MEDIUM, edge-case): "(timestamp, leadId) as identity"
 * does not guarantee UNIQUENESS by construction, only disambiguation in the
 * common case — the daemon could still write two genuinely distinct
 * proposals sharing the same pair (e.g. two rapid proposals from one lead in
 * the same wall-clock second). Both the initial-match and the
 * idempotent-retry path now count matches: exactly one proceeds as before;
 * two or more is a `409 duplicate_proposal_identity` conflict rather than
 * silently discarding every match past the first.
 */

import type { Hono } from "hono";
import { writeFileSync, renameSync, existsSync, unlinkSync } from "node:fs";
import { dirname, basename, join } from "node:path";
import { randomBytes } from "node:crypto";

import {
  withDecisionsLock,
  parseProposedEntries,
  parseLoggedEntries,
  findLoggedEntry,
  nextLoggedNumber,
  toLoggedBlock,
  OrgSymlinkEscapeError,
  type DecisionsLockDeps,
} from "./decisions-lock.js";
import { LEAD_ID_RE } from "./_helpers.js";

/** Canonical ISO-8601 UTC ('Z') timestamp — the transfer format's own shape
 *  (spec: "Design decisions I own"). Tolerates 0-N fractional-second digits. */
const ISO_TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

function atomicWrite(target: string, content: string): void {
  const tmp = join(
    dirname(target),
    `.${basename(target)}.tmp-${process.pid}-${Date.now()}-${randomBytes(4).toString("hex")}`,
  );
  try {
    writeFileSync(tmp, content, "utf8");
    renameSync(tmp, target);
  } catch (err) {
    // Doubt-review fix (minor): mirror file-write.ts's performWrite — don't
    // leave an orphaned .tmp-* file behind on a failed rename.
    try {
      if (existsSync(tmp)) unlinkSync(tmp);
    } catch {
      /* swallow */
    }
    throw err;
  }
}

type CountersignOutcome =
  | { status: "countersigned"; number: number }
  | { status: "already_countersigned"; number: number }
  | { status: "not_found" }
  | { status: "duplicate_identity"; count: number };

async function countersign(
  deps: CountersignRouteDeps,
  timestamp: string,
  leadId: string,
): Promise<CountersignOutcome> {
  const lockFn = deps.withDecisionsLock ?? withDecisionsLock;
  return lockFn(deps, (ctx) => {
    const loggedRaw = ctx.readLogged();
    const loggedEntries = parseLoggedEntries(loggedRaw);

    const existing = findLoggedEntry(loggedEntries, timestamp, leadId);
    if (existing) {
      const proposedRaw = ctx.readProposed();
      // External-review fix (MEDIUM, edge-case): two genuinely-distinct
      // proposals can share the same (timestamp, leadId) pair (the ADR that
      // adopted the pair as identity already acknowledged timestamp
      // collisions are possible). `.find()` here used to silently discard
      // every residual match past the first without ever logging it —
      // indistinguishable from ordinary post-countersign cleanup. `.filter()`
      // lets a genuine duplicate surface as a conflict instead.
      const stillProposedMatches = parseProposedEntries(proposedRaw).filter(
        (e) => e.timestamp === timestamp && e.leadId === leadId,
      );
      if (stillProposedMatches.length > 1) {
        return { status: "duplicate_identity", count: stillProposedMatches.length };
      }
      if (stillProposedMatches.length === 1) {
        const stillProposed = stillProposedMatches[0];
        const nextProposed =
          proposedRaw.slice(0, stillProposed.startIndex) +
          proposedRaw.slice(stillProposed.endIndex);
        atomicWrite(ctx.proposedPath, nextProposed);
      }
      return { status: "already_countersigned", number: existing.number };
    }

    const proposedRaw = ctx.readProposed();
    const matches = parseProposedEntries(proposedRaw).filter(
      (e) => e.timestamp === timestamp && e.leadId === leadId,
    );
    if (matches.length === 0) {
      return { status: "not_found" };
    }
    if (matches.length > 1) {
      return { status: "duplicate_identity", count: matches.length };
    }
    const target = matches[0];

    const number = nextLoggedNumber(loggedEntries);
    const loggedBlock = toLoggedBlock(target.block, number);
    const separator = loggedRaw.length > 0 && !loggedRaw.endsWith("\n") ? "\n" : "";
    const nextLogged = loggedRaw + separator + loggedBlock;
    const nextProposed =
      proposedRaw.slice(0, target.startIndex) + proposedRaw.slice(target.endIndex);

    // Log FIRST (durable), then remove from proposed — the idempotent-retry
    // check above trusts decision_log.md as "already done".
    atomicWrite(ctx.loggedPath, nextLogged);
    atomicWrite(ctx.proposedPath, nextProposed);

    return { status: "countersigned", number };
  });
}

export interface CountersignRouteDeps extends DecisionsLockDeps {
  /** Injectable for tests; production wires the real `withDecisionsLock`. */
  withDecisionsLock?: typeof withDecisionsLock;
}

export function registerCountersignRoute(app: Hono, deps: CountersignRouteDeps): void {
  app.post("/api/external/org/decisions/countersign", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid_json" }, 400);
    }
    const { timestamp, leadId } = (body ?? {}) as {
      timestamp?: unknown;
      leadId?: unknown;
    };
    if (typeof timestamp !== "string" || timestamp.length === 0) {
      return c.json({ error: "timestamp_required" }, 400);
    }
    if (typeof leadId !== "string" || leadId.length === 0) {
      return c.json({ error: "leadId_required" }, 400);
    }
    // External-review fix (MEDIUM, spec): the transfer format's identity pair
    // is a canonical ISO-8601 timestamp + a kebab-case lead id, not merely
    // "any non-empty string" — an arbitrary value silently 404s as
    // proposal_not_found instead of being rejected as malformed input.
    if (!ISO_TIMESTAMP_RE.test(timestamp)) {
      return c.json({ error: "timestamp_invalid", timestamp }, 400);
    }
    if (!LEAD_ID_RE.test(leadId)) {
      return c.json({ error: "leadId_invalid", leadId }, 400);
    }

    let outcome: CountersignOutcome;
    try {
      outcome = await countersign(deps, timestamp, leadId);
    } catch (err) {
      // Code-review fix: without this, a symlinked decisions-proposed.md /
      // decision_log.md fell through to the generic 500 error handler
      // instead of the family's typed 403 symlink_forbidden (file-write.ts
      // applies the same defense class explicitly).
      if (err instanceof OrgSymlinkEscapeError) {
        return c.json({ error: "symlink_forbidden", path: err.path }, 403);
      }
      throw err;
    }

    if (outcome.status === "not_found") {
      return c.json({ error: "proposal_not_found", timestamp, leadId }, 404);
    }
    if (outcome.status === "duplicate_identity") {
      return c.json(
        { error: "duplicate_proposal_identity", timestamp, leadId, count: outcome.count },
        409,
      );
    }
    return c.json({
      countersigned: true,
      alreadyCountersigned: outcome.status === "already_countersigned",
      number: outcome.number,
      adr: `ADR-${String(outcome.number).padStart(4, "0")}`,
    });
  });
}
