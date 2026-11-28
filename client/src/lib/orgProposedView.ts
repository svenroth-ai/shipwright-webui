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
 * A pointer is a session excerpt, a file line (`project · path · line N`), a journal event (`event <id>`) or the
 * operator's own reject reason / countersign note (`rejected:` / `decision:`, whose quote is resolved by the server and
 * shown by `OperatorWordsEvidence`, never as a lead quote); none of them is ever a link (`describeSource`).
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
  /** The Evidence bullet's own quote (`<pointer> — "<quote>"`), `null` when it has none or the pointer is unknown. */
  evidenceQuote: string | null;
}

const BEAT_RE = /origin: \S+ beat ([^,\s]+),/;

/** The pointer as the operator reads it: decoded, plain text, no link. */
export function describeSource(s: SourceRef): string {
  if (s.kind === "known") return `session ${s.session}, ${s.time}, message ${s.message}`;
  if (s.kind === "file") return `${s.project} · ${s.path.join("/")} · line ${s.line}`;
  if (s.kind === "event") return `event ${s.id}`;
  if (s.kind === "rejected") return `your reason for rejecting ${s.lead}'s proposal of ${s.time}`;
  if (s.kind === "decision") return `your note on ADR-${s.adr}`;
  return "unknown source";
}

/** A fence quote's own ` — <pointer>` is lead-written and never checked by the daemon: the file-line and journal-event
 *  forms are read only on the Evidence bullet (which the daemon checks), so here they show as unknown source with the
 *  raw text instead of a citation that looks checked. The two decision-record forms likewise (only the Evidence bullet's
 *  quote behind them is checked, and only that one is resolved). */
function fenceQuoteSource(pointer: string): SourceRef {
  const s = parseSourceRef(pointer);
  return s.kind === "known" || s.kind === "unknown" ? s : { kind: "unknown", raw: pointer.trim() };
}

/** True for the two pointers that cite the operator's own words (`rejected:` / `decision:`). Only the Evidence
 *  bullet's own quote behind one of them is resolved (`OperatorWordsEvidence`); a fence quote never borrows them. */
export const citesOperatorWords = (s: SourceRef): boolean => s.kind === "rejected" || s.kind === "decision";

function parseQuote(line: string, fallback: SourceRef, rawEvidence: string | null): QuoteView {
  const { text, pointer } = splitQuote(line);
  if (pointer !== null) return { text, source: fenceQuoteSource(pointer), inherited: false };
  // a lead-written fence quote must never read as the operator's words by inheriting a record pointer
  return { text, source: citesOperatorWords(fallback) ? { kind: "unknown", raw: rawEvidence } : fallback, inherited: true };
}

export function buildEntryView(block: string, evidence: string | null): EntryView {
  const { source, quote } = parseEvidence(evidence);
  const parts = fencedParts(block.split("\n"));
  if (parts === null) return { fenced: false, proposedLine: null, beat: null, source, quotes: [], evidenceQuote: null };
  // the Evidence line's own quote, first; behind a record pointer it is shown by OperatorWordsEvidence instead
  const own: QuoteView[] = quote === null || citesOperatorWords(source) ? [] : [{ text: quote, source, inherited: false }];
  const rawPointer = evidence === null ? null : (evidence.trim().split(" — ")[0] ?? null);
  const quotes = [...own, ...parts.quotes.map((l) => parseQuote(l, source, rawPointer)).filter((q) => q.text !== "")];
  return {
    fenced: true,
    proposedLine: stripInvisible(parts.proposed.join("\n")).trim(), // invisible characters removed as on the server; whitespace is collapsed on write
    beat: BEAT_RE.exec(parts.label)?.[1] ?? null,
    source,
    quotes,
    evidenceQuote: quote,
  };
}
