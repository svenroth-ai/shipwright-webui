/*
 * Radix Dialog shell shared by every NewIssueModal body. Owns:
 *   - Dialog.Root + Portal + Overlay (ESC + backdrop close — Radix-builtin).
 *   - Header: 34x34 icon tile + title + subtitle + close button.
 *   - The form element (`<form onSubmit={…}>`) — body renders inside the
 *     scrollable middle.
 *   - Footer: Esc hint + Save-to-Backlog button + Launch button + error
 *     bar.
 *
 * Stays presentational — all state + handlers come from the hook via the
 * dispatcher. ModalShell is intentionally dumb so per-mode behavior can
 * drift in the body without touching shell layout.
 *
 * Step 3.5 review OpenAI #14 — footer is fully driven by hook-derived
 * `canSubmit` / `submitting` / `error` props. No shell-local logic
 * beyond presentation.
 */

import * as Dialog from "@radix-ui/react-dialog";
import { Bookmark, X } from "lucide-react";
import type { FormEvent, ReactNode } from "react";

import {
  modeHeading,
  modeIcon,
  modeSubheading,
  modeWidthClass,
} from "./palette";
import type { Mode, ModePalette, SubmitAction } from "./types";
import type { ActionDefinition } from "../../../lib/externalApi";

export interface ModalShellProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: Mode;
  action: ActionDefinition;
  palette: ModePalette;
  canSubmit: boolean;
  submitting: boolean;
  error: string | null;
  onSubmit: (ev: FormEvent, submitAction: SubmitAction) => void | Promise<void>;
  children: ReactNode;
}

export function ModalShell({
  open,
  onOpenChange,
  mode,
  action,
  palette,
  canSubmit,
  error,
  onSubmit,
  children,
}: ModalShellProps) {
  const widthClass = modeWidthClass(mode);
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px]" />
        <Dialog.Content
          className={`fixed left-1/2 top-[10%] z-50 ${widthClass} max-w-[95vw] -translate-x-1/2 overflow-hidden rounded-[var(--radius-card,12px)] bg-white shadow-[var(--shadow-modal,0_20px_60px_rgba(0,0,0,0.28))]`}
          data-testid={`new-issue-modal-${mode}`}
        >
          {/* Header: icon tile + title/subtitle + close */}
          <div className="flex items-center gap-3 border-b border-[var(--color-border,#e0dbd4)] px-5 py-4">
            <div
              data-testid="new-issue-header-icon"
              className="flex h-[34px] w-[34px] flex-shrink-0 items-center justify-center rounded-[8px]"
              style={{ background: palette.bg, color: palette.text }}
              aria-hidden
            >
              {modeIcon(mode)}
            </div>
            <div className="min-w-0 flex-1">
              <Dialog.Title
                className="text-[16px] font-bold tracking-tight text-[var(--color-text,#1a1a1a)]"
                style={{ letterSpacing: "-0.2px" }}
              >
                {modeHeading(mode, action)}
              </Dialog.Title>
              <Dialog.Description className="mt-0.5 text-[12px] leading-[1.4] text-[var(--color-muted,#6b7280)]">
                {modeSubheading(mode, action)}
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                aria-label="Close"
                data-testid="new-issue-modal-close"
                className="rounded-[6px] p-1 text-[var(--color-muted,#6b7280)] hover:bg-[var(--color-muted-bg,#ede8e1)] hover:text-[var(--color-text,#1a1a1a)]"
              >
                <X size={14} />
              </button>
            </Dialog.Close>
          </div>

          <form
            onSubmit={(e) => void onSubmit(e, "launch")}
            data-testid="new-issue-modal-form"
          >
            <div className="flex max-h-[calc(100vh-280px)] flex-col gap-4 overflow-y-auto px-5 py-4">
              {children}

              {/* Helper-box — per-mode palette. */}
              <div
                className="flex items-start gap-2 rounded-[var(--radius-button,8px)] px-3 py-2.5 text-[12px] leading-[1.55]"
                style={{
                  background: palette.bg,
                  color: palette.text,
                  borderLeft: `3px solid ${palette.stripe}`,
                }}
              >
                <div>
                  <strong
                    className="font-semibold"
                    style={{ color: palette.textStrong }}
                  >
                    Save to Backlog:
                  </strong>{" "}
                  task lands in the Backlog column as a draft — nothing
                  spawns.
                  <br />
                  <strong
                    className="font-semibold"
                    style={{ color: palette.textStrong }}
                  >
                    Launch:
                  </strong>{" "}
                  task moves to In&nbsp;Progress, TaskDetail opens, and the
                  command runs automatically in the embedded terminal there.
                </div>
              </div>

              {error && (
                <div
                  data-testid="new-issue-error"
                  className="text-[12px] text-[var(--color-error,#DC2626)]"
                >
                  {error}
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2 border-t border-[var(--color-border,#e0dbd4)] bg-[var(--color-bg,#f5f0eb)] px-5 py-3">
              <div
                className="flex-1 text-[11px] text-[var(--color-muted,#6b7280)]"
                data-testid="new-issue-footer-hint"
              >
                <kbd className="rounded-[3px] border border-[var(--color-border,#e0dbd4)] bg-white px-1.5 py-0.5 font-mono text-[10px]">
                  Esc
                </kbd>{" "}
                to cancel
              </div>
              <button
                type="button"
                data-testid="new-issue-save-btn"
                onClick={(e) => void onSubmit(e, "save")}
                disabled={!canSubmit}
                className="inline-flex items-center gap-1.5 rounded-[var(--radius-button,8px)] border-[1.5px] border-[var(--color-border,#e0dbd4)] bg-[var(--color-muted-bg,#ede8e1)] px-4 py-1.5 pointer-coarse:min-h-[44px] text-[13px] font-medium text-[var(--color-text,#1a1a1a)] hover:bg-[var(--color-border,#e0dbd4)] disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Bookmark
                  size={14}
                  className="text-[var(--color-accent,#857568)]"
                  strokeWidth={1.6}
                />
                Save to Backlog
              </button>
              <button
                type="submit"
                data-testid="new-issue-launch-btn"
                disabled={!canSubmit}
                className="inline-flex items-center gap-1.5 rounded-[var(--radius-button,8px)] bg-[var(--color-primary,#6b5e56)] px-4 py-1.5 pointer-coarse:min-h-[44px] text-[13px] font-semibold text-white hover:bg-[var(--color-primary-hover,#5a4f48)] disabled:cursor-not-allowed disabled:opacity-60"
              >
                Launch
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
