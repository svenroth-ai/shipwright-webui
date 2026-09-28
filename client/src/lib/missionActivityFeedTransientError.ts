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
 * everything else — both the lead-in and the sentence right after the tool
 * name — is fixed and unique to this one system-generated message.
 *
 * Anchored on BOTH the prefix and the fixed suffix that follows the tool
 * name (external code review, openai, blocking): matching the prefix alone
 * via `startsWith` would also classify a genuinely different failure whose
 * own output happens to begin with this exact sentence for unrelated
 * reasons, as transient. Requiring the fixed suffix too means only content
 * matching the harness's whole known template — prefix, then a short
 * tool-name-shaped run of non-period text, then the suffix — qualifies. A
 * genuinely different failure whose own output merely QUOTES the prefix
 * somewhere in the middle (e.g. a pasted log excerpt) still fails to match:
 * `test()` is anchored at the START of the trimmed content, not a bare
 * substring search.
 */
const TRANSIENT_CLASSIFIER_ERROR_PATTERN =
  /^The server-side auto mode classifier gave no verdict \(error\), so auto mode cannot determine the safety of [^.]+\. This is a transient failure of the check, not a judgment about the action: /;

export function isTransientClassifierError(content: string): boolean {
  return TRANSIENT_CLASSIFIER_ERROR_PATTERN.test(content.trim());
}
