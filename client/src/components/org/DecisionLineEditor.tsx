/*
 * DecisionLineEditor — the operator rewrites the proposed line before countersigning
 * (campaign shadow-proposals-webui, W4). Only this line goes to the decisions log; the
 * original wording is not kept and quotes are never copied. Plain text only.
 */
const BTN =
  "rounded-[6px] border border-[var(--color-border,#e0dbd4)] px-2 py-1 text-[11px] hover:bg-[var(--color-muted-bg,#ede8e1)] disabled:opacity-50";

export function DecisionLineEditor({
  rowKey,
  value,
  original,
  disabled,
  onChange,
}: {
  rowKey: string;
  value: string;
  /** The line as the lead proposed it, for "Use the original". */
  original: string;
  disabled: boolean;
  onChange: (next: string) => void;
}) {
  const id = `org-proposed-edit-${rowKey.replace(/[^A-Za-z0-9_-]/g, "_")}`;
  const hintId = `${id}-hint`;
  return (
    <div className="flex flex-col gap-1" data-testid={`org-decisions-proposed-editor-${rowKey}`}>
      <label htmlFor={id} className="text-[11px] font-medium">
        Line for the decisions log
      </label>
      <textarea
        id={id}
        value={value}
        rows={3}
        maxLength={2000}
        disabled={disabled}
        aria-describedby={hintId}
        onChange={(e) => onChange(e.target.value)}
        data-testid={`org-decisions-proposed-edit-input-${rowKey}`}
        className="w-full rounded-[6px] border border-[var(--color-border,#e0dbd4)] px-2 py-1 text-[12px]"
      />
      <p id={hintId} className="text-[11px]" style={{ color: "var(--color-muted, #6b7280)" }}>
        Only this line is written to the log. The original wording is not kept, and quotes are never copied, so write it in your own words.
      </p>
      <div>
        <button type="button" disabled={disabled || value === original} onClick={() => onChange(original)} className={BTN} data-testid={`org-decisions-proposed-edit-reset-${rowKey}`}>
          Use the original line
        </button>
      </div>
    </div>
  );
}
