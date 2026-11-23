/*
 * orgProposedView.ts — display model for one `decisions-proposed.md` entry
 * (campaign shadow-proposals-webui, W2). Pure, read-only: turns the entry's raw
 * block into the proposed line, beat, evidence pointer and quotes the operator
 * sees. Never feeds countersign (identity stays (timestamp, leadId)).
 *
 * Display convention for quotes (documented in docs/org-proposed-entry-contract.md):
 * inside the fenced region, a line starting with `> ` is ONE quote, optionally
 * ending in ` — <pointer>` (split at the LAST ` — `, only when the suffix looks like a
 * pointer, so an em-dash in the text survives); every other line is the
 * proposed line. A quote without its own pointer inherits the entry's evidence
 * pointer. Everything here is text: callers render it as plain text, never markup.
 *
 * The line/quote split (`fencedParts`) and the pointer parser live in the mirrored grammar, so the
 * server countersign uses the very same rule (W4).
 */
import { fencedParts, parseSourceRef, splitQuote, type SourceRef } from "./orgProposedGrammar";

export { parseSourceRef };
export type { SourceRef };

export interface QuoteView {
  text: string;
  source: SourceRef;
  /** true when the quote named no pointer of its own and shows the entry's evidence pointer. */
  inherited: boolean;
}

export interface EntryView {
  /** true when the entry has the daemon/marker-owned fenced shape. */
  fenced: boolean;
  /** plain text of the proposed line (fenced entries only). */
  proposedLine: string | null;
  beat: string | null;
  source: SourceRef;
  quotes: QuoteView[];
}

const BEAT_RE = /origin: \S+ beat ([^,\s]+),/;

function parseQuote(line: string, fallback: SourceRef): QuoteView {
  const { text, pointer } = splitQuote(line);
  return pointer === null ? { text, source: fallback, inherited: true } : { text, source: parseSourceRef(pointer), inherited: false };
}

export function buildEntryView(block: string, evidence: string | null): EntryView {
  const source = parseSourceRef(evidence);
  const parts = fencedParts(block.split("\n"));
  if (parts === null) return { fenced: false, proposedLine: null, beat: null, source, quotes: [] };
  const quotes = parts.quotes.map((l) => parseQuote(l, source)).filter((q) => q.text !== "");
  return {
    fenced: true,
    proposedLine: parts.proposed.join("\n").trim(),
    beat: BEAT_RE.exec(parts.label)?.[1] ?? null,
    source,
    quotes,
  };
}
