/*
 * CampaignAutonomousLaunchButton — the SECOND Campaigns-lane action (FR-01.34).
 *
 * Unlike the per-step "Copy launch (Bx)" affordance (a clipboard copy), this
 * opens a real TaskDetail terminal that auto-runs
 * `/shipwright-iterate --campaign <slug> --autonomous` — exactly like a normal
 * iterate launch (create task → server builds the command → sessionStorage
 * handoff → navigate → embedded terminal auto-executes; see useLaunchCampaign).
 *
 * Autonomous = NO per-step gate (every remaining pending sub-iterate runs in
 * order), so the action is guarded by a confirm dialog. When a pending step is
 * risky (previously failed/escalated, or flagged plan-first via its sub-iterate
 * frontmatter) the dialog lists it and the confirm button is disabled until the
 * operator explicitly acknowledges running it unattended (warn, never a dead
 * button). Disabled outright when there is nothing pending / no project.
 */

import { useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import * as Dialog from "@radix-ui/react-dialog";
import { Bot, TriangleAlert, X } from "lucide-react";

import type { Campaign, CampaignStep } from "../../lib/campaignsApi";
import { selectRiskyPendingSteps } from "../../lib/campaignsApi";
import type { Project } from "../../types";
import { useLaunchCampaign, type LaunchCampaignResult } from "../../hooks/useLaunchCampaign";

function riskyReason(step: CampaignStep): string {
  if (step.status === "failed") return "previously failed";
  if (step.status === "escalated") return "escalated";
  if (step.planFirst) return "plan-first";
  return "needs review";
}

function errorMessage(result: Extract<LaunchCampaignResult, { ok: false }>): string {
  const base =
    result.reason === "create_failed"
      ? "Could not create the campaign task."
      : "Launch failed.";
  return result.detail ? `${base} (${result.detail})` : base;
}

export function CampaignAutonomousLaunchButton({
  campaign,
  project,
}: {
  campaign: Campaign;
  project: Project | null | undefined;
}) {
  const navigate = useNavigate();
  const launchCampaign = useLaunchCampaign();

  const [open, setOpen] = useState(false);
  const [ack, setAck] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  const slug = campaign.slug;
  const command = `/shipwright-iterate --campaign ${slug} --autonomous`;
  const risky = useMemo(() => selectRiskyPendingSteps(campaign), [campaign]);
  const hasPending = campaign.done < campaign.total;
  const canLaunch = Boolean(project) && hasPending;
  const confirmDisabled = submitting || (risky.length > 0 && !ack);

  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) {
      setAck(false);
      setError(null);
      setSubmitting(false);
      inFlight.current = false;
    }
  };

  const onConfirm = async () => {
    if (inFlight.current || !project) return;
    // Defense-in-depth: enforce the risky-step acknowledgment in logic, not
    // only via the disabled button (AC-8) — the ack is a real gate, not a
    // presentation-only control.
    if (risky.length > 0 && !ack) return;
    inFlight.current = true;
    setSubmitting(true);
    setError(null);
    const result = await launchCampaign({
      project: { id: project.id, path: project.path },
      slug,
    });
    if (result.ok) {
      setOpen(false);
      navigate(`/tasks/${result.taskId}`);
      return;
    }
    setError(errorMessage(result));
    setSubmitting(false);
    inFlight.current = false;
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Trigger asChild>
        <button
          type="button"
          disabled={!canLaunch}
          data-testid={`campaign-autonomous-launch-${slug}`}
          className="inline-flex items-center gap-1.5 rounded-[6px] border border-[var(--color-border)] px-2.5 py-1 text-[12px] font-medium text-[var(--color-text,#111827)] transition-colors enabled:hover:bg-[var(--color-muted-bg)] disabled:cursor-not-allowed disabled:opacity-50"
          title={
            canLaunch
              ? `Open a terminal running: ${command}`
              : "No pending sub-iterate to run (or no project resolved)"
          }
        >
          <Bot size={12} />
          Launch autonomous
        </button>
      </Dialog.Trigger>

      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px]" />
        <Dialog.Content
          data-testid={`campaign-autonomous-dialog-${slug}`}
          className="fixed left-1/2 top-[12%] z-50 w-[520px] max-w-[95vw] -translate-x-1/2 overflow-hidden rounded-[var(--radius-card,12px)] bg-white shadow-[var(--shadow-modal,0_20px_60px_rgba(0,0,0,0.28))]"
        >
          <div className="flex items-center gap-3 border-b border-[var(--color-border,#e0dbd4)] px-5 py-4">
            <div
              className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[8px]"
              style={{ background: "#f3e8ff", color: "#7e22ce" }}
              aria-hidden
            >
              <Bot size={18} strokeWidth={1.7} />
            </div>
            <div className="min-w-0 flex-1">
              <Dialog.Title className="text-[15px] font-bold tracking-tight text-[var(--color-text,#1a1a1a)]">
                Launch autonomous campaign
              </Dialog.Title>
              <Dialog.Description className="mt-0.5 text-[12px] leading-[1.4] text-[var(--color-muted,#6b7280)]">
                Opens a terminal and runs every remaining pending sub-iterate of{" "}
                <span className="font-mono">{slug}</span> in order — with{" "}
                <strong>no per-step gate</strong>.
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                aria-label="Close"
                className="rounded-[6px] p-1 text-[var(--color-muted,#6b7280)] hover:bg-[var(--color-muted-bg,#ede8e1)] hover:text-[var(--color-text,#1a1a1a)]"
              >
                <X size={14} />
              </button>
            </Dialog.Close>
          </div>

          <div className="flex flex-col gap-3 px-5 py-4">
            <div>
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.04em] text-[var(--color-muted,#6b7280)]">
                Command
              </div>
              <code
                data-testid={`campaign-autonomous-command-${slug}`}
                className="block overflow-x-auto whitespace-pre rounded-[var(--radius-button,8px)] border border-[var(--color-border,#e0dbd4)] bg-[var(--color-bg,#f5f0eb)] px-2.5 py-1.5 font-mono text-[12px] text-[var(--color-text,#111827)]"
              >
                {command}
              </code>
            </div>

            {risky.length > 0 && (
              <div
                data-testid={`campaign-autonomous-risky-${slug}`}
                className="rounded-[var(--radius-button,8px)] border border-[#fcd34d] bg-[#fffbeb] px-3 py-2 text-[12px] text-[#92400e]"
              >
                <div className="flex items-center gap-1.5 font-semibold">
                  <TriangleAlert size={13} />
                  Risky pending step{risky.length === 1 ? "" : "s"} — review before running unattended
                </div>
                <ul className="mt-1 flex flex-col gap-0.5">
                  {risky.map((s) => (
                    <li key={s.id}>
                      <span className="font-mono font-semibold">{s.id}</span>{" "}
                      <span className="text-[#b45309]">{s.title}</span>{" "}
                      <span className="text-[#92400e]">— {riskyReason(s)}</span>
                    </li>
                  ))}
                </ul>
                <label className="mt-2 flex cursor-pointer items-start gap-2">
                  <input
                    type="checkbox"
                    data-testid={`campaign-autonomous-ack-${slug}`}
                    checked={ack}
                    onChange={(e) => setAck(e.target.checked)}
                    className="mt-0.5"
                  />
                  <span>I understand — run these unattended anyway.</span>
                </label>
              </div>
            )}

            {error && (
              <div
                data-testid={`campaign-autonomous-error-${slug}`}
                className="rounded-[var(--radius-button,8px)] bg-[#fee2e2] px-3 py-2 text-[12px] text-[#991b1b]"
              >
                {error}
              </div>
            )}
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-[var(--color-border,#e0dbd4)] bg-[var(--color-bg,#f5f0eb)] px-5 py-3">
            <Dialog.Close asChild>
              <button
                type="button"
                data-testid={`campaign-autonomous-cancel-${slug}`}
                className="inline-flex items-center rounded-[var(--radius-button,8px)] border-[1.5px] border-[var(--color-border,#e0dbd4)] bg-[var(--color-muted-bg,#ede8e1)] px-4 py-1.5 text-[13px] font-medium text-[var(--color-text,#1a1a1a)] hover:bg-[var(--color-border,#e0dbd4)]"
              >
                Cancel
              </button>
            </Dialog.Close>
            <button
              type="button"
              onClick={() => void onConfirm()}
              disabled={confirmDisabled}
              data-testid={`campaign-autonomous-confirm-${slug}`}
              className="inline-flex items-center gap-1.5 rounded-[var(--radius-button,8px)] bg-[var(--color-primary,#6b5e56)] px-4 py-1.5 text-[13px] font-semibold text-white hover:bg-[var(--color-primary-hover,#5a4f48)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Bot size={14} />
              {submitting ? "Launching…" : "Launch autonomous"}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
