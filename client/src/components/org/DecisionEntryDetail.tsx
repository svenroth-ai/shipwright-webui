/*
 * DecisionEntryDetail — the structured, read-only body of one proposed entry
 * (campaign shadow-proposals-webui, W2): proposed line, lead, beat, evidence
 * pointer, and each quote as its own element with its source. Quote and
 * pointer text is lead-written free text: it is rendered as PLAIN TEXT only
 * (React text nodes, never markdown/HTML). Split out of DecisionEntryRow to
 * stay under the 300-line convention.
 */
import type { ReactNode } from "react";
import type { ProposedDecisionEntry } from "../../lib/orgDecisionsApi";
import { buildEntryView, describeSource, type SourceRef } from "../../lib/orgProposedView";
import { DocumentMarkdown } from "../external/SmartViewer/DocumentMarkdown";

const MUTED = { color: "var(--color-muted, #6b7280)" } as const;

export function SourceLabel({ source, testId }: { source: SourceRef; testId: string }) {
  return (
    <span data-testid={testId} data-source={source.kind} className="break-words">
      {describeSource(source)}
      {source.kind === "unknown" && (
        <span className="ml-1 font-mono">({source.raw ?? "none given"})</span>
      )}
    </span>
  );
}

export function DecisionEntryDetail({ rowKey, entry, labelId, lineSlot }: { rowKey: string; entry: ProposedDecisionEntry; labelId: string; /** Replaces the proposed line (the line editor). */ lineSlot?: ReactNode }) {
  const view = buildEntryView(entry.block, entry.evidence);
  const quotesId = `${labelId}-quotes`;

  return (
    <div className="mt-2 flex flex-col gap-2" data-testid={`org-decisions-proposed-detail-${rowKey}`}>
      {lineSlot ?? (view.fenced ? (view.proposedLine === "" ? null : (
        <p className="whitespace-pre-wrap break-words text-[12px] font-medium" data-testid={`org-decisions-proposed-line-${rowKey}`}>
          {view.proposedLine}
        </p>
      )) : (
        <div className="text-[11px] leading-relaxed">
          <DocumentMarkdown text={entry.body} />
        </div>
      ))}

      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[11px]" style={MUTED}>
        <dt>Lead</dt>
        <dd data-testid={`org-decisions-proposed-lead-${rowKey}`}>{entry.leadId}</dd>
        {view.beat !== null && (
          <>
            <dt>Beat</dt>
            <dd data-testid={`org-decisions-proposed-beat-${rowKey}`}>{view.beat}</dd>
          </>
        )}
        <dt>Evidence</dt>
        <dd>
          <SourceLabel source={view.source} testId={`org-decisions-proposed-evidence-${rowKey}`} />
        </dd>
      </dl>

      {view.quotes.length > 0 && (
        <div role="group" aria-labelledby={quotesId}>
          <h3 id={quotesId} className="text-[11px] font-medium" style={MUTED}>
            Quotes from the lead ({view.quotes.length})
          </h3>
          <ul className="mt-1 flex flex-col gap-1.5" data-testid={`org-decisions-proposed-quotes-${rowKey}`}>
            {view.quotes.map((q, i) => (
              <li key={i} className="rounded-[6px] border-l-2 border-[var(--color-border,#e0dbd4)] pl-2" data-testid={`org-decisions-proposed-quote-${rowKey}-${i}`}>
                <blockquote className="m-0 whitespace-pre-wrap break-words text-[11px]">{q.text}</blockquote>
                <div className="text-[10px]" style={MUTED}>
                  Source{q.inherited ? " (entry evidence)" : ""}: <SourceLabel source={q.source} testId={`org-decisions-proposed-quote-source-${rowKey}-${i}`} />
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
