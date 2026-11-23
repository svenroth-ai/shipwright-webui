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
import { blockDigest } from "../../lib/orgBlockDigest";
import type { EntryStatus } from "./DecisionEntryRow";

export const entryKey = (e: ProposedDecisionEntry, i: number) => `${e.timestamp}|${e.leadId}|${i}`;

const LINE_PROBLEMS: Record<string, string> = {
  line_empty: "The line is empty. Write the line you want in the log.",
  line_too_long: "The line is too long. Shorten it (2000 characters at most).",
  line_contains_quote: "Your line repeats a quote from the lead. Quotes never go into the log - rewrite it in your own words.",
  edit_not_supported: "This entry has no editable line.",
  line_invalid: "The line must be plain text.",
};

const CHANGED = "This proposal changed since you opened it — reload. The list was refreshed; read the new version before deciding.";
const UNWRITABLE = (message: string) => `Nothing was changed. ${message}`;

export function useDecisionActions(refetch: () => Promise<unknown>) {
  const queryClient = useQueryClient();
  const [statuses, setStatuses] = useState<Record<string, EntryStatus>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [settled, setSettled] = useState<Record<string, { entry: ProposedDecisionEntry; status: EntryStatus }>>({});
  const inFlight = useRef(new Set<string>());

  /** One place that records a row's final status (and pins a `done` row, which the refetch removes from the list). */
  function settle(key: string, entry: ProposedDecisionEntry, status: EntryStatus) {
    setStatuses((prev) => ({ ...prev, [key]: status }));
    if (status.kind === "done") setSettled((prev) => ({ ...prev, [key]: { entry, status } }));
  }

  async function handleReject(entry: ProposedDecisionEntry, index: number, reason: string) {
    const key = entryKey(entry, index);
    const flightKey = `${entry.timestamp}|${entry.leadId}`; // not positional: survives a sibling's refetch
    if (inFlight.current.has(flightKey)) return;
    inFlight.current.add(flightKey);
    setNotice(null); // a new action starts: the previous "Rejected" line no longer describes the window
    setStatuses((prev) => ({ ...prev, [key]: { kind: "pending" } }));
    try {
      const result = await rejectDecision(entry.timestamp, entry.leadId, reason, blockDigest(entry.block));
      let status: EntryStatus;
      if (result.ok) status = { kind: "rejected", alreadyRejected: result.alreadyRejected };
      else if (result.reason === "duplicate") status = { kind: "duplicate", count: result.count };
      else if (result.reason === "already-countersigned") status = { kind: "done", alreadyCountersigned: true, adr: `ADR-${String(result.adr).padStart(4, "0")}` };
      else if (result.reason === "lead-unknown") status = { kind: "blocked", message: "Can't reject: this lead has no folder." };
      else if (result.reason === "entry-changed") status = { kind: "blocked", message: CHANGED };
      else if (result.reason === "audit-unwritable") status = { kind: "blocked", message: UNWRITABLE(result.message) };
      else status = { kind: "resolved-elsewhere" };
      settle(key, entry, status);
      // The rejected row leaves the list (it is filtered below); the notice carries no quote text and only
      // claims what the server says it did.
      if (result.ok) {
        const who = `${entry.leadId}, ${entry.timestamp}`;
        setNotice(
          result.recorded ? `Rejected: ${who}. Recorded in the audit log.`
            : result.alreadyRejected ? `Already rejected earlier: ${who}. Nothing new was written.`
            : `Rejected: ${who}. The audit record was already in the log; nothing new was written.`,
        );
      }
      if (status.kind !== "duplicate" && !(!result.ok && result.reason === "audit-unwritable")) {
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
    setNotice(null);
    setStatuses((prev) => ({ ...prev, [key]: { kind: "pending" } }));
    try {
      const result = await countersignDecision(entry.timestamp, entry.leadId, line, blockDigest(entry.block));
      if (!result.ok && result.reason === "duplicate") {
        setStatuses((prev) => ({ ...prev, [key]: { kind: "duplicate", count: result.count } }));
        return;
      }
      if (!result.ok && result.reason === "reject-pending") {
        setStatuses((prev) => ({ ...prev, [key]: { kind: "blocked", message: "This proposal was rejected but not removed. Use Reject to finish." } }));
        return;
      }
      if (!result.ok && result.reason === "audit-unwritable") {
        if (result.adr !== undefined) void queryClient.invalidateQueries({ queryKey: ["org", "shared-doc", "decision_log.md"] });
        const message = result.adr !== undefined
          ? `Logged as ${result.adr}, but the audit record could not be written. ${result.message}. Then countersign again to finish.`
          : UNWRITABLE(result.message);
        setStatuses((prev) => ({ ...prev, [key]: { kind: "blocked", message } }));
        return;
      }
      if (!result.ok && result.reason === "entry-changed") {
        setStatuses((prev) => ({ ...prev, [key]: { kind: "blocked", message: CHANGED } }));
        await refetch(); // show the lead's new version right away
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
        const done: EntryStatus = { kind: "done", alreadyCountersigned: result.alreadyCountersigned, adr: result.adr, edited: result.edited, loggedLineDiffers: result.loggedLineDiffers };
        settle(key, entry, done);
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
