/*
 * CampaignLaunchDialog — the ONE confirmation dialog both campaign launch
 * affordances route through (FR-01.61, A17). No launch happens without it (AC2).
 *
 * It states, in the operator's language: WHAT will run (S<n> · title · spec
 * path), WHERE (project · cwd), and HOW — the exact command that is about to be
 * auto-executed in the terminal, shown verbatim (the caller passes the
 * server-authoritative string; this dialog never builds it — rule 1 / DO-NOT
 * #11, so no slash-command literal lives here). The autonomous variant adds the
 * remaining sub-iterates by name and says plainly it will not ask again.
 *
 * Presentational + controlled: the calling button owns the launch hook, the
 * open state, and the failure mapping; a rejected launch renders as an inline
 * <LaunchFailureNotice> (AC3), never a toast. Cancel creates nothing.
 */

import * as Dialog from "@radix-ui/react-dialog";
import { Bot, Play, TriangleAlert, X } from "lucide-react";

import type { CampaignStep } from "../../lib/campaignsApi";
import type { LaunchFailure } from "../../lib/launchFailure";
import { LaunchFailureNotice } from "./LaunchFailureNotice";

export interface CampaignLaunchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  slug: string;
  /** "campaign-step" | "campaign-autonomous" — keeps each surface's testids. */
  testIdPrefix: string;
  variant: "step" | "autonomous";
  title: string;
  /** The exact command about to run — passed by the caller, shown verbatim. */
  command: string;
  what: { stepId?: string; stepTitle?: string; specPath?: string | null };
  where: { projectName: string; cwd: string };
  /** Autonomous only: the pending sub-iterates this run will work through. */
  remaining?: CampaignStep[];
  /** Autonomous only: risky pending steps that gate confirm behind an ack. */
  risky?: CampaignStep[];
  ack?: boolean;
  onAckChange?: (v: boolean) => void;
  submitting: boolean;
  confirmDisabled?: boolean;
  confirmLabel: string;
  failure?: LaunchFailure | null;
  onConfirm: () => void;
  onRetry?: () => void;
  onCopyCommand?: () => void;
  onOpenTerminal?: () => void;
}

function riskyReason(step: CampaignStep): string {
  if (step.status === "failed") return "previously failed";
  if (step.status === "escalated") return "escalated";
  if (step.planFirst) return "plan-first";
  return "needs review";
}

export function CampaignLaunchDialog(props: CampaignLaunchDialogProps) {
  const {
    open, onOpenChange, slug, testIdPrefix, variant, title, command, what, where,
    remaining = [], risky = [], ack = false, onAckChange, submitting, confirmDisabled,
    confirmLabel, failure, onConfirm, onRetry, onCopyCommand, onOpenTerminal,
  } = props;
  const tid = (s: string) => `${testIdPrefix}-${s}-${slug}`;
  const Head = variant === "autonomous" ? Bot : Play;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px]" />
        <Dialog.Content
          data-testid={tid("dialog")}
          className="fixed left-1/2 top-[10%] z-50 flex max-h-[80vh] w-[540px] max-w-[95vw] -translate-x-1/2 flex-col overflow-hidden rounded-[var(--radius-card,12px)] bg-white shadow-[var(--shadow-modal,0_20px_60px_rgba(0,0,0,0.28))]"
        >
          <div className="flex items-center gap-3 border-b border-[var(--color-border,#e0dbd4)] px-5 py-4">
            <div className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[8px]" style={{ background: "var(--info-tint)", color: "var(--info)" }} aria-hidden>
              <Head size={18} strokeWidth={1.7} />
            </div>
            <Dialog.Title className="min-w-0 flex-1 text-[15px] font-bold tracking-tight text-[var(--color-text,#1a1a1a)]">
              {title}
            </Dialog.Title>
            <Dialog.Close asChild>
              <button type="button" aria-label="Close" className="rounded-[6px] p-1 text-[var(--color-muted,#6b7280)] hover:bg-[var(--color-muted-bg,#ede8e1)] hover:text-[var(--color-text,#1a1a1a)]">
                <X size={14} />
              </button>
            </Dialog.Close>
          </div>

          <div className="flex flex-col gap-3 overflow-y-auto [&>*]:shrink-0 px-5 py-4 text-[12px] text-[var(--color-text,#111827)]">
            {/* WHAT */}
            <Field label="What will run" testId={tid("what")}>
              {what.stepId && <span className="font-mono font-semibold">{what.stepId}</span>}{" "}
              <span className="text-[var(--color-muted)]">{what.stepTitle ?? slug}</span>
              {what.specPath && (
                <div className="mt-0.5 font-mono text-[11px] text-[var(--color-muted)]">{what.specPath}</div>
              )}
            </Field>

            {/* WHERE */}
            <Field label="Where" testId={tid("where")}>
              <span className="font-medium">{where.projectName}</span>
              <div className="mt-0.5 font-mono text-[11px] text-[var(--color-muted)]">{where.cwd}</div>
            </Field>

            {/* HOW — the verbatim command */}
            <Field label="Command" testId={tid("command-field")}>
              <code data-testid={tid("command")} className="block overflow-x-auto whitespace-pre rounded-[var(--radius-button,8px)] border border-[var(--color-border,#e0dbd4)] bg-[var(--color-bg,#f5f0eb)] px-2.5 py-1.5 font-mono text-[12px]">
                {command}
              </code>
            </Field>

            {variant === "autonomous" && (
              <div data-testid={tid("remaining")} className="rounded-[var(--radius-button,8px)] border border-[var(--color-border,#e0dbd4)] bg-[var(--color-bg,#f5f0eb)] px-3 py-2">
                <div className="text-[11px] font-semibold uppercase tracking-[0.04em] text-[var(--color-muted,#6b7280)]">
                  Runs {remaining.length} remaining sub-iterate{remaining.length === 1 ? "" : "s"}, unattended
                </div>
                <ul className="mt-1 flex flex-col gap-0.5">
                  {remaining.map((s) => (
                    <li key={s.id}>
                      <span className="font-mono font-semibold">{s.id}</span>{" "}
                      <span className="text-[var(--color-muted)]">{s.title}</span>
                    </li>
                  ))}
                </ul>
                <div className="mt-1.5 text-[11px] font-medium text-[var(--warn,#b45309)]">
                  It will not ask again — it keeps going until every step is done or one fails.
                </div>
              </div>
            )}

            {risky.length > 0 && (
              <div data-testid={tid("risky")} className="rounded-[var(--radius-button,8px)] border border-[var(--warn-line)] bg-warn-tint px-3 py-2 text-warn">
                <div className="flex items-center gap-1.5 font-semibold">
                  <TriangleAlert size={13} />
                  Risky pending step{risky.length === 1 ? "" : "s"} — review before running unattended
                </div>
                <ul className="mt-1 flex flex-col gap-0.5">
                  {risky.map((s) => (
                    <li key={s.id}>
                      <span className="font-mono font-semibold">{s.id}</span>{" "}
                      <span>{s.title}</span> <span>— {riskyReason(s)}</span>
                    </li>
                  ))}
                </ul>
                <label className="mt-2 flex cursor-pointer items-start gap-2">
                  <input type="checkbox" data-testid={tid("ack")} checked={ack} onChange={(e) => onAckChange?.(e.target.checked)} className="mt-0.5" />
                  <span>I understand — run these unattended anyway.</span>
                </label>
              </div>
            )}

            {failure && (
              <LaunchFailureNotice
                testId={tid("failure")}
                failure={failure}
                busy={submitting}
                actions={{
                  retry: onRetry ? { onClick: onRetry } : undefined,
                  "copy-command": onCopyCommand ? { onClick: onCopyCommand } : undefined,
                  "open-terminal": onOpenTerminal ? { onClick: onOpenTerminal } : undefined,
                }}
              />
            )}
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-[var(--color-border,#e0dbd4)] bg-[var(--color-bg,#f5f0eb)] px-5 py-3">
            <Dialog.Close asChild>
              <button type="button" data-testid={tid("cancel")} className="inline-flex items-center rounded-[var(--radius-button,8px)] border-[1.5px] border-[var(--color-border,#e0dbd4)] bg-[var(--color-muted-bg,#ede8e1)] px-4 py-1.5 text-[13px] font-medium text-[var(--color-text,#1a1a1a)] hover:bg-[var(--color-border,#e0dbd4)]">
                Cancel
              </button>
            </Dialog.Close>
            <button type="button" onClick={onConfirm} disabled={submitting || confirmDisabled} data-testid={tid("confirm")} className="inline-flex items-center gap-1.5 rounded-[var(--radius-button,8px)] bg-[var(--color-primary,#6b5e56)] px-4 py-1.5 text-[13px] font-semibold text-white hover:bg-[var(--color-primary-hover,#5a4f48)] disabled:cursor-not-allowed disabled:opacity-60">
              <Head size={14} />
              {submitting ? "Launching…" : confirmLabel}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function Field({ label, testId, children }: { label: string; testId: string; children: React.ReactNode }) {
  return (
    <div data-testid={testId}>
      <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.04em] text-[var(--color-muted,#6b7280)]">
        {label}
      </div>
      <div>{children}</div>
    </div>
  );
}
