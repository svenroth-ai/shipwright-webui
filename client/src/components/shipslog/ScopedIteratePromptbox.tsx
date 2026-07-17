/*
 * ScopedIteratePromptbox — "What do you want to change?" → a scoped plan card →
 * one Go (A16, FR-01.60). Deliberately NOT the four-question Intent Wizard:
 * Shipwright already knows the project (Fable B6), so this is the shorter
 * altitude — a brief, a plan preview, and launch.
 *
 * Architecture fences (assert, never relax):
 *   - Rule 1 / DO-NOT #19: the WebUI spawns NOTHING. "Go" is an explicit CTA
 *     click → the server builds the command (core/launcher.ts) → it is handed to
 *     the embedded terminal via the pending-auto-launch sessionStorage key
 *     (writePendingAutoLaunch), byte-identical to the wizard's create→launch.
 *   - DO-NOT #11: the action + its command come from the actions manifest
 *     (`useProjectActions`) — NEVER a hardcoded slash-command or phase string.
 *     `new-iterate` is a stable WebUI action id (used across the codebase); the
 *     slash-command itself lives in the manifest's `command_template`.
 *   - Provenance honesty (AC4): the plan card does NOT invent a plan. There is
 *     no client-side sizing engine, so complexity / FRs / risk / tests all
 *     render "—" — never a plausible guess. Shipwright sizes the change when the
 *     iterate starts.
 */

import { Fragment, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import * as Dialog from "@radix-ui/react-dialog";
import { Play, Sparkles, X } from "lucide-react";

import { useProjectActions } from "../../hooks/useProjectActions";
import { createTask, launchExternalTask } from "../../lib/externalApi";
import { writePendingAutoLaunch } from "../wizard/IntentWizard/useWizardLaunch";
import type { Project } from "../../types";

const DASH = "—";
/** The scoped-plan fields. No client sizing source → every value is "—" (AC4). */
const PLAN_FIELDS = ["Complexity", "Affected FRs", "Risk flags", "Est. tests", "Phases"] as const;

export function ScopedIteratePromptbox({ project }: { project: Project }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: actions } = useProjectActions(project.id);
  const inputRef = useRef<HTMLInputElement>(null);
  const [brief, setBrief] = useState("");
  const [planOpen, setPlanOpen] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Auto-focus the input on load (§5.2).
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const iterateAction = actions?.actions.find((a) => a.id === "new-iterate");

  function openPlan() {
    if (brief.trim().length === 0) return;
    setError(null);
    setPlanOpen(true);
  }

  async function go() {
    const text = brief.trim();
    if (!text || !iterateAction || launching) return;
    setLaunching(true);
    setError(null);
    try {
      const task = await createTask({
        title: text.slice(0, 80),
        cwd: project.path,
        projectId: project.id,
        actionId: iterateAction.id,
        description: text,
      });
      const { commands } = await launchExternalTask(task.taskId, {
        actionId: iterateAction.id,
        description: text,
      });
      writePendingAutoLaunch(task.taskId, commands);
      void qc.invalidateQueries({ queryKey: ["external-tasks"] });
      navigate(`/tasks/${task.taskId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Launch failed");
      setLaunching(false);
    }
  }

  return (
    <>
      <div className="promptbox glass-card" data-testid="shipslog-promptbox">
        <Sparkles className="pb-icon" size={18} aria-hidden="true" />
        <input
          ref={inputRef}
          value={brief}
          data-testid="shipslog-promptbox-input"
          placeholder="What do you want to change? e.g. &lsquo;add rate-limit headers to the media route&rsquo;"
          onChange={(e) => setBrief(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") openPlan();
          }}
        />
        <button
          type="button"
          data-testid="shipslog-promptbox-plan"
          disabled={brief.trim().length === 0}
          onClick={openPlan}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-[999px] px-4 py-2 text-[13px] font-semibold text-white transition hover:brightness-95 disabled:opacity-40"
          style={{ background: "var(--color-primary)" }}
        >
          <Play size={14} /> Plan it
        </button>
      </div>

      <Dialog.Root open={planOpen} onOpenChange={setPlanOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[4px]" />
          <Dialog.Content
            aria-describedby={undefined}
            data-testid="shipslog-plan-card"
            className="fixed top-1/2 left-1/2 z-50 w-[560px] max-w-[92vw] -translate-x-1/2 -translate-y-1/2 rounded-[var(--radius-card)] bg-[var(--color-surface)] p-6 shadow-[var(--shadow-modal)]"
          >
            <div className="flex items-start justify-between">
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-muted)]">
                  New iterate · scoped plan
                </p>
                <Dialog.Title className="mt-1 text-lg font-semibold text-[var(--color-text)]">
                  &ldquo;{brief.trim()}&rdquo;
                </Dialog.Title>
              </div>
              <Dialog.Close asChild>
                <button type="button" aria-label="Close" className="text-[var(--color-muted)] hover:text-[var(--color-text)]">
                  <X size={18} />
                </button>
              </Dialog.Close>
            </div>

            <p className="mt-2 text-[13px] text-[var(--color-muted)]">
              Shipwright sizes this when the iterate starts — it already knows the
              project, so there are no setup questions. It fills in the scope below
              from the run itself.
            </p>

            <dl className="mt-3.5 mb-[18px] grid grid-cols-[max-content_1fr] gap-x-[18px] gap-y-2.5">
              {PLAN_FIELDS.map((f) => (
                <Fragment key={f}>
                  <dt className="text-[12px] font-semibold text-[var(--color-muted)]">{f}</dt>
                  <dd
                    className="m-0 text-[13px] text-[var(--color-text)]"
                    data-testid={`shipslog-plan-${f.toLowerCase().replace(/[^a-z]+/g, "-")}`}
                  >
                    {DASH}
                  </dd>
                </Fragment>
              ))}
            </dl>

            {!iterateAction && (
              <p className="mb-3 text-[12.5px] text-[var(--color-error)]" data-testid="shipslog-plan-noaction">
                This project has no iterate action configured, so it can&rsquo;t be launched from here.
              </p>
            )}
            {error && (
              <p className="mb-3 text-[12.5px] text-[var(--color-error)]" data-testid="shipslog-plan-error">
                {error}
              </p>
            )}

            <div className="flex items-center gap-3">
              <button
                type="button"
                data-testid="shipslog-plan-go"
                disabled={!iterateAction || launching}
                onClick={go}
                className="inline-flex items-center gap-1.5 rounded-[var(--radius-button)] px-4 py-2 text-[13px] font-semibold text-white transition hover:brightness-95 disabled:opacity-40"
                style={{ background: "var(--color-primary)" }}
              >
                <Play size={15} /> {launching ? "Starting…" : "Go — start the iterate"}
              </button>
              <Dialog.Close asChild>
                <button
                  type="button"
                  data-testid="shipslog-plan-cancel"
                  className="rounded-[var(--radius-button)] border border-[var(--color-border)] px-4 py-2 text-[13px] font-semibold text-[var(--color-text)] hover:bg-[var(--color-muted-bg)]"
                >
                  Cancel
                </button>
              </Dialog.Close>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
