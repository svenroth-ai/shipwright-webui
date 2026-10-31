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

export type HandbackOrigin = "subagent" | "session";

const HEADER = "Another Claude session sent a message";
const MARKER = "[Subagent hand-back]";
const ENVELOPE_OPEN = /<agent-message\s+from="([^"]*)"\s*>/;
const ENVELOPE_CLOSE = "</agent-message>";
const REPORT_FOLLOWS = "The report follows:";
const OVERSIZE_REJECT = 2_000_000;
/** The harness's closing paragraph after the envelope ("That "other Claude session" is an agent …"). */
const TRAILER = /\n\s*\nThat "other Claude session"[\s\S]*$/;

export interface Handback { sender: string; origin: HandbackOrigin; text: string; fromName?: string }

const CROSS_OPEN = /<cross-session-message\b([^>]*)>/;
const CROSS_CLOSE = "</cross-session-message>";

/** The record LEADS with this match: nothing before it, or just the one header line. */
function leadsRecord(text: string, index: number): boolean {
  const before = text.slice(0, index).trim();
  return before === "" || (before.startsWith(HEADER) && !before.includes("\n"));
}

/**
 * Third real envelope: `<cross-session-message from="uds:…" from-name="…" from-mode="…">…</cross-session-message>`,
 * sometimes wrapping a nested `<agent-message from="…">`. Tags are hidden; from-name becomes the card title and the
 * nested agent id the sender. Always origin "session" (a peer session spoke, not our subagent).
 */
function fromCrossSession(text: string, open: RegExpExecArray): Handback {
  const start = open.index + open[0].length;
  const end = text.lastIndexOf(CROSS_CLOSE);
  let body = text.slice(start, end < start ? undefined : end).trim();
  if (end < start) body = body.replace(TRAILER, "").trim();
  let sender = "";
  const nested = ENVELOPE_OPEN.exec(body);
  if (nested && body.slice(0, nested.index).trim() === "") {
    sender = nested[1];
    const from = nested.index + nested[0].length;
    const close = body.lastIndexOf(ENVELOPE_CLOSE);
    body = body.slice(from, close < from ? undefined : close).trim();
  }
  const fromName = /from-name="([^"]*)"/.exec(open[1])?.[1];
  return { sender, origin: "session", text: body, ...(fromName ? { fromName } : {}) };
}

export function detectHandback(content: unknown): Handback | null {
  if (Array.isArray(content) && content.some((b) => (b as { type?: unknown } | null)?.type === "tool_result")) return null;
  const raw = normalizeUserTextContent(content);
  if (raw == null || raw.length > OVERSIZE_REJECT) return null;
  // Cheap early exit (before any replace/regex): a real hand-back LEADS with the header, the marker or the envelope.
  const lead = raw.trimStart();
  if (!lead.startsWith(HEADER) && !lead.startsWith(MARKER) && !lead.startsWith("<agent-message") && !lead.startsWith("<cross-session-message")) return null;
  const text = raw.replace(/\r\n/g, "\n");
  // Every fingerprint is ANCHORED to the start of the record (code-review finding): a human message that
  // merely quotes the marker or the envelope mid-text stays a user message with its text intact.
  const head = text.trimStart();
  const cross = CROSS_OPEN.exec(text);
  if (cross && leadsRecord(text, cross.index)) return fromCrossSession(text, cross);
  const found = ENVELOPE_OPEN.exec(text);
  // The envelope counts only when it LEADS the record: nothing before it, or just the one header line.
  const before = found ? text.slice(0, found.index).trim() : "";
  const envelope = found && (before === "" || (before.startsWith(HEADER) && !before.includes("\n"))) ? found : null;
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

  // "subagent" only when the marker opens the body; a quote of it inside another session's text does not count.
  const isMarked = body.trimStart().startsWith(MARKER);
  const markerAt = isMarked ? body.indexOf(MARKER) : -1;
  if (markerAt >= 0) {
    const followsAt = body.indexOf(REPORT_FOLLOWS, markerAt);
    body = followsAt >= 0 ? body.slice(followsAt + REPORT_FOLLOWS.length) : body.slice(markerAt + MARKER.length);
    // The harness indents every report line by two spaces; undo that.
    // Only when EVERY non-blank line carries it, so a differently indented report is left intact.
    body = body.replace(/^\n/, "");
    const lines = body.split("\n").filter((l) => l.trim());
    if (lines.length > 0 && lines.every((l) => l.startsWith("  "))) body = body.replace(/^ {2}/gm, "");
  }
  // The harness's closing paragraph trails the header-only shape; inside an envelope it is outside the body already.
  if (!envelope) body = body.replace(TRAILER, "");
  return { sender: envelope?.[1] ?? "", origin: isMarked ? "subagent" : "session", text: body.trim() };
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
