/*
 * PaneSplitter — the keyboard-accessible resize handle between two panes of
 * TaskDetailThreePane (extracted so the shell stays under the 300-LOC guideline
 * when A18 added focus-mode wiring; the two handles were verbatim-duplicated).
 *
 * The handle IS the column gutter (SPLITTER_GUTTER_PX wide): the same 16px the Mission tab's cards
 * float apart by, so switching Mission <-> Files & Terminal never shifts a column. Only a thin
 * centred bar paints on hover/focus; the rest of the 16px is the (transparent) hit area.
 *
 * Renders exactly one react-resizable-panels <PanelResizeHandle> so it still
 * registers with the enclosing <PanelGroup> by context. Arrow keys nudge the
 * width in 10px steps; Enter toggles collapse — the handler is owned by the
 * caller (TaskDetailThreePane) so the left/right semantics stay there.
 */

import { PanelResizeHandle } from "react-resizable-panels";

/** Width of one splitter = the gutter between two cards (matches `.on-photo .mc-body { gap: 16px }`). */
export const SPLITTER_GUTTER_PX = 16; // the class below must say w-[16px] too (Tailwind needs the literal; mission-layout-parity.test.ts fences it)

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
        "group relative flex w-[16px] shrink-0 cursor-col-resize justify-center bg-transparent focus-visible:outline-none"
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
    >
      <span
        aria-hidden="true"
        className="pointer-events-none block h-full w-[5px] rounded-sm transition group-hover:bg-[var(--color-primary,#6b5e56)]/30 group-focus-visible:bg-[var(--color-primary,#6b5e56)]/60 group-focus-visible:ring-2 group-focus-visible:ring-[var(--color-primary,#6b5e56)]"
      />
    </PanelResizeHandle>
  );
}
