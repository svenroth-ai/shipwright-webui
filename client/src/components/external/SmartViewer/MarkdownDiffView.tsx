/*
 * MarkdownDiffView — pre-save unified line diff for the markdown editor
 * (iterate-2026-06-03-smartviewer-markdown-editor, FR-01.34).
 *
 * The mandatory safety net for the lossy Markdown↔ProseMirror round-trip: the
 * user sees EXACTLY what the serializer changed before any write. Diff content
 * is rendered as ESCAPED PLAIN TEXT (React default escaping, NO
 * dangerouslySetInnerHTML) so markdown containing HTML / `<script>` can never
 * execute in this surface (external review #7).
 */

import { useMemo } from "react";
import { diffLines, type Change } from "diff";

interface Props {
  original: string;
  edited: string;
}

interface Row {
  kind: "add" | "del" | "ctx";
  text: string;
}

function toRows(parts: Change[]): Row[] {
  const rows: Row[] = [];
  for (const part of parts) {
    const kind: Row["kind"] = part.added ? "add" : part.removed ? "del" : "ctx";
    const lines = part.value.split("\n");
    // diffLines keeps a trailing "" after the final newline — drop it.
    if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
    for (const text of lines) rows.push({ kind, text });
  }
  return rows;
}

export function MarkdownDiffView({ original, edited }: Props) {
  const rows = useMemo(() => toRows(diffLines(original, edited)), [original, edited]);
  const added = rows.filter((r) => r.kind === "add").length;
  const removed = rows.filter((r) => r.kind === "del").length;
  const changed = added + removed > 0;

  return (
    <div className="flex h-full flex-col" data-testid="markdown-diff">
      <div
        className="border-b border-[var(--color-border,#e0dbd4)] px-3 py-1.5 text-[11px]"
        style={{ color: "var(--color-muted, #6b7280)" }}
        data-testid="markdown-diff-summary"
      >
        {changed ? `+${added} / -${removed} lines` : "No changes"}
      </div>
      <div className="min-h-0 flex-1 overflow-auto font-mono text-[12px] leading-[1.5]">
        {rows.map((r, i) => (
          <div
            key={i}
            data-diff-kind={r.kind}
            className="flex"
            style={{
              background:
                r.kind === "add"
                  ? "rgba(22,163,74,0.12)"
                  : r.kind === "del"
                    ? "rgba(220,38,38,0.12)"
                    : "transparent",
              color:
                r.kind === "ctx"
                  ? "var(--color-muted, #6b7280)"
                  : "var(--color-text, #1a1a1a)",
            }}
          >
            <span
              aria-hidden="true"
              className="w-4 shrink-0 select-none px-1 text-center"
            >
              {r.kind === "add" ? "+" : r.kind === "del" ? "-" : " "}
            </span>
            <span className="whitespace-pre-wrap break-words px-1">{r.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
