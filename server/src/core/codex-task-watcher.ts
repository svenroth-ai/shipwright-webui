/*
 * core/codex-task-watcher.ts — Codex Light §5.1 `CodexTaskWatcher`: the
 * plain module (no new process) that ties the completion oracle (§1) to
 * the live pty (§4) into the actual runtime behavior AC5/AC6 need.
 *
 * On every `tick()`, for each live Codex-runtime task whose pty has been
 * silent ≥ `stallTimeoutMs` (Settings-configurable, default 15 min, floor
 * 5 min — §5's Settings field), calls the oracle CLI (`codex-oracle-
 * runner.ts`) and classifies per the spec's table:
 *
 *   not_done + silent      → auto-nudge, capped at one attempt per stall
 *                            EPISODE (a fresh `lastDataAt` starts a new one)
 *   delivery_pending, delivery_state absent/"indeterminate" → case 13
 *                            proper; keep re-polling every tick, never nudge
 *   delivery_pending, delivery_state === "error" → surface distinctly to
 *                            Inbox, never re-poll as "still pending" forever
 *                            (§5.1's correction — do NOT branch on the
 *                            verdict string alone)
 *   done                   → label done; the pty is left running (§4 —
 *                            marking done never kills the process)
 *   no_oracle               → one self-check nudge per episode, then
 *                            Inbox-only once that nudge is spent (§5.4's
 *                            self-report can still resolve it — see below)
 *
 * `snapshot()` exposes the resulting notices for the Inbox aggregator
 * (`external/inbox/_codex.ts`) — an ephemeral, in-memory side-channel, not
 * persisted to `sdk-sessions.json`; a server restart just re-derives it.
 *
 * Each `checkTask()` pass also attempts §4's `threadId` discovery
 * (`core/codex-thread-discovery.ts`) for any Codex task that doesn't have
 * one yet — a fresh launch never learns its own thread id from the launch
 * command (v1 has no `--session-id`-equivalent flag), so without this the
 * resume branch in `runtime-chokepoint.ts` could never fire. `tick()`'s
 * reentrancy guard (below) also protects this from a cross-tick race.
 *
 * §5.3 Guided-mode approval/structured-error TEXT detection does NOT live
 * here — it runs as an Inbox post-pass (`external/inbox/_codex.ts`'s
 * `appendCodexTerminalSignals`, over `core/codex-terminal-signal-detect.ts`).
 *
 * §5.4's structured self-report (`codex-status-report.ts`) is consulted
 * only in the `no_oracle` branch of `classify()` below — see that branch's
 * own comment for why.
 */

import type { ExternalTask } from "./sdk-sessions-store.js";
import type { OracleEvidence, OracleVerdict } from "./codex-oracle-runner.js";
import { parseShipwrightStatusReport } from "./codex-status-report.js";
import {
  DEFAULT_STALL_TIMEOUT_MS,
  DEFAULT_LAUNCH_CONFIRM_TIMEOUT_MS,
  type CodexWatcherNoticeKind,
  type CodexWatcherNotice,
  type CodexTaskWatcherDeps,
  type EpisodeState,
} from "./codex-task-watcher-types.js";

// Types/interfaces/constants live in `codex-task-watcher-types.ts` (split to
// stay under the 300-line guideline); re-exported here so every existing
// import site (`from "./codex-task-watcher.js"`) is unaffected.
export {
  DEFAULT_STALL_TIMEOUT_MS,
  DEFAULT_LAUNCH_CONFIRM_TIMEOUT_MS,
  type CodexWatcherNoticeKind,
  type CodexWatcherNotice,
  type CodexTaskWatcherStore,
  type CodexTaskWatcherPtyManager,
  type CodexTaskWatcherDeps,
} from "./codex-task-watcher-types.js";

const WAKER_PROMPT =
  "\n[Shipwright] Still there? If you're finished, wrap up and close with your " +
  "SHIPWRIGHT-STATUS block. If not, please continue.\n";
const SELF_CHECK_PROMPT =
  "\n[Shipwright] This phase has no automated completion check — please confirm " +
  "your status directly: are you done, or still working? Close with your " +
  "SHIPWRIGHT-STATUS block either way.\n";

export class CodexTaskWatcher {
  private readonly episodes = new Map<string, EpisodeState>();
  private readonly notices = new Map<string, CodexWatcherNotice>();
  private readonly nowFn: () => number;
  private readonly stallTimeoutMs: number | (() => number | Promise<number>);
  private readonly launchConfirmTimeoutMs: number | (() => number | Promise<number>);
  /** Reentrancy guard (doubt-review finding) — `index.ts`'s `setInterval`
   *  never awaits the prior tick, and one tick can outlive 60s with a
   *  handful of stalled tasks (N sequential up-to-30s oracle calls). Two
   *  OVERLAPPING ticks would each build their own `claimedThreadIds` from
   *  `store.list()` and miss the other's in-flight §4 discovery, risking
   *  two tasks in the same cwd permanently claiming the same threadId (no
   *  re-validation once set). Skipping an overlapping tick is always safe
   *  — the next one 60s later just re-evaluates the same tasks. */
  private ticking = false;

  constructor(private readonly deps: CodexTaskWatcherDeps) {
    this.nowFn = deps.now ?? Date.now;
    this.stallTimeoutMs = deps.stallTimeoutMs ?? DEFAULT_STALL_TIMEOUT_MS;
    this.launchConfirmTimeoutMs = deps.launchConfirmTimeoutMs ?? DEFAULT_LAUNCH_CONFIRM_TIMEOUT_MS;
  }

  private async resolveStallTimeoutMs(): Promise<number> {
    return typeof this.stallTimeoutMs === "function" ? await this.stallTimeoutMs() : this.stallTimeoutMs;
  }

  private async resolveLaunchConfirmTimeoutMs(): Promise<number> {
    return typeof this.launchConfirmTimeoutMs === "function"
      ? await this.launchConfirmTimeoutMs()
      : this.launchConfirmTimeoutMs;
  }

  /** Ephemeral, in-memory Inbox feed — see the module header. */
  snapshot(): CodexWatcherNotice[] {
    return [...this.notices.values()];
  }

  async tick(): Promise<void> {
    if (this.ticking) return; // reentrancy guard — see the field doc above
    this.ticking = true;
    try {
      const allTasks = this.deps.store.list();
      // §4 discovery de-dup — a rollout file already claimed by one task (in
      // the store, or by an earlier task this same tick) is never handed to
      // a second one, guarding the rare case of two Codex tasks launched in
      // the same cwd within the same discovery window. The `ticking` guard
      // above is what makes "this same tick" the only case that can ever
      // happen — see its doc for why a cross-tick race would otherwise slip
      // past this Set entirely.
      const claimedThreadIds = new Set(
        allTasks.map((t) => t.threadId).filter((id): id is string => Boolean(id)),
      );
      const tasks = allTasks.filter(
        (t) =>
          t.runtime === "codex" &&
          (t.state === "active" || t.state === "awaiting_external_start"),
      );
      // Resolved ONCE per tick, not per task — the production getter
      // re-reads settings.json on every call, so per-task was an N+1 read
      // (code-review finding). A live edit still lands next tick either way.
      const stallTimeoutMs = await this.resolveStallTimeoutMs();
      const launchConfirmTimeoutMs = await this.resolveLaunchConfirmTimeoutMs();
      for (const task of tasks) {
        await this.checkTask(task, claimedThreadIds, stallTimeoutMs, launchConfirmTimeoutMs);
      }
    } finally {
      this.ticking = false;
    }
  }

  private async checkTask(
    task: ExternalTask,
    claimedThreadIds: Set<string>,
    stallTimeoutMs: number,
    launchConfirmTimeoutMs: number,
  ): Promise<void> {
    const lastDataAt = this.deps.ptyManager.getLastDataAt(task.taskId);
    if (lastDataAt === null) {
      // pty gone (PR #466 preflight finding) — any notice describes a
      // state that no longer exists; don't leave it in the Inbox forever.
      this.episodes.delete(task.taskId);
      this.notices.delete(task.taskId);
      return;
    }

    if (!task.threadId && this.deps.discoverThreadId && task.launchedAt) {
      const threadId = await this.deps.discoverThreadId({
        cwd: task.cwd,
        sinceIso: task.launchedAt,
        excludeThreadIds: claimedThreadIds,
      });
      if (threadId) {
        claimedThreadIds.add(threadId);
        this.deps.store.patch(task.taskId, { threadId });
        await this.deps.store.persist();
        task = { ...task, threadId };
      }
    }

    const now = this.nowFn();
    const silenceMs = now - lastDataAt;

    // §5.2 — launch-confirmation timeout: distinct, shorter window, only
    // while still awaiting the handshake and nothing has ever streamed.
    // Disposition (external-code-review, OpenAI MEDIUM, accepted not fixed):
    // `lastDataAt` is PtyManager's generic "any bytes" idle timer (ADR-068-A1)
    // — a shell-prompt echo counts the same as a real Codex frame. Accepted:
    // AC8's CLI check closes the common case; `codex-terminal-signal-detect.ts`
    // already accepts the same fragile-TUI-matching gap elsewhere.
    if (task.state === "awaiting_external_start") {
      if (silenceMs >= launchConfirmTimeoutMs) {
        this.setNotice(task.taskId, "launch_confirmation_failed",
          "Codex never produced output after launch — the terminal may not have started correctly.");
      }
      return;
    }
    // Doubt-review finding: reaching here means state left
    // awaiting_external_start, so a stale launch_confirmation_failed
    // banner must not keep sitting in the Inbox for a healthy run.
    if (this.notices.get(task.taskId)?.kind === "launch_confirmation_failed") {
      this.notices.delete(task.taskId);
    }

    const prev = this.episodes.get(task.taskId);
    if (!prev || prev.lastSeenDataAt !== lastDataAt) {
      this.episodes.set(task.taskId, { lastSeenDataAt: lastDataAt, nudged: false });
      // A fresh episode's nudge notice is stale — mirrors the two clears above.
      if (this.notices.get(task.taskId)?.kind === "nudge_sent") {
        this.notices.delete(task.taskId);
      }
    }
    if (silenceMs < stallTimeoutMs) return;

    const project = this.deps.getProjectById(task.projectId);
    if (!project) return;
    const outcome = await this.deps.runOracle({
      projectRoot: project.path,
      phase: task.phase ?? "",
      session: task.sessionUuid,
      since: task.launchedAt,
    });
    if (outcome.kind !== "ok") return; // engine-unavailable/failed — try again next tick
    await this.classify(task, outcome.result.verdict, outcome.result.evidence);
  }

  private async classify(
    task: ExternalTask,
    verdict: OracleVerdict,
    evidence: OracleEvidence,
  ): Promise<void> {
    const episode = this.episodes.get(task.taskId);

    // External-code-review (GLM MEDIUM): a delivery_error notice, once
    // set, was never cleared unless the task reached "done" — mirrors the
    // launch_confirmation_failed clearing fix in checkTask() above.
    const isDeliveryError = verdict === "delivery_pending" && evidence.delivery_state === "error";
    if (!isDeliveryError && this.notices.get(task.taskId)?.kind === "delivery_error") {
      this.notices.delete(task.taskId);
    }

    if (verdict === "done") {
      await this.markDone(task.taskId);
      return;
    }
    if (verdict === "delivery_pending") {
      if (evidence.delivery_state === "error") {
        this.setNotice(task.taskId, "delivery_error",
          "Codex's PR delivery failed (CI failed or the PR was closed) — needs your attention.");
      }
      // absent / "indeterminate" — case 13 proper: keep re-polling, never nudge.
      //
      // Disposition (external-code-review, GLM MEDIUM, accepted not
      // fixed): re-polls the oracle every 60s tick while stalled+pending
      // — §1.6/§5.1's "low-frequency" language could read as wanting a
      // slower interval. Accepted: spec's "Open items" #4 names this
      // interval a build-time call, and 60s matches the watcher's one
      // existing tick rather than a second timer for an unspecified value.
      return;
    }
    if (!episode || episode.nudged) {
      if (verdict === "no_oracle") {
        // §5.4 (external-code-review, OpenAI MEDIUM): the self-report's
        // one behavior-changing use — no_oracle has no other completion
        // signal, so a well-formed done:true report still on-screen after
        // the spent nudge counts as real completion. Every OTHER verdict
        // still defers to the oracle on disagreement, per §5.4.
        const selfReport = parseShipwrightStatusReport(this.deps.peekTerminalText?.(task.taskId) ?? "");
        if (selfReport?.done) {
          await this.markDone(task.taskId);
          return;
        }
        this.setNotice(task.taskId, "no_oracle_unresolved",
          "This phase has no automated completion check and the self-check nudge didn't resolve it.");
      }
      return;
    }
    // not_done or no_oracle — one nudge per episode. A watched task
    // (attachCount !== 0) gets neither, by design (doubt-review, low):
    // someone already has the terminal open.
    if (this.deps.ptyManager.attachCount(task.taskId) !== 0) return;
    this.deps.ptyManager.write(task.taskId, verdict === "no_oracle" ? SELF_CHECK_PROMPT : WAKER_PROMPT);
    episode.nudged = true;
    this.setNotice(task.taskId, "nudge_sent",
      verdict === "no_oracle"
        ? "Sent a self-check nudge — no automated completion check exists for this phase."
        : "Sent a nudge — the completion oracle reports this run isn't done yet.");
  }

  private setNotice(taskId: string, kind: CodexWatcherNoticeKind, detail: string): void {
    this.notices.set(taskId, { taskId, kind, detail, at: this.nowFn() });
  }

  // Shared by an oracle "done" verdict and a §5.4 self-report completion.
  // boardColumn synced alongside state (doubt-review finding) — mirrors
  // POST /tasks/:id/close's AC-6 fix; otherwise a task dragged to a
  // non-Done column stays stranded/locked once auto-completed.
  private async markDone(taskId: string): Promise<void> {
    this.episodes.delete(taskId);
    this.notices.delete(taskId);
    this.deps.store.patch(taskId, { state: "done", boardColumn: "done" });
    await this.deps.store.persist();
  }
}
