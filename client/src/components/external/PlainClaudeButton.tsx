/*
 * Icon-only button that opens the NewIssueModal in `new-plain` mode —
 * a Claude session in the project's directory with no Shipwright skill.
 *
 * v0.4.0 — sits to the LEFT of `<CreateMenuSplitButton>` in the
 * TaskBoardPage header. The "+ New ▾" split-button still owns the three
 * skill modes (task / pipeline / iterate); Plain Claude is a sibling
 * affordance for users who just want a chat scoped to the project cwd.
 *
 * Behavior:
 *   - When `actionsList` contains an action with id "new-plain", the
 *     button is enabled and clicking calls `onSelect(plainAction)`.
 *   - When no such action is registered (custom .webui/actions.json
 *     without it), the button hides itself rather than rendering a
 *     dead control.
 */

import { Terminal } from "lucide-react";

import type { ActionDefinition } from "../../lib/externalApi";

interface Props {
  actions: ActionDefinition[];
  onSelect: (action: ActionDefinition) => void;
  /** True while `useProjectActions` is loading. Matches CreateMenuSplitButton. */
  isLoading?: boolean;
}

export function PlainClaudeButton({ actions, onSelect, isLoading = false }: Props) {
  const plain = actions.find((a) => a.id === "new-plain");
  if (!plain) return null;

  return (
    <button
      type="button"
      onClick={() => onSelect(plain)}
      disabled={isLoading}
      data-testid="plain-claude-button"
      title="Plain Claude — start a chat in this project's directory"
      aria-label="Plain Claude — start a chat in this project's directory"
      className="inline-flex h-[38px] w-[38px] items-center justify-center rounded-[var(--radius-button)] text-[var(--color-muted)] transition-colors hover:bg-[var(--color-muted-bg)] hover:text-[var(--color-text)] disabled:cursor-not-allowed disabled:opacity-60"
    >
      <Terminal size={16} strokeWidth={1.7} />
    </button>
  );
}
