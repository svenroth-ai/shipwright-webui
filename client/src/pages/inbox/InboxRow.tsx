/*
 * InboxRow — one Inbox entry as a compact Triage-style row
 * (iterate-2026-11-22-w2-inbox-triage-look). Left: the coloured kind chip and the
 * first line of the text. Right: a fixed, otherwise EMPTY action zone (the
 * "Answer in the terminal" button appears in it on hover / keyboard focus, so
 * the title never reflows; on touch and narrow rows it sits under the title and
 * is always visible) and the meta cluster (copyable session id, age). The full
 * text lives in the detail dialog the row opens. Layout is triage-rows.css
 * (the same container-query row Triage uses); the chip colours are
 * inbox-cards.css. Dark glass: explicit white tints, never a flipping token.
 */
import { useMemo } from "react";

import { TriageIdCopy } from "../../components/triage/TriageIdCopy";
import { formatRelativeTime } from "../../lib/formatTime";
import type { ExternalTask } from "../../lib/externalApi";
import { InboxResumeButton } from "./InboxResumeButton";
import type { InboxRowModel } from "./inboxRowModel";

/** Clicks on interactive bits and on the selectable id must not open the dialog. */
const NO_OPEN = "button,a,input,select,textarea,label,[data-no-open]";

interface Props {
  itemKey: string;
  sessionUuid: string;
  model: InboxRowModel;
  task: ExternalTask | undefined;
  onOpen: () => void;
  /** Extra attribute some specs still read (`data-testid-legacy`). */
  legacyTestId?: string;
}

export function InboxRow({ itemKey, sessionUuid, model, task, onOpen, legacyTestId }: Props) {
  const timeAgo = useMemo<string | null>(() => {
    const stamp = task?.launchedAt ?? task?.createdAt;
    return stamp ? formatRelativeTime(stamp) : null;
  }, [task?.launchedAt, task?.createdAt]);

  return (
    <div
      role="listitem"
      className="triage-row inbox-row relative block rounded-[10px] border border-white/[0.09] bg-white/[0.055] text-white/95 transition-colors hover:border-white/20 hover:bg-white/10 focus-within:border-white/20 focus-within:bg-white/10"
      data-testid={`inbox-card-${itemKey}`}
      data-testid-legacy={legacyTestId}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest(NO_OPEN)) return;
        // Dragging across the row's text to select it must not open the dialog.
        const sel = window.getSelection();
        if (sel?.toString() && sel.anchorNode && e.currentTarget.contains(sel.anchorNode)) return;
        onOpen();
      }}
    >
      <div className="triage-row-in">
        <div className="triage-row-main flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1">
          <span className={`inbox-chip is-${model.chip.tone}`} data-testid={`inbox-chip-${itemKey}`}>
            {model.chip.label}
          </span>
          <h3 className="m-0 min-w-0 flex-1 basis-full text-sm font-medium leading-snug [overflow-wrap:anywhere] md:basis-0">
            <button
              type="button"
              onClick={onOpen}
              data-nav-item
              data-testid={`inbox-row-title-${itemKey}`}
              className="inbox-row-title text-left hover:underline focus-visible:underline"
            >
              {model.title}
            </button>
          </h3>
        </div>

        <div className="triage-row-actions" data-no-open data-testid={`inbox-row-actions-${itemKey}`}>
          {task && model.answeredInTerminal && <InboxResumeButton task={task} idKey={itemKey} />}
        </div>

        <div className="triage-row-meta">
          <TriageIdCopy
            id={sessionUuid}
            display={sessionUuid.slice(0, 8)}
            testIdBase={`inbox-row-${itemKey}`}
            title={`Session ${sessionUuid}`}
            label="Copy session id"
          />
          {timeAgo && (
            <span className="min-w-[3.4rem] whitespace-nowrap text-right text-xs tabular-nums text-white/60" data-testid={`inbox-row-age-${itemKey}`}>
              {timeAgo}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
