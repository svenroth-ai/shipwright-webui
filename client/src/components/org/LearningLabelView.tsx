/*
 * LearningLabelView — shows a learning proposal's label apart from its rule, in plain words, so the operator sees the
 * reach and importance before countersigning (iterate-2026-11-28-decision-record-evidence). Reads the label exactly as
 * leadwright reads it back from the countersigned line (`orgLearningLabel.ts`); used for the proposed line and, live,
 * under the edit field. Display only.
 */
import { AlertCircle } from "lucide-react";

import { parseLearningLabel } from "../../lib/orgLearningLabel";
import { normalizeLine } from "../../lib/orgProposedGrammar";

const CHIP = "rounded-[4px] border border-[var(--color-border,#e0dbd4)] px-1.5 py-[1px] text-[10px]";

export function LearningLabelView({ line, testId, showRule = true }: { line: string; testId: string; showRule?: boolean }) {
  // the label is read from the line as it will be LOGGED (the countersign normalises an edited line: newlines, space
  // runs, NBSP and invisible characters), so the preview never shows a narrower reach than the leads will get
  const parsed = parseLearningLabel(normalizeLine(line));
  if (!parsed.ok) {
    return (
      <p role="status" className="flex items-start gap-1 text-[11px] text-[var(--color-warning-text,#b45309)]" data-testid={testId} data-state="unreadable">
        <AlertCircle size={12} aria-hidden="true" className="mt-[2px] shrink-0" />
        <span className="flex flex-col gap-1">
          <span>
            The learning label cannot be read: {parsed.problem}. Countersigning still logs the line, but the learning is not written until the label is fixed.
          </span>
          {showRule && (
            <span className="whitespace-pre-wrap break-words text-[12px] font-medium text-[var(--color-text,#1f2937)]" data-testid={`${testId}-line`}>
              {line}
            </span>
          )}
        </span>
      </p>
    );
  }
  const { label, labelled } = parsed;
  return (
    <div className="flex flex-col gap-1" data-testid={testId} data-state={labelled ? "labelled" : "unlabelled"}>
      <div className="flex flex-wrap items-center gap-1" aria-label="Learning label">
        <span className={`${CHIP} font-medium`}>Learning</span>
        <span className={CHIP} data-testid={`${testId}-scope`}>{label.scope === "all" ? "for all leads" : "for this lead only"}</span>
        <span className={CHIP} data-testid={`${testId}-importance`}>importance {label.importance} of 5</span>
        {label.pinned && <span className={CHIP} data-testid={`${testId}-pinned`}>pinned</span>}
        {label.replaces !== undefined && <span className={CHIP} data-testid={`${testId}-replaces`}>replaces {label.replaces}</span>}
        {!labelled && <span className="text-[10px]" style={{ color: "var(--color-muted, #6b7280)" }}>(no label: counts as this lead, importance 3)</span>}
      </div>
      {showRule && (
        <p className="whitespace-pre-wrap break-words text-[12px] font-medium" data-testid={`${testId}-rule`}>
          {label.rule}
        </p>
      )}
    </div>
  );
}
