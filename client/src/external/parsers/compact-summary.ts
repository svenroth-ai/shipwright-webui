/**
 * Context-compaction summary detection. When Claude Code auto-compacts, it writes the summary of
 * the earlier conversation as a USER-role record (`isCompactSummary: true`) whose text opens with
 * framing boilerplate ("This session is being continued from a previous conversation..." or
 * "<artifact-content-authored-by-others/> The summarized conversation ..."). It is harness text, never
 * the human's: the Mission feed shows it as a collapsed system row instead of a human bubble.
 */

const ARTIFACT_TAG = /^\s*<artifact-content-authored-by-others\s*\/?>(?:\s*<\/artifact-content-authored-by-others>)?\s*/i;
const FRAMING = [/^This session is being continued from a previous conversation/i, /^The summarized conversation/i];

/** Plain text of a user record's content (string, text blocks, or `{content}`); tool results are ignored. */
export function contentPlainText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((b) => (b && typeof b === "object" && (b as { type?: unknown }).type === "text" && typeof (b as { text?: unknown }).text === "string" ? (b as { text: string }).text : ""))
      .filter(Boolean)
      .join("\n");
  }
  if (content && typeof content === "object" && typeof (content as { content?: unknown }).content === "string") return (content as { content: string }).content;
  return "";
}

/** True for the compaction summary: the CLI's own flag, or (older logs without it) the framing fingerprint. */
export function isCompactSummaryContent(content: unknown, flagged: boolean): boolean {
  if (flagged) return true;
  const text = contentPlainText(content).replace(ARTIFACT_TAG, "").trimStart();
  return FRAMING.some((re) => re.test(text));
}

/**
 * The summary body without the framing: the text after the first `Summary:` line when the CLI used
 * its usual template, otherwise everything after the boilerplate tag. Capped to keep the DOM bounded.
 */
export function compactSummaryBody(content: unknown, maxChars = 60_000): string {
  // Cap BEFORE scanning: the marker search never runs on unbounded input.
  let text = contentPlainText(content).replace(ARTIFACT_TAG, "").trim().slice(0, maxChars + 1);
  const marker = /^[ 	]*Summary:[ 	]*$/im.exec(text);
  if (marker) text = text.slice(marker.index + marker[0].length).trim();
  return text.length > maxChars ? `${text.slice(0, maxChars)}\n\n...` : text;
}
