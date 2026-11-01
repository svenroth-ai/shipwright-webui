import { normalizeUserTextContent } from "./skill-body";

/*
 * Hand-back fingerprint (campaign mission-desktop-style-v2, V2).
 *
 * The CLI delivers a subagent's final report (and any message from another
 * session) to the parent as a USER-role record, so a naive renderer shows it
 * as something the human typed ("ich"). Real shapes, measured on disk:
 *
 *   Another Claude session sent a message[ while you were working]:
 *   <agent-message from="a798d6e7922ba0bd9">
 *   [Subagent hand-back] <English framing …> The report follows:
 *     <report, every line indented by two spaces>
 *   </agent-message>
 *
 *   That "other Claude session" is an agent working inside this same session …
 *
 * The framing is harness boilerplate: hidden. The UI shows its own notice.
 * Detection needs the header phrase, the `<agent-message from="…">` envelope
 * or the `[Subagent hand-back]` marker to LEAD the record (envelope: nothing
 * before it but the one header line); a mention mid-text stays a user message.
 * Only TEXT blocks are read, and a record that also carries a tool_result block
 * is never a hand-back (it stays `user` so its tool result still resolves).
 */

/** "coordinator": a message the parent session sent INTO a running subagent (only seen inside subagent transcripts). */
export type HandbackOrigin = "subagent" | "session" | "coordinator";

const HEADER = "Another Claude session sent a message";
const MARKER = "[Subagent hand-back]";
const COORDINATOR_HEADER = "The coordinator sent a message while you were working:";
const COORDINATOR_TRAILER = "Address this before completing your current task.";
const ENVELOPE_OPEN = /<agent-message\s+from="([^"]*)"\s*>/;
const ENVELOPE_CLOSE = "</agent-message>";
/** Quote-aware and linear: attribute values may contain `>` (from-name="Fix A -> B"). */
const CROSS_OPEN = /<cross-session-message\b((?:\s+[\w-]+="[^"]*")*)\s*>/;
const CROSS_CLOSE = "</cross-session-message>";
const REPORT_FOLLOWS = "The report follows:";
const OVERSIZE_REJECT = 2_000_000;
/** Envelopes must LEAD the record, so only this much is searched for an opening tag (header line + tag). */
const LEAD_WINDOW = 4096;
const TITLE_MAX = 120;
/** The harness's closing paragraphs (subagent / peer session): "That "other Claude session" is …", "This came from another Claude session …". */
const TRAILER_STARTS = ['\nThat "other Claude session"', "\nThis came from another Claude session"];

export interface Handback { sender: string; origin: HandbackOrigin; text: string; fromName?: string }

/**
 * Cuts the harness's closing paragraph. lastIndexOf + a check of the short slice before it for a blank line:
 * no regex with overlapping whitespace/newline classes (that backtracked quadratically on long newline runs).
 */
function stripTrailer(body: string): string {
  let cut = -1;
  for (const start of TRAILER_STARTS) {
    const at = body.lastIndexOf(start);
    if (at < 0) continue;
    const before = body.slice(Math.max(0, at - 64), at);
    if (/\n[ \t]*$/.test(before) && (cut < 0 || at < cut)) cut = at;
  }
  return cut < 0 ? body : body.slice(0, cut).trimEnd();
}

/** The record LEADS with this match: nothing before it, or just the one header line. */
function leadsRecord(text: string, index: number): boolean {
  const before = text.slice(0, index).trim();
  return before === "" || (before.startsWith(HEADER) && !before.includes("\n"));
}

function decodeEntities(v: string): string {
  return v.replace(/&(amp|quot|lt|gt|apos);/g, (_, e: string) => ({ amp: "&", quot: '"', lt: "<", gt: ">", apos: "'" })[e] as string);
}

/**
 * A subagent report body: "[Subagent hand-back] <framing> The report follows:" then every report line
 * indented by two spaces. Returns the cleaned report, or null when the body does not open with the marker
 * ("subagent" only when the marker opens the body; a quote of it inside another session's text does not count).
 */
function unwrapReport(body: string): string | null {
  if (!body.trimStart().startsWith(MARKER)) return null;
  const markerAt = body.indexOf(MARKER);
  const followsAt = body.indexOf(REPORT_FOLLOWS, markerAt);
  let out = followsAt >= 0 ? body.slice(followsAt + REPORT_FOLLOWS.length) : body.slice(markerAt + MARKER.length);
  // The harness indents every report line by two spaces; undo that, but only when EVERY non-blank line carries it.
  out = out.replace(/^\n/, "");
  const lines = out.split("\n").filter((l) => l.trim());
  if (lines.length > 0 && lines.every((l) => l.startsWith("  "))) out = out.replace(/^ {2}/gm, "");
  return out;
}

/**
 * Third real envelope: `<cross-session-message from="uds:…" from-name="…" from-mode="…">…</cross-session-message>`,
 * sometimes wrapping a nested `<agent-message from="…">` (itself possibly a subagent hand-back). Tags are hidden;
 * from-name becomes the card title and the nested agent id the sender.
 */
function fromCrossSession(text: string, open: RegExpExecArray): Handback {
  const start = open.index + open[0].length;
  const end = text.lastIndexOf(CROSS_CLOSE);
  let body = text.slice(start, end < start ? undefined : end);
  if (end < start) body = stripTrailer(body);
  body = body.trim();
  let sender = "";
  const nested = ENVELOPE_OPEN.exec(body.slice(0, LEAD_WINDOW));
  if (nested && body.slice(0, nested.index).trim() === "") {
    sender = nested[1];
    const from = nested.index + nested[0].length;
    const close = body.lastIndexOf(ENVELOPE_CLOSE);
    body = body.slice(from, close < from ? undefined : close);
  }
  const report = unwrapReport(body);
  const rawName = /\sfrom-name="([^"]*)"/.exec(open[1])?.[1];
  const fromName = rawName ? Array.from(decodeEntities(rawName).replace(/\s+/g, " ").trim()).slice(0, TITLE_MAX).join("") : "";
  return { sender, origin: report != null ? "subagent" : "session", text: (report ?? body).trim(), ...(fromName ? { fromName } : {}) };
}

/** Inside a subagent transcript the parent's follow-up is a user-role record: header line, message, harness trailer. */
function fromCoordinator(raw: string): Handback {
  let body = raw.replace(/\r\n/g, "\n").trim().slice(COORDINATOR_HEADER.length).trim();
  if (body.endsWith(COORDINATOR_TRAILER)) body = body.slice(0, body.length - COORDINATOR_TRAILER.length).trimEnd();
  return { sender: "", origin: "coordinator", text: body };
}

export function detectHandback(content: unknown): Handback | null {
  if (Array.isArray(content) && content.some((b) => (b as { type?: unknown } | null)?.type === "tool_result")) return null;
  const raw = normalizeUserTextContent(content);
  if (raw == null || raw.length > OVERSIZE_REJECT) return null;
  // Cheap early exit (before any replace/regex): a real hand-back LEADS with the header, the marker or the envelope.
  const lead = raw.trimStart();
  if (lead.startsWith(COORDINATOR_HEADER)) return fromCoordinator(lead);
  if (!lead.startsWith(HEADER) && !lead.startsWith(MARKER) && !lead.startsWith("<agent-message") && !lead.startsWith("<cross-session-message")) return null;
  const text = raw.replace(/\r\n/g, "\n");
  // Every fingerprint is ANCHORED to the start of the record (code-review finding): a human message that
  // merely quotes the marker or the envelope mid-text stays a user message with its text intact.
  const head = text.trimStart();
  // Opening tags are searched in a bounded prefix only: an envelope must lead the record.
  const window = text.slice(0, LEAD_WINDOW + (text.length - head.length));
  const cross = CROSS_OPEN.exec(window);
  if (cross && leadsRecord(text, cross.index)) return fromCrossSession(text, cross);
  const found = ENVELOPE_OPEN.exec(window);
  const envelope = found && leadsRecord(text, found.index) ? found : null;
  if (!head.startsWith(HEADER) && !envelope && !head.startsWith(MARKER)) return null;

  let body = text;
  if (envelope) {
    const start = envelope.index + envelope[0].length;
    const end = text.lastIndexOf(ENVELOPE_CLOSE);
    body = text.slice(start, end < start ? undefined : end);
  } else if (head.startsWith(HEADER)) {
    const nl = head.indexOf("\n");
    body = nl < 0 ? "" : head.slice(nl + 1);
  }
  // The closing paragraph trails the header-only shape; inside an envelope it is outside the body already.
  if (!envelope) body = stripTrailer(body);
  const report = unwrapReport(body);
  return { sender: envelope?.[1] ?? "", origin: report != null ? "subagent" : "session", text: (report ?? body).trim() };
}

/**
 * The second real delivery shape (measured: 36 of 165 hand-backs): a `queued_command` ATTACHMENT whose `prompt`
 * is the envelope itself (`<agent-message from="…">\n[Subagent hand-back] …`). It is the same message as the
 * user-role record, so it goes through the same detector (string or text-block-array prompt); any other attachment is left alone.
 * Measured on real transcripts: no hand-back ever arrives in BOTH forms, so there is deliberately NO cross-record dedupe
 * (parsing stays per-line, incremental == whole parse, and genuinely repeated identical reports are kept).
 */
export function handbackFromAttachment(attachment: unknown): Handback | null {
  if (!attachment || typeof attachment !== "object") return null;
  const a = attachment as { type?: unknown; prompt?: unknown };
  return a.type === "queued_command" ? detectHandback(a.prompt) : null; // prompt: string or text-block array
}
