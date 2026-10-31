/*
 * Skill-loader fingerprint + the user-content text unwrapper both fingerprints share.
 * Moved out of `session-parser.ts` (bloat baseline) by campaign mission-desktop-style-v2 V2.
 */

/**
 * Unwrap user-message content into a single text string for fingerprint
 * detection. Claude JSONL emits user content in two shapes:
 *   (a) Plain string — e.g. slash-command invocations, typed messages.
 *   (b) Array of blocks `[{type: "text", text: "..."}, ...]` — e.g.
 *       skill-loader injections from Claude Code's CLI.
 *
 * Returns the string directly for (a), or the concatenated text from
 * all text blocks for (b). Returns null when no readable text can be
 * recovered (tool_result-only content, non-string / non-array shapes).
 */
export function normalizeUserTextContent(content: unknown): string | null {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return null;
  const parts: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const b = block as { type?: unknown; text?: unknown };
    if (b.type === "text" && typeof b.text === "string") parts.push(b.text);
  }
  if (parts.length === 0) return null;
  return parts.join("\n");
}

/**
 * 2026-04-23 — iterate-20260423-chat-followups AC-3 (parser fingerprint)
 * extended by iterate-20260423-chat-livetest-2 AC-A / ADR-056 (capture
 * the body so `<SkillCard>` can markdown-render it on expand).
 *
 * Claude Code's skill-loader injects the full skill manual as a user-role
 * message. Shape: `Base directory for this skill: <absolute path>` line,
 * blank line, then the manual starting with `# <Skill Title>`. Some
 * manuals include a short preamble blurb before the H1 heading.
 *
 * Detection is conservative:
 *   - content must be a string (arrays fall through)
 *   - length >= 100 chars (short messages like "Base directory for this
 *     skill: /x\n\n# Hi" stay user — real manuals run thousands of chars)
 *   - CRLF line endings normalized to LF before match
 *   - must start with the literal fingerprint (case-sensitive)
 *   - the first `# <heading>` line ANYWHERE after the first blank line is
 *     the skill name; leading/trailing whitespace stripped.
 *   - `body` = content from the H1 line onward (keeps the heading IN the
 *     body so Markdown rendering treats it as the doc title).
 *
 * Returns `{skillName, body}` on match, null otherwise. Mixed content
 * (user message that happens to contain the phrase mid-body) does not
 * match because startsWith is anchored.
 */
export function extractSkillBody(
  content: unknown,
): { skillName: string; body: string } | null {
  // 2026-04-23 — post-ship bug fix. Real Claude JSONL emits user-role
  // content as an array `[{type: "text", text: "..."}]` for skill-loader
  // injections (while slash-commands stay string). Earlier tests used
  // string-content and missed this asymmetry. Unwrap single text block
  // before running the fingerprint.
  const text = normalizeUserTextContent(content);
  if (text == null) return null;
  if (text.length < 100) return null;
  const normalized = text.replace(/\r\n/g, "\n");
  if (!normalized.startsWith("Base directory for this skill:")) return null;

  // Scan forward past the preamble (first blank line) for the first
  // top-level `# <heading>` (H1 only — `## Sub-heading` before the H1
  // would be a false positive). Allow leading whitespace on the heading.
  const lines = normalized.split("\n");
  let pastPreamble = false;
  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    if (!pastPreamble) {
      if (rawLine.trim() === "") pastPreamble = true;
      continue;
    }
    const trimmed = rawLine.trim();
    // H1 = `#` followed by whitespace (not `##`, `###`, etc.).
    if (!/^#\s+/.test(trimmed)) continue;
    const skillName = trimmed.replace(/^#\s+/, "").trim();
    if (skillName.length === 0) continue;
    // Body = from this H1 line onward (use the raw line, not trimmed,
    // so leading whitespace on subsequent lines is preserved for code
    // blocks etc.). `.slice(i)` keeps the H1 as the body's first line.
    const body = lines.slice(i).join("\n").trim();
    return { skillName, body };
  }
  return null;
}
