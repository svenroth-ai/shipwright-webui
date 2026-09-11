/*
 * triage-compose.ts — delivered-origin 3-source composer.
 *
 * Root-cause fix for the "ghost" bug (WebUI Local-Main board re-showed items
 * the user had dismissed). The board read only the LOCAL union (tracked ∪
 * outbox). But on idle-main a dismiss routes to the gitignored outbox, an
 * external sweep delivers it to `origin` (iterate PR, merge=union) and GCs the
 * local outbox line — after which the local tracked file still has only the
 * `append`, the local outbox is empty, and the dismiss lives on origin only.
 * The board (never consulting origin) resolved the item OPEN again.
 *
 * This composer sources a THIRD set of raw lines — `git show
 * origin/<default>:.shipwright/triage.jsonl`, provided by `triage-origin.ts`
 * (cached by ref SHA; a background fetch keeps the ref fresh) — and resolves
 * the union with the SAME two-pass (ts, file-order) algorithm as the tracked ∪
 * outbox read. Origin is simply one more source of the identical event types.
 *
 * DESIGN GUARANTEES (external review, GPT-5.4 + Gemini 3.1 Pro):
 *   - `readAllItems` is NOT modified (it stays byte-for-byte parity-tested
 *     against the Python `read_all_items`); this is an additive composer.
 *   - Source order is EXACTLY `[local-tracked, origin, local-outbox]`. `ts` is
 *     primary; file-order only breaks equal-`ts` ties. Outbox stays LAST so the
 *     freshest LOCAL intent (a just-clicked dismiss not yet delivered) still
 *     wins an equal-`ts` tie — preserving the pre-existing tracked<outbox
 *     contract. Origin sits between: it beats stale local-tracked on an
 *     equal-`ts` tie but loses to a pending local outbox flip — for events not
 *     subject to the local-wins rule below (`amend`, or a `status` id with no
 *     local decision at all). A `status` id this tree HAS decided never reaches
 *     this tie-break at all: local-wins drops origin's event first, regardless
 *     of timestamp.
 *   - **Local status always outranks an origin status** (ported from Python
 *     `read_all_items`, iterate-2026-09-10-triage-cross-tree-precedence /
 *     iterate-2026-09-11-triage-compose-local-wins): an origin `status` event
 *     applies only when this tree's OWN tracked+outbox union has no `status`
 *     event for that id (`localStatusIds`) — a local decision can never be
 *     reopened by origin regardless of timestamp; origin still fills the gap
 *     for an id never locally decided. `amend` is unscoped by this rule — it
 *     stays purely chronological, same as before.
 *   - Read-only: this module NEVER mutates the working tree. `originRawLines`
 *     is produced by a `git show`/`git fetch` layer that only touches the
 *     object DB and remote-tracking refs.
 *   - Graceful degrade: `originRawLines === null` (origin unavailable — no
 *     upstream, offline, git error, feature-flag off) resolves EXACTLY the
 *     local union, i.e. identical to `readAllItems`. So the board is never
 *     worse than today.
 */

import type { TriageItem, TriageStatus } from "../types/triage.js";
import type { CorruptFragment } from "./jsonl-records.js";
import { applyDeferOverlay } from "./triage-defer.js";
import {
  STATUSES,
  readLocalRawLinesSplit,
  resolveUnion,
} from "./triage-store.js";

/** Ids with a valid `status` event — mirrors Python's `local_status_ids`
 * (iterate-2026-09-10-triage-cross-tree-precedence); used below to drop an
 * origin `status` already decided locally. */
function localStatusIds(rawLines: Record<string, unknown>[]): Set<string> {
  const ids = new Set<string>();
  for (const raw of rawLines) {
    if (
      raw.event === "status" &&
      typeof raw.id === "string" &&
      STATUSES.has(raw.newStatus as TriageStatus)
    ) {
      ids.add(raw.id);
    }
  }
  return ids;
}

export interface DeliveredOriginOptions {
  /**
   * Parsed raw JSONL lines from `origin/<default>:.shipwright/triage.jsonl`,
   * or `null` when origin is unavailable / the feature is off. `null` ⇒
   * local-only resolution (identical to `readAllItems`).
   */
  originRawLines: Record<string, unknown>[] | null;
  /**
   * Optional side channel for text on a LOCAL file that could not be decoded
   * (iterate-2026-07-18-triage-jsonl-record-boundary). Records recovered from
   * the same line are still returned — corruption must never read as absence.
   * Purely observational: omitting it leaves resolution byte-identical, which
   * keeps the "degrade == readAllItems" equivalence intact.
   *
   * Scoped to LOCAL files ON PURPOSE. `originRawLines` arrives already parsed
   * from `triage-origin.ts`, whose `originSnapshot` is SHA-keyed and has no
   * channel to carry fragments; more importantly an origin blob is COMMITTED
   * content read via `git show`, so corruption there is a repository defect to
   * fix at the source, not transient local damage an operator can act on from
   * a server log. Origin still gets full record-boundary RECOVERY (it shares
   * `parseRawLines`) — only the reporting stops here.
   */
  onCorrupt?: (fragment: CorruptFragment, source: "tracked" | "outbox") => void;
}

/**
 * Resolve the triage view for the board, unioning the local tracked + outbox
 * files with the delivered-origin snapshot. See the module header for the
 * ordering contract and degrade semantics.
 */
export function readAllItemsWithDeliveredOrigin(
  trackedPath: string,
  opts: DeliveredOriginOptions,
): TriageItem[] {
  const { tracked, outbox } = readLocalRawLinesSplit(trackedPath, opts.onCorrupt);
  const localStatused = localStatusIds([...tracked, ...outbox]);
  // Local-wins precedence (see module header): drop an origin `status` event
  // for an id this tree has already decided locally, before it ever reaches
  // resolveUnion's pass 2 — an id never locally decided passes origin's
  // status through unchanged (gap-fill). `amend` is untouched.
  const origin = (opts.originRawLines ?? []).filter(
    (raw) =>
      !(raw.event === "status" && (typeof raw.id !== "string" || localStatused.has(raw.id))),
  );
  // [tracked, origin, outbox] — outbox last (freshest local intent wins ties);
  // origin between (beats stale tracked, loses to pending outbox). When origin
  // is null/empty this is exactly `[...tracked, ...outbox]` = the local union.
  // Overlay applied exactly once, same as readAllItems — see triage-store.ts.
  return applyDeferOverlay(resolveUnion([...tracked, ...origin, ...outbox]), new Date());
}
