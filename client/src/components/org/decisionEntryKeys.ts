/*
 * decisionEntryKeys — the per-row identity of the proposals window. A row is identified by its
 * (timestamp, lead) pair plus the ORDINAL among rows sharing that pair - never by its list position,
 * so a refetch that removes another row cannot slide a different proposal under this row's state.
 * Two rows with one pair (409 duplicate_proposal_identity) still get distinct keys.
 */
import type { ProposedDecisionEntry } from "../../lib/orgDecisionsApi";

export const entryKey = (e: ProposedDecisionEntry, ordinal: number) => `${e.timestamp}|${e.leadId}|${ordinal}`;

export function entryKeys(entries: readonly ProposedDecisionEntry[]): string[] {
  const seen = new Map<string, number>();
  return entries.map((e) => {
    const pair = `${e.timestamp}|${e.leadId}`;
    const n = seen.get(pair) ?? 0;
    seen.set(pair, n + 1);
    return entryKey(e, n);
  });
}
