/*
 * TriageHelp — the small "?" next to a source label or an audit-check code
 * (iterate-2026-11-08-triage-page-redesign). A Radix popover, so it opens
 * on tap AND keyboard, closes on Esc / outside click, and is portaled — it
 * can never be clipped by a card or the detail dialog. Plain text only.
 */

import * as Popover from "@radix-ui/react-popover";

import type { HelpText } from "../../lib/triageHelpText";

export function TriageHelp({ help, subject }: { help: HelpText; subject: string }) {
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label={`What is ${help.title}?`}
          data-testid={`triage-help-${subject}`}
          // stopPropagation: a "?" inside a clickable card must not open the card.
          onClick={(e) => e.stopPropagation()}
          className="inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] text-[11px] font-semibold leading-none text-[var(--color-muted)] hover:border-[var(--color-primary)] hover:text-[var(--color-primary)] data-[state=open]:border-[var(--color-primary)] data-[state=open]:text-[var(--color-primary)]"
        >
          ?
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="bottom"
          align="start"
          sideOffset={6}
          collisionPadding={8}
          onClick={(e) => e.stopPropagation()}
          aria-label={help.title}
          data-testid="triage-help-content"
          className="z-[70] w-[min(320px,calc(100vw-16px))] rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-xs leading-snug text-[var(--color-text)] shadow-[var(--shadow-card)]"
        >
          <h4 className="mb-1.5 text-[13px] font-semibold">{help.title}</h4>
          {(
            [
              ["What is it", help.what],
              ["Why is it here", help.why],
              ["What to do", help.todo],
            ] as const
          ).map(([k, v]) => (
            <p key={k} className="mb-1.5 last:mb-0">
              <span className="block text-[10px] font-semibold uppercase tracking-[0.06em] text-[var(--color-muted)]">
                {k}
              </span>
              {v}
            </p>
          ))}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
