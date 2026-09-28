/**
 * Detects the harness's own transient auto-mode-classifier hiccup — never a
 * real command failure (iterate-2026-09-28-mission-feed-completeness, AC3).
 * Split into its own tiny file rather than appended to
 * `missionActivityFeedText.ts`/`missionActivityFeedSubrunner.ts` (both at or
 * near the project's 300-line convention ceiling already).
 *
 * Verbatim text measured directly against a real captured transcript
 * (session `8a1e7a70-a4ed-41ec-be1e-83211838ba10`): "The server-side auto
 * mode classifier gave no verdict (error), so auto mode cannot determine the
 * safety of <ToolName>. This is a transient failure of the check, not a
 * judgment about the action: …". The tool name varies (`Bash`, others);
 * everything up to it is fixed and unique to this one system-generated
 * message, so it anchors the whole check.
 *
 * Anchored with `startsWith` on the TRIMMED content, not a bare substring
 * search: a genuinely different failure whose own output happens to QUOTE
 * this phrase somewhere in the middle (e.g. a pasted log excerpt) does not
 * start with it, so it is correctly still treated as a real failure — only
 * the harness's own literal, whole tool_result content matches.
 */
const TRANSIENT_CLASSIFIER_ERROR_PREFIX =
  "The server-side auto mode classifier gave no verdict (error), so auto mode cannot determine the safety of ";

export function isTransientClassifierError(content: string): boolean {
  return content.trim().startsWith(TRANSIENT_CLASSIFIER_ERROR_PREFIX);
}
