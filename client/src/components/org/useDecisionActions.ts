/*
 * useDecisionActions — the countersign / reject requests of the proposals window and the
 * per-row state they drive (statuses, pinned "settled" rows, the notice). Split out of
 * OrgDecisionsProposedModal.tsx to stay under the 300-line convention (campaign
 * shadow-proposals-webui, W4); behaviour is unchanged except that countersign can carry the
 * operator's edited line.
 *
 * E2E-fix (kept): a just-countersigned entry stays pinned in view (`settled`) showing its ADR
 * number until the modal closes - the refetch removes it from the server's list faster than a
 * human can read the "done" banner. Rows with a request in flight are guarded: a double click
 * sends ONE request.
 */
import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { countersignDecision, type ProposedDecisionEntry } from "../../lib/orgDecisionsApi";
import { rejectDecision } from "../../lib/orgRejectApi";
import type { EntryStatus } from "./DecisionEntryRow";

export const entryKey = (e: ProposedDecisionEntry, i: number) => `${e.timestamp}|${e.leadId}|${i}`;

const LINE_PROBLEMS: Record<string, string> = {
  line_empty: "The line is empty. Write the line you want in the log.",
  line_too_long: "The line is too long. Shorten it (2000 characters at most).",
  line_contains_quote: "Your line repeats a quote from the lead. Quotes never go into the log - rewrite it in your own words.",
  edit_not_supported: "This entry has no editable line.",
  line_invalid: "The line must be plain text.",
};

export function useDecisionActions(refetch: () => Promise<unknown>) {
  const queryClient = useQueryClient();
  const [statuses, setStatuses] = useState<Record<string, EntryStatus>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [settled, setSettled] = useState<Record<string, { entry: ProposedDecisionEntry; status: EntryStatus }>>({});
  const inFlight = useRef(new Set<string>());

  async function handleReject(entry: ProposedDecisionEntry, index: number, reason: string) {
    const key = entryKey(entry, index);
    const flightKey = `${entry.timestamp}|${entry.leadId}`; // not positional: survives a sibling's refetch
    if (inFlight.current.has(flightKey)) return;
    inFlight.current.add(flightKey);
    setStatuses((prev) => ({ ...prev, [key]: { kind: "pending" } }));
    try {
      const result = await rejectDecision(entry.timestamp, entry.leadId, reason);
      let status: EntryStatus;
      if (result.ok) status = { kind: "rejected", alreadyRejected: result.alreadyRejected };
      else if (result.reason === "duplicate") status = { kind: "duplicate", count: result.count };
      else if (result.reason === "already-countersigned") status = { kind: "done", alreadyCountersigned: true, adr: `ADR-${String(result.adr).padStart(4, "0")}` };
      else if (result.reason === "lead-unknown") status = { kind: "blocked", message: "Can't reject: this lead has no folder." };
      else status = { kind: "resolved-elsewhere" };
      setStatuses((prev) => ({ ...prev, [key]: status }));
      // The rejected row leaves the list (it is filtered below); the notice carries no quote text.
      if (status.kind === "rejected") setNotice(`Rejected: ${entry.leadId}, ${entry.timestamp}. Recorded in the audit log.`);
      if (status.kind !== "duplicate") {
        await Promise.all([
          refetch(),
          queryClient.invalidateQueries({ queryKey: ["org", "decisions-rejected-keys"] }),
        ]);
      }
    } catch (err) {
      setStatuses((prev) => ({
        ...prev,
        [key]: { kind: "error", message: err instanceof Error ? err.message : "unknown error" },
      }));
    } finally {
      inFlight.current.delete(flightKey);
    }
  }

  async function handleCountersign(entry: ProposedDecisionEntry, index: number, line?: string) {
    const key = entryKey(entry, index);
    const flightKey = `${entry.timestamp}|${entry.leadId}`; // not positional: survives a sibling's refetch
    if (inFlight.current.has(flightKey)) return;
    inFlight.current.add(flightKey);
    setStatuses((prev) => ({ ...prev, [key]: { kind: "pending" } }));
    try {
      const result = await countersignDecision(entry.timestamp, entry.leadId, line);
      if (!result.ok && result.reason === "duplicate") {
        setStatuses((prev) => ({ ...prev, [key]: { kind: "duplicate", count: result.count } }));
        return;
      }
      if (!result.ok && result.reason === "reject-pending") {
        setStatuses((prev) => ({ ...prev, [key]: { kind: "blocked", message: "This proposal was rejected but not removed. Use Reject to finish." } }));
        return;
      }
      if (!result.ok && result.reason === "line-rejected") {
        setStatuses((prev) => ({ ...prev, [key]: { kind: "blocked", message: LINE_PROBLEMS[result.code] ?? "The line was not accepted." } }));
        return;
      }
      if (!result.ok && result.reason === "not-found") {
        setStatuses((prev) => ({ ...prev, [key]: { kind: "resolved-elsewhere" } }));
        await refetch();
        return;
      }
      if (result.ok) {
        setStatuses((prev) => ({
          ...prev,
          [key]: { kind: "done", alreadyCountersigned: result.alreadyCountersigned, adr: result.adr, edited: result.edited },
        }));
        setSettled((prev) => ({
          ...prev,
          [key]: { entry, status: { kind: "done", alreadyCountersigned: result.alreadyCountersigned, adr: result.adr, edited: result.edited } },
        }));
        // Both surfaces observe the same countersign action's effect —
        // refresh the proposed list (the entry is gone) and the
        // decision_log.md tile (the new entry is there), without the PO
        // re-opening either.
        await Promise.all([
          refetch(),
          queryClient.invalidateQueries({ queryKey: ["org", "shared-doc", "decision_log.md"] }),
        ]);
      }
    } catch (err) {
      setStatuses((prev) => ({
        ...prev,
        [key]: { kind: "error", message: err instanceof Error ? err.message : "unknown error" },
      }));
    } finally {
      inFlight.current.delete(flightKey);
    }
  }

  return { statuses, settled, notice, handleReject, handleCountersign };
}
