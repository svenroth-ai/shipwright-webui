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
 * W4 NOTE: the line/quote classification below exists only on the client. W4 must move it
 * into the mirrored grammar (drift-guarded), not re-implement it on the server.
 */
import { FENCE_LINE_RE, FENCE_LABEL_PREFIX, findClose } from "./orgProposedGrammar";

export type SourceRef =
  | { kind: "known"; session: string; time: string; message: string }
  | { kind: "unknown"; raw: string | null };

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

const ISO = String.raw`\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z`;
const SHORT_RE = new RegExp(String.raw`^([A-Za-z0-9_-]+):(${ISO}):(\d+)$`);
const LONG_RE = new RegExp(String.raw`^session ([A-Za-z0-9_-]+) at (${ISO}), message (\d+)$`);
const BEAT_RE = /origin: \S+ beat ([^,\s]+),/;
const POINTER_ATTEMPT_RE = /^(?:session\b|[A-Za-z0-9_-]+:\S)/;
const QUOTE_SEP = " — ";

/** `session:time:number` or `session <id> at <time>, message <n>`; anything else is unknown. */
export function parseSourceRef(raw: string | null): SourceRef {
  const t = raw?.trim() ?? "";
  if (t === "") return { kind: "unknown", raw: null };
  const m = SHORT_RE.exec(t) ?? LONG_RE.exec(t);
  if (!m) return { kind: "unknown", raw: t };
  return { kind: "known", session: m[1], time: m[2], message: m[3] };
}

function parseQuote(line: string, fallback: SourceRef): QuoteView {
  const body = line.replace(/^>[ \t]?/, "");
  const at = body.lastIndexOf(QUOTE_SEP);
  const suffix = at === -1 ? "" : body.slice(at + QUOTE_SEP.length).trim();
  // Only a suffix that looks like a pointer is split off: an em-dash inside the quote text stays in it.
  if (at === -1 || !POINTER_ATTEMPT_RE.test(suffix)) return { text: body.trim(), source: fallback, inherited: true };
  return { text: body.slice(0, at).trim(), source: parseSourceRef(suffix), inherited: false };
}

export function buildEntryView(block: string, evidence: string | null): EntryView {
  const source = parseSourceRef(evidence);
  const lines = block.split("\n").map((l) => l.replace(/\r$/, ""));
  const open = lines.findIndex((l, i) => FENCE_LINE_RE.test(l) && (lines[i + 1] ?? "").startsWith(FENCE_LABEL_PREFIX));
  const close = open === -1 ? -1 : findClose(lines, open);
  if (open === -1 || close === -1) return { fenced: false, proposedLine: null, beat: null, source, quotes: [] };

  const proposed: string[] = [];
  const quotes: QuoteView[] = [];
  for (const line of lines.slice(open + 2, close)) {
    if (line.startsWith(">")) {
      const q = parseQuote(line, source);
      if (q.text !== "") quotes.push(q);
    }
    else proposed.push(line);
  }
  return {
    fenced: true,
    proposedLine: proposed.join("\n").trim(),
    beat: BEAT_RE.exec(lines[open + 1])?.[1] ?? null,
    source,
    quotes,
  };
}
