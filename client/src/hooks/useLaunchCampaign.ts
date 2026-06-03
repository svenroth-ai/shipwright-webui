/*
 * useLaunchCampaign — open a TaskDetail terminal that auto-runs
 * `/shipwright-iterate --campaign <slug> --autonomous` (FR-01.34).
 *
 * Mirrors the create→launch→sessionStorage-handoff→navigate path that
 * `NewIssueModal`/`useNewIssueFormSubmit` use (ADR-068-A1): the handoff key
 * `webui:pending-auto-launch:<taskId>` is read by `TaskDetailPage` on mount,
 * inside its `LaunchCoordinatorProvider`, and dispatched into the embedded
 * terminal once it is writer + prompt-ready.
 *
 * The command itself is built ENTIRELY server-side from a validated slug
 * (`launchCampaignRun` → the launch campaign branch) — the client never
 * dictates the command (Architecture rule 1 / regression guard #19).
 *
 * The imperative `launchCampaign(args, deps)` is the testable core (no React);
 * the `useLaunchCampaign()` hook injects the real deps + query invalidation.
 */

import { useQueryClient } from "@tanstack/react-query";

import { createTask, type CopyCommandForms } from "../lib/externalApi";
import { launchCampaignRun } from "../lib/campaignsApi";

export interface LaunchCampaignArgs {
  project: { id: string; path: string };
  slug: string;
}

export type LaunchCampaignResult =
  | { ok: true; taskId: string; commands: CopyCommandForms }
  | { ok: false; reason: "create_failed" | "launch_failed"; detail?: string };

export interface LaunchCampaignDeps {
  create: (args: {
    title: string;
    cwd: string;
    pluginDirs: string[];
    projectId: string;
  }) => Promise<{ taskId: string }>;
  launch: (
    taskId: string,
    slug: string,
  ) => Promise<{ task: { taskId: string }; commands: CopyCommandForms }>;
  /** Auto-launch channel; defaults to the sessionStorage handoff TaskDetailPage reads. */
  handoff?: (taskId: string, commands: CopyCommandForms) => void;
}

/** Default handoff — best-effort sessionStorage write (privacy mode → silently
 *  skipped; the TaskDetail header CTA is the manual fallback). */
function writePendingAutoLaunch(taskId: string, commands: CopyCommandForms): void {
  try {
    if (typeof window === "undefined") return;
    window.sessionStorage.setItem(
      `webui:pending-auto-launch:${taskId}`,
      JSON.stringify({ commands, resume: false, ts: Date.now() }),
    );
  } catch {
    // sessionStorage disabled — auto-launch unavailable; task is still created
    // + launched server-side, so TaskDetail can relaunch manually.
  }
}

export async function launchCampaign(
  args: LaunchCampaignArgs,
  deps: LaunchCampaignDeps,
): Promise<LaunchCampaignResult> {
  const { project, slug } = args;

  let taskId: string;
  try {
    const task = await deps.create({
      title: `campaign: ${slug}`,
      cwd: project.path,
      pluginDirs: [],
      projectId: project.id,
    });
    taskId = task.taskId;
  } catch (err) {
    return {
      ok: false,
      reason: "create_failed",
      detail: err instanceof Error ? err.message : String(err),
    };
  }

  let commands: CopyCommandForms;
  try {
    const result = await deps.launch(taskId, slug);
    commands = result.commands;
  } catch (err) {
    return {
      ok: false,
      reason: "launch_failed",
      detail: err instanceof Error ? err.message : String(err),
    };
  }

  (deps.handoff ?? writePendingAutoLaunch)(taskId, commands);
  return { ok: true, taskId, commands };
}

/** React hook — preferred form. Injects the real deps + invalidates task lists. */
export function useLaunchCampaign() {
  const qc = useQueryClient();
  return async function launchCampaignFromHook(
    args: LaunchCampaignArgs,
  ): Promise<LaunchCampaignResult> {
    const result = await launchCampaign(args, {
      create: createTask,
      launch: launchCampaignRun,
    });
    if (result.ok) {
      void qc.invalidateQueries({ queryKey: ["external-tasks"] });
    }
    return result;
  };
}
