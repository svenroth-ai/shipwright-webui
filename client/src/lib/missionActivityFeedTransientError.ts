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
 * Anchored on the prefix, the tool name, AND the complete fixed suffix that
 * follows it — matching all the way to an END anchor (external code review,
 * openai, blocking twice across two independent passes: first that matching
 * the prefix alone via `startsWith` would also classify a genuinely
 * different failure whose own output happens to begin with this exact
 * sentence; then, once the match required the suffix's lead-in ("...about
 * the action: ") but stopped there with no end anchor, that a genuine error
 * whose own output CONTINUES with that same lead-in — a coincidence, or a
 * pasted excerpt of this very message followed by real failure detail —
 * would still match, since anything after "action: " was accepted
 * unconditionally). The suffix has exactly one variable-shaped span (the
 * tool name) and is otherwise fixed start-to-finish, so the whole template
 * is spelled out here verbatim and end-anchored with `$` (content is
 * `.trim()`ed before testing, so no trailing whitespace needs matching). A
 * genuinely different failure whose own output merely QUOTES the template
 * somewhere in the middle (e.g. a pasted log excerpt with more text after
 * it) now fails to match at either end.
 */
const TRANSIENT_CLASSIFIER_ERROR_PATTERN =
  /^The server-side auto mode classifier gave no verdict \(error\), so auto mode cannot determine the safety of [^.]+\. This is a transient failure of the check, not a judgment about the action: a later response may get a verdict\. You may try the action again once, as-is\.$/;

export function isTransientClassifierError(content: string): boolean {
  return TRANSIENT_CLASSIFIER_ERROR_PATTERN.test(content.trim());
}
