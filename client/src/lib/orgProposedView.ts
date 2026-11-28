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
 * pointer. The Evidence bullet itself may carry the quote (`<pointer> — "<quote>"`,
 * `parseEvidence`): it is shown first, as a quote with its own pointer. Everything here is text: callers render it as plain text, never markup.
 * A pointer is a session excerpt, a file line (`project · path · line N`) or a journal event (`event <id>`); none of
 * them is ever a link (`describeSource`).
 *
 * The line/quote split (`fencedParts`) and the pointer parser live in the mirrored grammar, so the
 * server countersign uses the very same rule (W4).
 */
import { fencedParts, parseEvidence, parseSourceRef, splitQuote, stripInvisible, type SourceRef } from "./orgProposedGrammar";

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

/** The pointer as the operator reads it: decoded, plain text, no link. */
export function describeSource(s: SourceRef): string {
  if (s.kind === "known") return `session ${s.session}, ${s.time}, message ${s.message}`;
  if (s.kind === "file") return `${s.project} · ${s.path.join("/")} · line ${s.line}`;
  if (s.kind === "event") return `event ${s.id}`;
  return "unknown source";
}

/** A fence quote's own ` — <pointer>` is lead-written and never checked by the daemon: the file-line and journal-event
 *  forms are read only on the Evidence bullet (which the daemon checks), so here they show as unknown source with the
 *  raw text instead of a citation that looks checked. */
function fenceQuoteSource(pointer: string): SourceRef {
  const s = parseSourceRef(pointer);
  return s.kind === "file" || s.kind === "event" ? { kind: "unknown", raw: pointer.trim() } : s;
}

function parseQuote(line: string, fallback: SourceRef): QuoteView {
  const { text, pointer } = splitQuote(line);
  return pointer === null ? { text, source: fallback, inherited: true } : { text, source: fenceQuoteSource(pointer), inherited: false };
}

export function buildEntryView(block: string, evidence: string | null): EntryView {
  const { source, quote } = parseEvidence(evidence);
  const parts = fencedParts(block.split("\n"));
  if (parts === null) return { fenced: false, proposedLine: null, beat: null, source, quotes: [] };
  const own: QuoteView[] = quote === null ? [] : [{ text: quote, source, inherited: false }]; // the Evidence line's own quote, first
  const quotes = [...own, ...parts.quotes.map((l) => parseQuote(l, source)).filter((q) => q.text !== "")];
  return {
    fenced: true,
    proposedLine: stripInvisible(parts.proposed.join("\n")).trim(), // invisible characters removed as on the server; whitespace is collapsed on write
    beat: BEAT_RE.exec(parts.label)?.[1] ?? null,
    source,
    quotes,
  };
}
