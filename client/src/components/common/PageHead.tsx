/*
 * PageHead — the ONE title bar, 92px, everywhere (A05, FR-01.48, AC1).
 *
 * Uniformity that depends on eight pages each remembering the same Tailwind
 * classes is uniformity that drifts again by A18. So the shared component IS the
 * mechanism: Board, Projects, Inbox, Triage, Settings and Diagnostics all render
 * <PageHead>, and the geometry (92px min-height, 32px gutter) lives once in
 * `.page-head` / `.page-head .inner` (styles/type-scale.css). Mission Control
 * keeps its own `.mc-top` (asymmetric back-arrow gutter) — see TaskDetailHeader.
 *
 * The OUTER element is block layout with min-height (NOT flex) — the prototype's
 * own warning (styles.css:123): making it flex breaks the inner's max-width +
 * margin:auto centring. The taupe ground + the .on-photo token flip render the
 * title/sub white-on-anthracite by construction.
 */

import type { ReactNode } from 'react';

interface PageHeadProps {
  /** The page title (rendered as `.page-title`, 20/28/600). Omit when `left` is used. */
  title?: ReactNode;
  /** Inline muted suffix after the title, e.g. a "(3 open)" count. */
  small?: ReactNode;
  /** Optional sub-line under the title (`.page-sub`, 13px muted). */
  sub?: ReactNode;
  /**
   * Escape hatch for the left cluster — used by the Task Board, whose "title" is
   * a project switcher + view toggle rather than a text heading. When given it
   * REPLACES the default title block.
   */
  left?: ReactNode;
  /** Extra classes for the left cluster (Board passes `chrome-dark-controls`). */
  leftClassName?: string;
  /** Right-hand actions slot (buttons, create controls). */
  actions?: ReactNode;
  /** Extra classes for the actions cluster (Board passes `chrome-dark-controls`). */
  actionsClassName?: string;
  /** Board: widen the inner box to 1600 to track `.board-container`. */
  wide?: boolean;
  /** testid on the `<header>` element. */
  testId?: string;
  /** testid on the title `<h1>`. */
  titleTestId?: string;
}

export function PageHead({
  title,
  small,
  sub,
  left,
  leftClassName,
  actions,
  actionsClassName,
  wide = false,
  testId,
  titleTestId,
}: PageHeadProps) {
  return (
    <header className="page-head" data-testid={testId}>
      <div className={`inner${wide ? ' wide' : ''}`}>
        {left !== undefined ? (
          <div className={`flex min-w-0 items-center gap-3${leftClassName ? ` ${leftClassName}` : ''}`}>
            {left}
          </div>
        ) : (
          <div className="min-w-0">
            <h1 className="page-title" data-testid={titleTestId}>
              {title}
              {small !== undefined && small !== null && <small>{small}</small>}
            </h1>
            {sub !== undefined && sub !== null && <div className="page-sub">{sub}</div>}
          </div>
        )}
        {actions !== undefined && actions !== null && (
          <div className={`flex shrink-0 items-center gap-3${actionsClassName ? ` ${actionsClassName}` : ''}`}>
            {actions}
          </div>
        )}
      </div>
    </header>
  );
}
