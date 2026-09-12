/*
 * ModalScrollBody — the scrollable middle of a dialog, and the SINGLE carrier of
 * the bounded-scroll-container invariant. This comment is the canonical
 * explanation; everywhere else points here.
 *
 * INVARIANT: children keep their natural height; the container scrolls.
 * Never the other way round.
 *
 * Why it needs a carrier (iterate-2026-07-14-more-options-flex-clip): a dialog
 * body is a column flex container with a bounded height. A flex item is
 * normally floored at its content height by the automatic minimum size
 * (`min-height: auto`) — but CSS turns that floor OFF for any item whose
 * `overflow` is not `visible`. Such a child is therefore the one flexbox is
 * free to squeeze below its content, which it then silently CLIPS; and because
 * it swallows the negative free space, the container never becomes scrollable,
 * so the clipped content is unreachable rather than merely off-screen.
 * MoreOptionsDisclosure (`overflow-hidden`, for corner rounding) hit exactly
 * that and rendered ~300px of fields into a ~12px box.
 *
 * `[&>*]:shrink-0` disarms it. It lives HERE rather than being re-typed per
 * dialog because three dialog bodies had duplicated the same class string and
 * only one carried the guard — the constraint did not travel with the pattern
 * (iterate-2026-07-14-modal-scroll-body-invariant). It belongs to the container
 * that creates the negative free space: a body receives its children as opaque
 * props and cannot enumerate them.
 *
 * Callers own ONLY what genuinely varies — the height budget and the gap
 * (`max-h-full gap-4`). Do not re-declare `overflow-y-auto` or the guard;
 * `client/src/test/modal-scroll-body-invariant.test.ts` ratchets that (it
 * also rejects any className here beyond `max-h-*` / `gap-*`, since the
 * client has no tailwind-merge and a stray `overflow-visible` would win or
 * lose silently by stylesheet order).
 *
 * Prefer `max-h-full` inside a `min-h-0 flex-1` flex parent over a
 * `calc(100vh-Npx)` budget (iterate-2026-09-12-mobile-triage-form-layout) — a
 * pixel/vh budget is a magic number that mis-sizes on mobile, where `100vh`
 * can exceed the actually-visible viewport (see ModalShell.tsx).
 *
 * `max-h-full` REQUIREMENT on that parent (external code-review finding,
 * same iterate): a percentage height only resolves against a DEFINITE
 * ancestor size, and a flex item's flexed main size is definite for
 * measuring the item's own box but does NOT, by itself, extend that
 * definiteness to a percentage-sized descendant — only when the item is
 * ITSELF also a flex/grid container (`display:flex`/`grid`) does its
 * content box become a valid resolution target for a child's `max-h-full`.
 * A plain `display:block` `min-h-0 flex-1` wrapper silently fails this:
 * `max-h-full` computes to `none` and the body grows unbounded. This is not
 * hypothetical — it shipped once (ModalShell.tsx's body-slot wrapper was
 * missing `flex flex-col` on itself) and was caught only by a forced-overflow
 * E2E test, not by any unit fence. Any new `max-h-full` caller must confirm
 * ITS immediate parent is `flex flex-col min-h-0 flex-1` (or `grid`), not
 * merely `min-h-0 flex-1`.
 *
 * Escape hatch: a child that legitimately must shrink needs its own `min-h-0`,
 * not a bare `shrink` — equal specificity means source order would decide.
 */

import type { ReactNode } from "react";

export interface ModalScrollBodyProps {
  /** The variable half ONLY: height budget + gap, e.g. "max-h-full gap-4". */
  className?: string;
  children: ReactNode;
  "data-testid"?: string;
}

/** Invariant half — never overridden by callers. Module-private on purpose:
 *  exporting it would invite exactly the hand-rolled usage this component exists
 *  to prevent. */
const INVARIANT = "flex flex-col overflow-y-auto px-5 py-4 [&>*]:shrink-0";

export function ModalScrollBody({
  className = "",
  children,
  "data-testid": testId,
}: ModalScrollBodyProps) {
  return (
    <div data-testid={testId} className={`${INVARIANT} ${className}`.trim()}>
      {children}
    </div>
  );
}
