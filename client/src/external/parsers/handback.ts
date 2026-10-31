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

export function detectHandback(content: unknown): { sender: string; origin: HandbackOrigin; text: string } | null {
  if (Array.isArray(content) && content.some((b) => (b as { type?: unknown } | null)?.type === "tool_result")) return null;
  const raw = normalizeUserTextContent(content);
  if (raw == null || raw.length > OVERSIZE_REJECT) return null;
  const text = raw.replace(/\r\n/g, "\n");
  // Every fingerprint is ANCHORED to the start of the record (code-review finding): a human message that
  // merely quotes the marker or the envelope mid-text stays a user message with its text intact.
  const head = text.trimStart();
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
  body = body.replace(TRAILER, "");
  return { sender: envelope?.[1] ?? "", origin: isMarked ? "subagent" : "session", text: body.trim() };
}
