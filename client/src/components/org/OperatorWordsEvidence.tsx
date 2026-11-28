/*
 * OperatorWordsEvidence — a proposal whose evidence cites the operator's own reject reason (`rejected:`) or
 * countersign note (`decision:`) (iterate-2026-11-28-decision-record-evidence). The server reads the record positionally
 * and confirms the lead's quote; ONLY a `confirmed` answer shows the quote as the operator's words. Loading, a failed
 * request, and every other answer show a notice instead: fail closed, never an optimistic render. The check holds for
 * the moment it was shown ("found in your record when shown"); a reject or countersign re-runs it.
 * All text is plain text (React text nodes).
 */
import { useQuery } from "@tanstack/react-query";
import { AlertCircle } from "lucide-react";

import { fetchRecordEvidence, RECORD_EVIDENCE_KEY, type RecordEvidenceResult } from "../../lib/orgRecordEvidenceApi";

const MUTED = { color: "var(--color-muted, #6b7280)" } as const;

function notCheckedText(form: "rejected" | "decision", r: RecordEvidenceResult | undefined, failed: boolean): string {
  const what = form === "rejected" ? "reason" : "note";
  const tail = "The lead's quote is not shown as your words.";
  if (failed || r === undefined) return `Your ${what} could not be checked. ${tail}`;
  if (r.status === "unreadable") return `${r.file} could not be read (${r.detail}). ${tail}`;
  if (r.status === "no_words") return `${r.file} holds no ${what} of yours for this citation. ${tail}`;
  return `The lead's quote does not occur in your ${what} in ${r.file}. ${tail}`;
}

export function OperatorWordsEvidence({ rowKey, form, pointer, quote }: { rowKey: string; form: "rejected" | "decision"; pointer: string; quote: string }) {
  const { data, isPending, isFetching, isError } = useQuery({
    queryKey: [...RECORD_EVIDENCE_KEY, pointer, quote],
    queryFn: () => fetchRecordEvidence(pointer, quote),
    retry: false,
    staleTime: 0,
  });
  const testId = `org-decisions-proposed-operator-words-${rowKey}`;

  // a background re-check counts as checking: a cached confirmation is never shown while the record is re-read
  if (isPending || isFetching) {
    return (
      <p role="status" className="text-[11px]" style={MUTED} data-testid={testId} data-state="checking">
        Checking the quote against your {form === "rejected" ? "reason" : "note"}...
      </p>
    );
  }
  if (!isError && data?.status === "confirmed") {
    return (
      <div className="flex flex-col gap-1" data-testid={testId} data-state="confirmed">
        <h3 className="text-[11px] font-medium" style={MUTED}>
          Your own words, cited by the lead (found in {data.file} when shown)
        </h3>
        <blockquote className="m-0 rounded-[6px] border-l-2 border-[var(--color-border,#e0dbd4)] pl-2 whitespace-pre-wrap break-words text-[11px]" data-testid={`${testId}-quote`}>
          {quote}
        </blockquote>
        <div className="text-[10px]" style={MUTED}>
          Your full {form === "rejected" ? "reason" : "note"}: <span className="break-words" data-testid={`${testId}-words`}>{data.words}</span>
        </div>
      </div>
    );
  }
  return (
    <p role="status" className="flex items-start gap-1 text-[11px] text-[var(--color-warning-text,#b45309)]" data-testid={testId} data-state={isError ? "error" : (data?.status ?? "error")}>
      <AlertCircle size={12} aria-hidden="true" className="mt-[2px] shrink-0" />
      <span>{notCheckedText(form, data, isError)}</span>
    </p>
  );
}
