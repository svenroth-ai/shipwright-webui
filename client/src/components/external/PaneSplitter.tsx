/*
 * PaneSplitter — the keyboard-accessible resize handle between two panes of
 * TaskDetailThreePane (extracted so the shell stays under the 300-LOC guideline
 * when A18 added focus-mode wiring; the two handles were verbatim-duplicated).
 *
 * Renders exactly one react-resizable-panels <PanelResizeHandle> so it still
 * registers with the enclosing <PanelGroup> by context. Arrow keys nudge the
 * width in 10px steps; Enter toggles collapse — the handler is owned by the
 * caller (TaskDetailThreePane) so the left/right semantics stay there.
 */

import { PanelResizeHandle } from "react-resizable-panels";

interface Props {
  hidden: boolean;
  testId: string;
  ariaValueMin: number;
  ariaValueMax: number;
  ariaValueNow: number;
  ariaLabel: string;
  onKeyDown: (e: React.KeyboardEvent) => void;
}

export function PaneSplitter({
  hidden,
  testId,
  ariaValueMin,
  ariaValueMax,
  ariaValueNow,
  ariaLabel,
  onKeyDown,
}: Props) {
  return (
    <PanelResizeHandle
      className={
        (hidden ? "hidden " : "") +
        "group relative w-[5px] shrink-0 cursor-col-resize bg-transparent transition hover:bg-[var(--color-primary,#6b5e56)]/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary,#6b5e56)]"
      }
      data-testid={testId}
      role="separator"
      aria-orientation="vertical"
      aria-valuemin={ariaValueMin}
      aria-valuemax={ariaValueMax}
      aria-valuenow={ariaValueNow}
      aria-label={ariaLabel}
      tabIndex={0}
      // react-resizable-panels' HTMLAttributes alias types onKeyDown as
      // KeyboardEventHandler<string> (a library typing quirk); our handler is
      // structurally compatible, so cast locally in this single-prop scope.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      onKeyDown={onKeyDown as any}
    />
  );
}
