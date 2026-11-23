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

import { decisionKeyOf } from "./proposed-decision-key.js";
import { proposalFacts, proposalFingerprint, checkEditedLine, checkOriginalLine, toLoggedLineBlock, loggedLineOf, loggedFingerprintOf, isEdited, type ProposalFacts } from "./proposed-line.js";
import { ensureDecisionAudit, hasDecisionAudit, assertAuditAppendable, type DecisionAuditDeps } from "./decisions-audit.js";
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

export function atomicWrite(target: string, content: string): void {
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
  | { status: "countersigned"; number: number; edited: boolean }
  | { status: "already_countersigned"; number: number }
  | { status: "not_found" }
  | { status: "reject_pending" }
  | { status: "line_rejected"; error: "line_empty" | "line_too_long" | "line_contains_quote" | "edit_not_supported" }
  | { status: "duplicate_identity"; count: number };

export interface CountersignCoreDeps extends DecisionsLockDeps, Partial<Omit<DecisionAuditDeps, "leadsRoot">> {
  /** Who countersigns (audit record). Defaults to "operator". */
  author?: string;
  /** Injectable for tests; production wires the real `withDecisionsLock`. */
  withDecisionsLock?: typeof withDecisionsLock;
}

export async function performCountersign(
  deps: CountersignCoreDeps,
  timestamp: string,
  leadId: string,
  /** The operator's edited proposed line (fenced entries only); absent = approve as proposed. */
  editedLine?: string | null,
): Promise<CountersignOutcome> {
  const lockFn = deps.withDecisionsLock ?? withDecisionsLock;
  const audit = (ts: string, lead: string, block: string, number: number, edited: boolean, facts: ProposalFacts | null): void => {
    ensureDecisionAudit(deps, {
      edited,
      evidence: facts?.evidence ?? null,
      kind: "decision_countersigned",
      leadId: lead,
      author: deps.author ?? "operator",
      entryTimestamp: ts,
      decisionKey: decisionKeyOf(block),
      adr: `ADR-${String(number).padStart(4, "0")}`,
    });
  };
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
        const facts = proposalFacts(stillProposed.block);
        // A fenced entry's log holds only the (possibly edited) line plus a fingerprint of the proposed
        // block: identity is told apart by that fingerprint, whatever line this retry sends. A log block
        // written before W4 (whole entry) is compared the old way.
        const fingerprint = loggedFingerprintOf(existing.block);
        const loggedLine = facts === null ? null : loggedLineOf(existing.block);
        const sameProposal = fingerprint !== null
          ? fingerprint === proposalFingerprint(stillProposed.block)
          : bodyAfterHeader(toLoggedBlock(stillProposed.block, existing.number)).trimEnd() === bodyAfterHeader(existing.block).trimEnd();
        if (!sameProposal) return { status: "duplicate_identity", count: 2 };
        // Crash between the log write and the audit line: complete it (once).
        try {
          audit(timestamp, leadId, stillProposed.block, existing.number, facts !== null && loggedLine !== null && isEdited(facts, loggedLine), facts);
        } catch {
          // The log is the source of truth: a broken audit file must not keep an approved entry listed.
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

    // A reject was recorded but the entry is still listed (crash residue, or a line a
    // lead wrote into its own audit.jsonl): never approve it, and change nothing - an
    // audit line alone must not be able to delete a proposal. Reject finishes it.
    if (hasDecisionAudit(deps, "decision_rejected", leadId, timestamp, decisionKeyOf(target.block))) {
      return { status: "reject_pending" };
    }

    // Fail before anything changes when the audit file cannot be read (symlink, not a file).
    assertAuditAppendable(deps, leadId);

    const facts = proposalFacts(target.block);
    let finalLine: string | null = null;
    if (facts === null) {
      if (editedLine != null) return { status: "line_rejected", error: "edit_not_supported" };
    } else {
      const verdict = editedLine != null ? checkEditedLine(editedLine, facts) : checkOriginalLine(facts);
      if (!verdict.ok) return { status: "line_rejected", error: verdict.error };
      finalLine = verdict.line;
    }
    const edited = facts !== null && finalLine !== null && isEdited(facts, finalLine);

    const number = nextLoggedNumber(loggedEntries);
    const loggedBlock = facts === null || finalLine === null ? toLoggedBlock(target.block, number) : toLoggedLineBlock(target, number, finalLine);
    const separator = loggedRaw.length > 0 && !loggedRaw.endsWith("\n") ? "\n" : "";
    const nextLogged = loggedRaw + separator + loggedBlock;
    const nextProposed =
      proposedRaw.slice(0, target.startIndex) + proposedRaw.slice(target.endIndex);

    // Log FIRST (durable), then remove from proposed — the idempotent-retry
    // check above trusts decision_log.md as "already done".
    atomicWrite(ctx.loggedPath, nextLogged);
    audit(timestamp, leadId, target.block, number, edited, facts);
    atomicWrite(ctx.proposedPath, nextProposed);

    return { status: "countersigned", number, edited };
  });
}
