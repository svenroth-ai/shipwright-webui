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
 *     equal-`ts` tie but loses to a pending local outbox flip.
 *   - Read-only: this module NEVER mutates the working tree. `originRawLines`
 *     is produced by a `git show`/`git fetch` layer that only touches the
 *     object DB and remote-tracking refs.
 *   - Graceful degrade: `originRawLines === null` (origin unavailable — no
 *     upstream, offline, git error, feature-flag off) resolves EXACTLY the
 *     local union, i.e. identical to `readAllItems`. So the board is never
 *     worse than today.
 */

import type { TriageItem } from "../types/triage.js";
import {
  readLocalRawLinesSplit,
  resolveUnion,
} from "./triage-store.js";

export interface DeliveredOriginOptions {
  /**
   * Parsed raw JSONL lines from `origin/<default>:.shipwright/triage.jsonl`,
   * or `null` when origin is unavailable / the feature is off. `null` ⇒
   * local-only resolution (identical to `readAllItems`).
   */
  originRawLines: Record<string, unknown>[] | null;
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
  const { tracked, outbox } = readLocalRawLinesSplit(trackedPath);
  const origin = opts.originRawLines ?? [];
  // [tracked, origin, outbox] — outbox last (freshest local intent wins ties);
  // origin between (beats stale tracked, loses to pending outbox). When origin
  // is null/empty this is exactly `[...tracked, ...outbox]` = the local union.
  return resolveUnion([...tracked, ...origin, ...outbox]);
}
