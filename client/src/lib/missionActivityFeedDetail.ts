import { excerpt } from "./missionActivityFeedText";
import type { ActivityCard } from "./missionActivityFeedTypes";

/** Attaches `detail`/`detailFull` from a bounded excerpt of raw tool-result
 *  content — the same "set `xFull` only when truncation actually happened"
 *  contract as every other `xFull` field ("nie croppen"). Used by
 *  `missionActivityFeedResolve.ts` for the test-failure and review branches. */
export function attachDetail(card: ActivityCard, content: string): void {
  card.detail = excerpt(content);
  const full = excerpt(content, Infinity, Infinity);
  if (full.length > card.detail.length) card.detailFull = full;
  else delete card.detailFull;
}
