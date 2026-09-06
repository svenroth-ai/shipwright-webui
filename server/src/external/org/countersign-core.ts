/*
 * external/org/countersign-core.ts — the pure countersign action
 * (`performCountersign`), split out of `countersign.ts` so the SAME action
 * can be shared, unmodified, by both the secret-gated route
 * (`countersign.ts`) and the plain browser-facing proxy (`routes/org.ts`) —
 * same rationale as `beat-register-release-core.ts` / `-request.ts`.
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
 * two or more is a `duplicate_identity` conflict rather than silently
 * discarding every match past the first.
 */

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
  type DecisionsLockDeps,
} from "./decisions-lock.js";

/** Body of a header-delimited block, i.e. everything after its first line —
 *  used to tell genuine residual-cleanup (same body) from a genuinely
 *  distinct proposal that happens to reuse the same (timestamp, leadId). */
function bodyAfterHeader(block: string): string {
  const idx = block.indexOf("\n");
  return idx === -1 ? "" : block.slice(idx + 1);
}

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

export type CountersignOutcome =
  | { status: "countersigned"; number: number }
  | { status: "already_countersigned"; number: number }
  | { status: "not_found" }
  | { status: "duplicate_identity"; count: number };

export interface CountersignCoreDeps extends DecisionsLockDeps {
  /** Injectable for tests; production wires the real `withDecisionsLock`. */
  withDecisionsLock?: typeof withDecisionsLock;
}

export async function performCountersign(
  deps: CountersignCoreDeps,
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
        // Doubt-review fix (HIGH): a single still-proposed match is only
        // safe to delete as residual cleanup if it's the SAME proposal
        // that's already logged (crash between the log-write and the
        // proposed-side removal). Without comparing bodies, a genuinely
        // distinct proposal that later reuses the same (timestamp, leadId)
        // pair — which this module's own header comment already treats as
        // a possible, not merely theoretical, collision — would be
        // silently deleted here and reported as "already countersigned"
        // under the OLD entry's ADR number, with no trace left anywhere.
        if (bodyAfterHeader(stillProposed.block) !== bodyAfterHeader(existing.block)) {
          return { status: "duplicate_identity", count: 2 };
        }
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
