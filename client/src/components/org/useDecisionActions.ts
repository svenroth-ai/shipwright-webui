/*
 * useDecisionActions — the countersign / reject requests of the proposals window and the
 * per-row state they drive (statuses, pinned "settled" rows, the notice). Split out of
 * OrgDecisionsProposedModal.tsx to stay under the 300-line convention (campaign
 * shadow-proposals-webui, W4); countersign can carry the operator's edited line.
 *
 * E2E-fix (kept): a just-countersigned entry stays pinned in view (`settled`) showing its ADR
 * number until the modal closes - the refetch removes it from the server's list faster than a
 * human can read the "done" banner. Rows with a request in flight are guarded: a double click
 * sends ONE request.
 *
 * Every row status remembers the digest of the block it was produced for (limits closeout): a
 * refetch that puts a rewritten proposal under the same row never shows the old verdict on it
 * (`statusFor` answers idle), and a pinned result of an older version is shown on its own.
 */
import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { countersignDecision, type ProposedDecisionEntry } from "../../lib/orgDecisionsApi";
import { rejectDecision } from "../../lib/orgRejectApi";
import { blockDigest } from "../../lib/orgBlockDigest";
import type { EntryStatus } from "./DecisionEntryRow";
import { LINE_PROBLEMS, CHANGED, UNWRITABLE, rejectFailureStatus, rejectNotice } from "./decisionMessages";

export { entryKey, entryKeys } from "./decisionEntryKeys";

interface Stamped {
  status: EntryStatus;
  /** `blockDigest` of the entry block the status belongs to. */
  digest: string;
}

export function useDecisionActions(refetch: () => Promise<unknown>) {
  const queryClient = useQueryClient();
  const [statuses, setStatuses] = useState<Record<string, Stamped>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [settled, setSettled] = useState<Record<string, { entry: ProposedDecisionEntry; status: EntryStatus; digest: string }>>({});
  const inFlight = useRef(new Set<string>());

  const put = (key: string, entry: ProposedDecisionEntry, status: EntryStatus) =>
    setStatuses((prev) => ({ ...prev, [key]: { status, digest: blockDigest(entry.block) } }));

  /** A row's status, but only while its entry is still the version the status was produced for. */
  const statusFor = (key: string, entry: ProposedDecisionEntry, digest: string = blockDigest(entry.block)): EntryStatus => {
    const s = statuses[key];
    return s !== undefined && s.digest === digest ? s.status : { kind: "idle" };
  };

  /** One place that records a row's final status (and pins a `done` row, which the refetch removes from the list). */
  function settle(key: string, entry: ProposedDecisionEntry, status: EntryStatus) {
    put(key, entry, status);
    if (status.kind === "done") setSettled((prev) => ({ ...prev, [key]: { entry, status, digest: blockDigest(entry.block) } }));
  }

  const fail = (key: string, entry: ProposedDecisionEntry, err: unknown) =>
    put(key, entry, { kind: "error", message: err instanceof Error ? err.message : "unknown error" });

  async function handleReject(key: string, entry: ProposedDecisionEntry, reason: string) {
    const flightKey = `${entry.timestamp}|${entry.leadId}`; // not positional: survives a sibling's refetch
    if (inFlight.current.has(flightKey)) return;
    inFlight.current.add(flightKey);
    setNotice(null); // a new action starts: the previous "Rejected" line no longer describes the window
    put(key, entry, { kind: "pending" });
    try {
      const result = await rejectDecision(entry.timestamp, entry.leadId, reason, blockDigest(entry.block));
      const status: EntryStatus = result.ok ? { kind: "rejected", alreadyRejected: result.alreadyRejected } : rejectFailureStatus(result);
      settle(key, entry, status);
      // The rejected row leaves the list (it is filtered below); the notice carries no quote text and only
      // claims what the server says it did.
      if (result.ok) setNotice(rejectNotice(result, `${entry.leadId}, ${entry.timestamp}`));
      const keepAsIs = status.kind === "duplicate" || (!result.ok && (result.reason === "audit-unwritable" || result.reason === "audit-pending"));
      if (!keepAsIs) {
        await Promise.all([refetch(), queryClient.invalidateQueries({ queryKey: ["org", "decisions-rejected-keys"] })]);
      }
    } catch (err) {
      fail(key, entry, err);
    } finally {
      inFlight.current.delete(flightKey);
    }
  }

  async function handleCountersign(key: string, entry: ProposedDecisionEntry, line?: string) {
    const flightKey = `${entry.timestamp}|${entry.leadId}`;
    if (inFlight.current.has(flightKey)) return;
    inFlight.current.add(flightKey);
    setNotice(null);
    put(key, entry, { kind: "pending" });
    try {
      const result = await countersignDecision(entry.timestamp, entry.leadId, line, blockDigest(entry.block));
      if (result.ok) {
        settle(key, entry, { kind: "done", alreadyCountersigned: result.alreadyCountersigned, adr: result.adr, edited: result.edited, loggedLineDiffers: result.loggedLineDiffers });
        // Both surfaces observe the same countersign action's effect: refresh the proposed list (the entry is
        // gone) and the decision_log.md tile (the new entry is there), without the PO re-opening either.
        await Promise.all([refetch(), queryClient.invalidateQueries({ queryKey: ["org", "shared-doc", "decision_log.md"] })]);
        return;
      }
      const blocked = (message: string) => put(key, entry, { kind: "blocked", message });
      switch (result.reason) {
        case "duplicate":
          put(key, entry, { kind: "duplicate", count: result.count, ...(result.loggedAdr !== undefined ? { loggedAdr: result.loggedAdr } : {}) });
          return;
        case "reject-pending":
          blocked("This proposal was rejected but not removed. Use Reject to finish.");
          return;
        case "audit-unwritable":
          if (result.adr !== undefined) void queryClient.invalidateQueries({ queryKey: ["org", "shared-doc", "decision_log.md"] });
          blocked(result.adr !== undefined
            ? `Logged as ${result.adr}, but the audit record could not be written. ${result.message}. Then countersign again to finish.`
            : UNWRITABLE(result.message));
          return;
        case "entry-changed":
          blocked(CHANGED);
          await refetch(); // show the lead's new version right away
          return;
        case "line-rejected":
          blocked(LINE_PROBLEMS[result.code] ?? "The line was not accepted.");
          return;
        case "not-found":
          put(key, entry, { kind: "resolved-elsewhere" });
          await refetch();
          return;
      }
    } catch (err) {
      fail(key, entry, err);
    } finally {
      inFlight.current.delete(flightKey);
    }
  }

  return { statusFor, settled, notice, handleReject, handleCountersign };
}
