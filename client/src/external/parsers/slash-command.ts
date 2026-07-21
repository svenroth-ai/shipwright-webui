/*
 * Slash-command detector — iterate-20260423-chat-rendering-polish, extended by
 * FR-01.68 AC2b (2026-07-21) to carry `<command-args>`.
 *
 * Reclassifies a user-role event whose content is EXCLUSIVELY a Claude Code
 * slash-command invocation, so the renderer shows a command chip instead of a
 * user bubble full of XML. Mixed content — prose that merely MENTIONS the tags
 * — must never be swallowed, which is what the anchored pattern is for.
 *
 * Split out of `session-parser.ts` (FR-01.68): that file sits at its bloat
 * baseline, and detection siblings already live here (`stop-hook.ts`).
 *
 * THE ARGUMENTS ARE THE POINT. The detector previously required the content to
 * END with `</command-name>` and capped the whole string at 200 characters. A
 * real `/shipwright-iterate` invocation ends with `</command-args>` and runs to
 * several hundred characters, so it satisfied NEITHER rule and fell through to
 * `kind: "user"` carrying raw XML. Probe over 202 real transcripts: 124 kickoff
 * events in 123 transcripts, 124 rejected — 100%, 123 of them on the length
 * cap. Consequences, all shipped: `isIterateStart` never fired, so
 * `Markers.iterateKickoff` was false for EVERY real iterate and the
 * `scenario === "plain" && !m.iterateKickoff` branch in `stage-derivation.ts`
 * (its own comment: "load-bearing and NOT a loophole") never ran; and
 * `topicFor` returned a raw tag as the session's topic.
 */

/**
 * Envelope caps. The HEAD (message + name) keeps the original ~200 guard — a
 * legitimate command name is ~50 characters, so a longer head is user prose
 * that happened to contain tag shapes. The ARGS payload gets its own, larger
 * bound: it is a human request, not a name.
 */
const MAX_SLASH_HEAD = 200;
const MAX_SLASH_TOTAL = 8192;

/**
 * `[^<\n]+` (no newlines, no `<` inside the tags) narrows the match so a real
 * user message whose text contains balanced tag strings cannot match. The args
 * group is permissive by necessity — it carries arbitrary human prose — but is
 * still pinned between the anchored head and the end of the string.
 */
const SLASH_PATTERN =
  /^<command-message>([^<\n]+)<\/command-message>\s*<command-name>\/([^<\n]+)<\/command-name>(?:\s*<command-args>([\s\S]*)<\/command-args>)?$/;

export interface DetectedSlashCommand {
  commandName: string;
  /** The `<command-args>` payload, when present. For a `/shipwright-iterate`
   *  session this is where the operator's REQUEST lives. */
  args?: string;
}

export function detectSlashCommand(content: unknown): DetectedSlashCommand | null {
  if (typeof content !== "string") return null;
  if (content.length > MAX_SLASH_TOTAL) return null;
  const trimmed = content.trim();
  if (!trimmed.startsWith("<command-message>")) return null;
  if (!trimmed.endsWith("</command-name>") && !trimmed.endsWith("</command-args>")) {
    return null;
  }
  const argsAt = trimmed.indexOf("<command-args>");
  if ((argsAt >= 0 ? argsAt : trimmed.length) > MAX_SLASH_HEAD) return null;
  const match = trimmed.match(SLASH_PATTERN);
  if (!match) return null;
  const [, inner, named, args] = match;
  // Names must match (Claude Code always emits them paired). If they differ,
  // the content is hand-crafted and should render as plain user.
  if (inner.trim() !== named.trim()) return null;
  const trimmedArgs = args?.trim();
  return trimmedArgs
    ? { commandName: `/${named.trim()}`, args: trimmedArgs }
    : { commandName: `/${named.trim()}` };
}
