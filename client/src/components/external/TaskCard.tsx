/*
 * Single TaskBoard card.
 *
 * Phase B1 rebuild (iterate 3.7b — 2026-04-20) against
 * `webui/designs/screens/kanban-with-projects.html` lines 546–730.
 *
 * Shape:
 *   ┌─────────────────────────────────────────────┐
 *   │ Title                       │ ▸ kind-stripe │   ← pipeline/iterate only
 *   │ 🏷 build-tag   15/15 ✓                      │
 *   │ abc1234 (mono)                      5h ago  │
 *   └─────────────────────────────────────────────┘
 *
 * Per-column card variants:
 *   - Draft  → Launch button only (can't resume a never-launched task).
 *   - In-progress → Launch + Resume always-visible (brown solid).
 *   - Done → neither launch nor resume (done-check indicator only).
 *
 * Sizing locks (explicit, not token) per B1 spec:
 *   padding:       12px 14px
 *   border-radius: 10px
 *
 * `testCounts` and `phase` fields don't exist on ExternalTask yet
 * (ADR-045 — deferred). Rendering is gracefully skipped when absent.
 *
 * Iterate 3 remediation v2 — Surface 1 (2026-04-21):
 *   - Whole-card click target now navigates to TaskDetail. The title text
 *     is no longer its own <button>; title editing lives in the Rename menu
 *     item (ADR-035). Keyboard support via Enter / Space on the role=button
 *     wrapper + inner controls (menu, launch pill, start pill) suppress
 *     their click propagation so they don't double-fire the navigate.
 *
 * Iterate 3.7d-b1 (2026-04-22):
 *   - Hover-gated launch chip replaced with always-visible brown solid
 *     `solid` variant buttons (Launch + Resume). Sven UAT: hover-to-reveal
 *     hides the primary action; make it always visible.
 *   - Footer reflow: timestamp LEFT, action buttons RIGHT. Action buttons
 *     wrap below the timestamp when the card is too narrow (flex-wrap).
 *   - `…` menu now always visible (was hover-gated) — matches the new
 *     "everything the user needs is visible" intent.
 *   - Commit marker moved inline with the timestamp on the left.
 *
 * Iterate 3.7e-b1 (2026-04-22):
 *   - Action buttons now use the Foundation `size="xs"` variant (12 px
 *     text, 500 weight, 4×10 px padding, icon 14 px) — finer TaskCard
 *     buttons per plan R3.
 *   - Backlog cards (draft / awaiting_external_start) render a GREEN
 *     `<TerminalLaunchButton color="green">` Launch button — the only
 *     primary action on that column. No Resume on backlog cards (nothing
 *     to resume yet).
 *   - In Progress cards (active / idle) now render ONLY Resume (brown).
 *     The Launch-twin that was visible in 3.7d-b1 is removed: once a task
 *     has been launched, the intent is to continue, not fresh-restart.
 *   - Done cards keep no primary action.
 *   - 3 px project-color left-edge strip sourced from
 *     `getProjectColor(task.projectId, project?.settings?.color)` — gives
 *     multi-project boards a visual anchor per plan S1.6. Synthesized
 *     "Unassigned" projects still render a strip (hash-derived muted
 *     color) so the layout stays consistent.
 *
 * Preserved testids:
 *   task-card-<id>, task-card-open-<id>, task-card-state-<id>,
 *   task-card-time-<id>, task-card-menu-<id>, task-card-close-<id>,
 *   task-card-delete-<id>.
 * New testids (iterate 3.7d-b1):
 *   task-card-actions-<id>, task-card-launch-<id>, task-card-resume-<id>,
 *   terminal-launch-solid-launch, terminal-launch-solid-resume
 *   (the last two are the TerminalLaunchButton's own testids in `solid`
 *   variant — not card-scoped but stable per button instance).
 * Iterate 3.7e-b1:
 *   task-card-project-strip-<id>.
 */

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  CheckCircle2,
  Circle,
  Loader,
  MoreHorizontal,
  PauseCircle,
  Zap,
} from "lucide-react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";

import type { ExternalTask, ExternalTaskState } from "../../lib/externalApi";
import {
  useCloseExternalTask,
  useDeleteExternalTask,
  useMoveTaskToBacklog,
} from "../../hooks/useExternalTasks";
import { useProjects } from "../../hooks/useProjects";
import { getProjectColor, type ProjectColor } from "../../lib/projectColor";
import { getPhaseStyle, resolveTaskPhase } from "../../lib/phaseStyle";
import { isInProgressState, hasLaunchedBefore } from "../../lib/taskLifecycle";
import { TerminalLaunchButton } from "./TerminalLaunchButton";
import { ConfirmDeleteDialog } from "./ConfirmDeleteDialog";
import { EditTaskModal } from "./EditTaskModal";

const NONTERMINAL_STATES: ExternalTaskState[] = ["active", "idle", "awaiting_external_start"];

interface Props {
  task: ExternalTask;
}

export function TaskCard({ task }: Props) {
  const navigate = useNavigate();
  const closeMut = useCloseExternalTask();
  const deleteMut = useDeleteExternalTask();
  const backlogMut = useMoveTaskToBacklog();
  const { data: projects = [] } = useProjects();
  const [confirmDelete, setConfirmDelete] = useState(false);
  // iterate-2026-05-18-edit-task-dialog — the Edit Task dialog is opened
  // from the ⋯ menu via state (NOT nested in the Radix DropdownMenu —
  // that traps focus and unmounts the dialog when the menu closes).
  const [editOpen, setEditOpen] = useState(false);

  const Icon = stateIcon(task.state);
  const stamp = lastActivity(task);
  const cwdBase = basename(task.cwd);
  // Iterate 3.7e-b1 (plan S1.2): Backlog cards are draft OR
  // awaiting_external_start — both live in the "column-draft" bucket
  // visually. Launch is the only primary action for that set; Resume
  // only makes sense once a task has actually been launched.
  // iterate 3.7f (Sven UAT 2026-04-22): only `draft` gets the green Launch
  // button. `awaiting_external_start` + `active` previously got a brown
  // Terminal button — REMOVED in v0.8.6 AC-4. The card body itself is
  // the click target for opening the task detail page (which lands on
  // the Terminal tab when that's the persisted preference); a
  // dedicated Terminal CTA was redundant with that click affordance.
  // `idle` keeps the brown Resume button (Claude process ended;
  // explicit resume needed).
  const isBacklog = task.state === "draft";
  const isDone = task.state === "done";
  // iterate-2026-05-17-move-to-backlog: a `draft` task that has already
  // run (JSONL observed) must show Resume, not a fresh Launch — a fresh
  // `claude --session-id` against an already-used session is rejected
  // with "Session ID already in use" (FR-01.01 AC-6). `isInProgressState`
  // gates the "Move to Backlog" menu item (FR-01.32).
  const launchedBefore = hasLaunchedBefore(task);
  const canMoveToBacklog = isInProgressState(task.state);

  // Iterate 3.7e-b1 (plan S1.6): deterministic color derived from
  // project.settings.color (if set) or hashed projectId (fallback).
  const project = projects.find((p) => p.id === task.projectId);
  const projectColor = getProjectColor(
    task.projectId,
    project?.settings?.color,
  );
  // ADR-105: human-readable project label for the meta-row pill. Falls
  // back to the raw projectId while the projects query is still in flight
  // (or for an orphan task whose project row no longer exists).
  const projectName = project?.name ?? task.projectId;

  const onDeleteClick = () => {
    if (NONTERMINAL_STATES.includes(task.state)) {
      setConfirmDelete(true);
    } else {
      deleteMut.mutate(task.taskId);
    }
  };

  // Commit hash — lifted off the sessionUuid for now (no per-task commit
  // field in the server model). Showing the first 7 chars of the session
  // UUID gives a stable mono-font marker that looks like a commit hash
  // per mockup without inventing new data.
  const commitMarker = task.sessionUuid.slice(0, 7);

  const navigateToDetail = () => navigate(`/tasks/${task.taskId}`);

  return (
    <>
      <div
        role="button"
        tabIndex={0}
        onClick={navigateToDetail}
        onKeyDown={(ev) => {
          if (ev.key === "Enter" || ev.key === " ") {
            ev.preventDefault();
            navigateToDetail();
          }
        }}
        className={
          "group relative shrink-0 cursor-pointer overflow-hidden bg-[var(--color-surface)] " +
          // iterate 3.7g (Sven UAT): "Cards ein bisschen weiter auseinander
          // horizontal" — bump horizontal padding 17/14 → 20/18 (+3/+4) for
          // more breathing room; vertical stays 12.
          "pl-[20px] pr-[18px] py-[12px] transition " +
          "shadow-[0_1px_3px_rgba(0,0,0,0.06)] " +
          "hover:-translate-y-[1px] hover:shadow-[0_4px_16px_rgba(0,0,0,0.12)] " +
          "focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
        }
        style={{ borderRadius: "10px" }}
        data-testid={`task-card-${task.taskId}`}
        data-task-state={task.state}
        data-project-id={task.projectId}
        title={`UUID ${task.sessionUuid.slice(0, 8)} · cwd ${cwdBase}`}
      >
        {/* Project-color left-edge strip (iterate 3.7e-b1 / plan S1.6).
            3 px wide, full card height, deterministic color from
            `getProjectColor(projectId, project.settings.color)`. Absolute-
            positioned inside the `overflow-hidden` card so it hugs the
            rounded corners without clipping the content padding. */}
        <span
          aria-hidden="true"
          data-testid={`task-card-project-strip-${task.taskId}`}
          data-project-color={projectColor.hsl}
          className="pointer-events-none absolute left-0 top-0 h-full w-[3px]"
          style={{ background: projectColor.hslStripe }}
        />

        {/* Kind stripe (4×18px top-right) — no `kind` field on the model
            yet, so this renders only when a future field appears. Left
            intentionally absent for now to avoid inventing data. */}

        {/* Top row: title + menu.
            The title keeps a testid (`task-card-open-*`) for existing
            specs, but is no longer a click-target — the whole card
            navigates to TaskDetail (iterate 3.7c-1). */}
        <div className="mb-2 flex items-start gap-2">
          <div
            className="min-w-0 flex-1"
            data-testid={`task-card-open-${task.taskId}`}
          >
            <div
              className={
                "flex items-center gap-1.5 text-[14px] font-medium leading-[1.4] " +
                (isDone
                  ? "text-[var(--color-muted)]"
                  : "text-[var(--color-text)]")
              }
            >
              <Icon className={iconClass(task.state)} size={14} />
              <span className="line-clamp-2">{task.title}</span>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-0.5">
            <DropdownMenu.Root>
              <DropdownMenu.Trigger asChild>
                <button
                  type="button"
                  onClick={(ev) => ev.stopPropagation()}
                  className="rounded p-1 text-[var(--color-muted)] transition-colors hover:bg-[var(--color-muted-bg)] hover:text-[var(--color-text)]"
                  aria-label="Task actions"
                  data-testid={`task-card-menu-${task.taskId}`}
                >
                  <MoreHorizontal size={14} />
                </button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content
                  align="end"
                  sideOffset={4}
                  className="z-50 min-w-[160px] rounded-[var(--radius-button)] border border-[var(--color-border)] bg-[var(--color-surface)] p-1 text-sm shadow-[var(--shadow-card)]"
                >
                  {/* iterate-2026-05-18-edit-task-dialog — re-edit a
                      task's fields. Available in every state; the dialog
                      itself greys out the launch-shaping fields once the
                      task has started. */}
                  <DropdownMenu.Item
                    onClick={(ev) => ev.stopPropagation()}
                    onSelect={() => setEditOpen(true)}
                    className="cursor-pointer rounded px-2 py-1 text-[var(--color-text)] outline-none data-[highlighted]:bg-[var(--color-muted-bg)]"
                    data-testid={`task-card-edit-${task.taskId}`}
                  >
                    Edit task
                  </DropdownMenu.Item>
                  {/* iterate-2026-05-17-move-to-backlog (FR-01.32):
                      move an In-Progress task back to the Backlog column.
                      Shown only for the five In-Progress states — absent
                      for `draft` (already there) and `done` (terminal).
                      No confirm dialog: non-destructive + reversible. */}
                  {canMoveToBacklog && (
                    <DropdownMenu.Item
                      onClick={(ev) => ev.stopPropagation()}
                      onSelect={() => backlogMut.mutate(task.taskId)}
                      className="cursor-pointer rounded px-2 py-1 text-[var(--color-text)] outline-none data-[highlighted]:bg-[var(--color-muted-bg)]"
                      data-testid={`task-card-backlog-${task.taskId}`}
                    >
                      Move to Backlog
                    </DropdownMenu.Item>
                  )}
                  <DropdownMenu.Item
                    onClick={(ev) => ev.stopPropagation()}
                    onSelect={() => closeMut.mutate(task.taskId)}
                    disabled={task.state === "done"}
                    className="cursor-pointer rounded px-2 py-1 text-[var(--color-text)] outline-none data-[highlighted]:bg-[var(--color-muted-bg)] data-[disabled]:cursor-not-allowed data-[disabled]:opacity-40"
                    data-testid={`task-card-close-${task.taskId}`}
                  >
                    Close (mark done)
                  </DropdownMenu.Item>
                  <DropdownMenu.Item
                    onClick={(ev) => ev.stopPropagation()}
                    onSelect={onDeleteClick}
                    className="cursor-pointer rounded px-2 py-1 text-[var(--color-error)] outline-none data-[highlighted]:bg-[var(--color-error-bg)]"
                    data-testid={`task-card-delete-${task.taskId}`}
                  >
                    Delete (remove from board)
                  </DropdownMenu.Item>
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
          </div>
        </div>

        {/* Meta row — state pill + phase badge.
            ADR-056 chat-livetest-2 AC-B: prefer server-persisted task.phase
            when both phase + phaseLabel are present.
            v0.3.1 (2026-04-25): legacy tasks (launched before the phase-
            on-create wiring) fall back to title-keyword derivation, same
            heuristic TaskDetailHeader uses, so the kanban card stays in
            sync with TaskDetail. */}
        <div
          className="flex flex-wrap items-center gap-1.5"
          data-testid={`task-card-meta-${task.taskId}`}
        >
          {/* Project pill (ADR-105) — leftmost element, left of the
              StatePill. The faint 3 px left-edge strip washed out on a
              multi-project board; this names the project explicitly and
              anchors it with a solid accent-color dot. */}
          <ProjectPill
            taskId={task.taskId}
            projectId={task.projectId}
            name={projectName}
            color={projectColor}
          />
          <StatePill state={task.state} />
          {(() => {
            // Policy shared with TaskDetailHeader via resolveTaskPhase.
            const resolved = resolveTaskPhase(task);
            if (!resolved) return null;
            const style = getPhaseStyle(resolved.id);
            const phaseSource = task.phase && task.phaseLabel
              ? "task"
              : task.actionId === "new-iterate"
                ? "action-default"
                : "title-fallback";
            return (
              <span
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium ${style.cls}`}
                data-testid={`task-card-phase-${task.taskId}`}
                data-phase={resolved.id}
                data-phase-source={phaseSource}
                title={`Phase: ${resolved.label}`}
              >
                <span
                  className={`inline-block h-1.5 w-1.5 rounded-full ${style.dot}`}
                  aria-hidden="true"
                />
                {resolved.label}
              </span>
            );
          })()}
        </div>

        {/* Footer: timestamp + commit marker LEFT, action buttons RIGHT.
            Layout uses flex-wrap so on narrow cards the action buttons
            stack below the timestamp instead of overflowing. Each action
            button stops click propagation so it copies the command instead
            of navigating to TaskDetail (iterate 3.7d-b1). */}
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-[var(--color-muted)]">
          <div className="flex items-center gap-2 min-w-0">
            {stamp && (
              <span
                title={stamp.full}
                data-testid={`task-card-time-${task.taskId}`}
                className="whitespace-nowrap"
              >
                {stamp.short}
              </span>
            )}
            {!isBacklog && (
              <span
                className="font-mono text-[11px] opacity-75"
                data-testid={`task-card-commit-${task.taskId}`}
              >
                {commitMarker}
              </span>
            )}
          </div>
          {!isDone && (
            <div
              className="ml-auto flex shrink-0 flex-wrap items-center justify-end gap-2"
              data-testid={`task-card-actions-${task.taskId}`}
            >
              {/* Iterate 3.7e-b1 action matrix:
                    Backlog (draft / awaiting_external_start)
                      → GREEN Launch only (no Resume — nothing to resume).
                    In Progress (active / idle)
                      → BROWN Resume only (Launch removed — once launched,
                        the intent is to continue).
                    Done → no action (handled by outer `!isDone`). */}
              {/* iterate-2026-05-17-move-to-backlog (FR-01.01 AC-6):
                  green fresh-Launch only for a never-launched draft. A
                  draft moved back to Backlog after running falls through
                  to the orange Resume below. */}
              {isBacklog && !launchedBefore && (
                <span data-testid={`task-card-launch-${task.taskId}`}>
                  <TerminalLaunchButton
                    task={task}
                    variant="solid"
                    color="green"
                    size="xs"
                    resume={false}
                  />
                </span>
              )}
              {/* Iterate v0.8.6 AC-4 — no brown "Terminal" CTA on
                  `awaiting_external_start` / `active`; the card body
                  click opens the task detail page.

                  resume-cta-rework (2026-05-16) — Resume shows for every
                  `(idle | active)` task, unconditionally. The former
                  activity gate (`isClaudeRecentlyActive`) is removed:
                  webui cannot observe Claude process-liveness, and
                  clicking Resume on a live session is harmless (`claude
                  --resume` errors "Session ID already in use"). Single
                  "Resume" label (memory feedback_resume_label_singular). */}
              {/* iterate-2026-05-17-move-to-backlog (FR-01.01 AC-6):
                  also covers a backlogged-but-already-run draft — it must
                  Resume the existing session, not fresh-Launch. */}
              {((isBacklog && launchedBefore) ||
                task.state === "idle" ||
                task.state === "active") && (
                <span data-testid={`task-card-resume-${task.taskId}`}>
                  <TerminalLaunchButton
                    task={task}
                    variant="solid"
                    color="orange"
                    size="xs"
                    resume={true}
                  />
                </span>
              )}
            </div>
          )}
        </div>

        {/* State dataset — kept for testid parity with section-02 tests. */}
        <span
          className="sr-only"
          data-testid={`task-card-state-${task.taskId}`}
        >
          {task.state}
        </span>
      </div>

      <ConfirmDeleteDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        task={task}
        onConfirm={() => {
          deleteMut.mutate(task.taskId);
          setConfirmDelete(false);
        }}
      />

      <EditTaskModal open={editOpen} onOpenChange={setEditOpen} task={task} />
    </>
  );
}

/** Iterate-2026-05-15 (ADR-105) — project identity chip for the card meta
 *  row. Leftmost element, left of the StatePill. A solid dot + the project
 *  name, with the pill tinted + bordered in the project's accent color so
 *  a multi-project board is scannable at a glance. `color.hsl` is either
 *  the custom `settings.color` or a deterministic hash-derived hue, so the
 *  pill, dot, and the 3 px left-edge strip all agree. `color-mix` keeps the
 *  tint/border derivation format-agnostic (custom hex OR `hsl(...)`).
 *  Read-only — clicks fall through to the card's navigate-to-detail
 *  handler, no stopPropagation. */
function ProjectPill({
  taskId,
  projectId,
  name,
  color,
}: {
  taskId: string;
  projectId: string;
  name: string;
  color: ProjectColor;
}) {
  return (
    <span
      data-testid={`task-card-project-${taskId}`}
      data-project-id={projectId}
      data-project-color={color.hsl}
      title={`Project: ${name}`}
      className="inline-flex max-w-[150px] items-center gap-1.5 rounded-[10px] border px-2 py-[2px] text-[11px] font-semibold text-[var(--color-text)]"
      style={{
        background: `color-mix(in srgb, ${color.hsl} 14%, var(--color-surface))`,
        borderColor: `color-mix(in srgb, ${color.hsl} 42%, transparent)`,
      }}
    >
      <span
        aria-hidden="true"
        className="h-2 w-2 shrink-0 rounded-full"
        style={{ background: color.hsl }}
      />
      <span className="truncate">{name}</span>
    </span>
  );
}

/** Small muted pill showing the ExternalTaskState verbatim. Cheap stand-in
 *  for the mockup's richer `.tag-*` palette until ADR-045's phase + status
 *  projection lands in Phase C. */
function StatePill({ state }: { state: ExternalTaskState }) {
  const tone = statePillTone(state);
  return (
    <span
      className="inline-flex items-center gap-1 rounded-[10px] px-2 py-[2px] text-[11px] font-semibold"
      style={{ background: tone.bg, color: tone.fg }}
    >
      {state}
    </span>
  );
}

function statePillTone(state: ExternalTaskState): { bg: string; fg: string } {
  switch (state) {
    case "active":
      return { bg: "var(--color-warning-bg)", fg: "var(--color-warning-text)" };
    case "awaiting_external_start":
      return { bg: "var(--color-warning-bg)", fg: "var(--color-warning-text)" };
    case "idle":
      return { bg: "var(--color-muted-bg)", fg: "var(--color-muted)" };
    case "jsonl_missing":
    case "launch_failed":
      return { bg: "var(--color-error-bg)", fg: "var(--color-error)" };
    case "done":
      return { bg: "var(--color-info-bg)", fg: "#2563eb" };
    case "draft":
    default:
      return { bg: "var(--color-muted-bg)", fg: "var(--color-muted)" };
  }
}

function stateIcon(state: ExternalTaskState) {
  switch (state) {
    case "draft":
      return Circle;
    case "awaiting_external_start":
      return Loader;
    case "active":
      return Zap;
    case "idle":
      return PauseCircle;
    case "jsonl_missing":
    case "launch_failed":
      return AlertTriangle;
    case "done":
      return CheckCircle2;
  }
}

function iconClass(state: ExternalTaskState): string {
  switch (state) {
    case "active":
      return "text-[var(--color-success)]";
    case "idle":
      return "text-[var(--color-muted)]";
    case "awaiting_external_start":
      return "text-[var(--color-warning)]";
    case "jsonl_missing":
    case "launch_failed":
      return "text-[var(--color-error)]";
    case "done":
      return "text-[var(--color-success)]";
    case "draft":
    default:
      return "text-[var(--color-muted)]";
  }
}

function lastActivity(task: ExternalTask): { short: string; full: string } | null {
  // Prefer JSONL mtime; fall back to launchedAt; fall back to createdAt.
  const ms = task.lastJsonlSeenMtimeMs ?? toMs(task.launchedAt) ?? toMs(task.createdAt);
  if (!ms) return null;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return null;
  const ago = relative(Date.now() - ms);
  return { short: ago, full: `${ago} (${d.toISOString()})` };
}

function toMs(iso: string | undefined): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : null;
}

function relative(deltaMs: number): string {
  if (deltaMs < 60_000) return "just now";
  if (deltaMs < 3_600_000) return `${Math.floor(deltaMs / 60_000)}m ago`;
  if (deltaMs < 86_400_000) return `${Math.floor(deltaMs / 3_600_000)}h ago`;
  return `${Math.floor(deltaMs / 86_400_000)}d ago`;
}

function basename(p: string): string {
  if (!p) return "";
  const norm = p.replace(/\\/g, "/");
  const parts = norm.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? p;
}
