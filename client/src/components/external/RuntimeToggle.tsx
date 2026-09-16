/*
 * Segmented <button role="radio"> pair for the per-task runtime selector
 * (Spec/codex-light-webui.md §3.5). Visually mirrors AutonomyToggle.tsx's
 * shell/colors/sizing — a DIFFERENT axis (Claude vs Codex), not a variant
 * of Guided/Autonomous, so it deliberately does not share icons with it.
 *
 * Used on all three launch surfaces (NewTaskModal, NewIterateModal,
 * NewPipelineModal — directly below Title, above Phase) and on
 * EditTaskModal (read-only once the task has started, via
 * taskEditability.ts's isFieldEditable("runtime")).
 */

import { Bot, Terminal } from "lucide-react";

export type RuntimeValue = "claude" | "codex";

interface RuntimeToggleProps {
  value: RuntimeValue;
  onChange: (next: RuntimeValue) => void;
}

export function RuntimeToggle({ value, onChange }: RuntimeToggleProps) {
  return (
    <div
      className="inline-flex overflow-hidden rounded-[var(--radius-button,8px)] border-[1.5px] border-[var(--color-border,#e0dbd4)]"
      role="radiogroup"
      aria-label="Runtime"
      data-testid="runtime-toggle"
    >
      <SegmentButton
        active={value === "claude"}
        onClick={() => onChange("claude")}
        label="Claude"
        icon={<Bot size={12} />}
        testId="runtime-claude"
      />
      <SegmentButton
        active={value === "codex"}
        onClick={() => onChange("codex")}
        label="Codex"
        icon={<Terminal size={12} />}
        testId="runtime-codex"
      />
    </div>
  );
}

function SegmentButton({
  active,
  onClick,
  label,
  icon,
  testId,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  icon: React.ReactNode;
  testId: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      data-active={active ? "true" : undefined}
      data-testid={testId}
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 border-0 px-3 py-1.5 text-[12px] font-medium transition-colors first:border-r-[1.5px] first:border-[var(--color-border,#e0dbd4)] ${
        active
          ? "bg-[var(--color-primary,#6b5e56)] text-white"
          : "bg-white text-[var(--color-muted,#6b7280)] hover:bg-[var(--color-muted-bg,#ede8e1)] hover:text-[var(--color-text,#1a1a1a)]"
      }`}
    >
      {icon} {label}
    </button>
  );
}
