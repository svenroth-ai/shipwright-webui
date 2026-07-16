/*
 * useWizardLaunch — wire the New + Adopt doors to the REAL create → launch path
 * (A09a, FR-01.52).
 *
 * Mirrors `useLaunchCampaign` / `useNewIssueFormSubmit` (ADR-068-A1): create the
 * project (New + Adopt both register one), create the task, POST /launch to get
 * the server-built command, hand off via the `webui:pending-auto-launch:<taskId>`
 * sessionStorage key that `TaskDetailPage` reads once the embedded terminal is
 * writer + prompt-ready, then navigate to Mission. Webui SPAWNS NO Claude — the
 * command is built entirely server-side and auto-executed by the terminal after
 * the CTA (Architecture rule 1 / regression guard #19).
 *
 * The imperative `launchWizardDoor(request, deps)` is the testable core (no
 * React); the `useWizardLaunch()` hook injects the real deps + navigation.
 *
 * AC3 is enforced by construction: the request → payload builders in contract.ts
 * ALWAYS emit an `actionId` + a brief, so a wizard launch can never fall through
 * to the legacy empty-prompt `buildCopyCommands()` path.
 */

import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";

import { apiPost } from "../../../lib/api";
import {
  createTask as apiCreateTask,
  launchExternalTask,
  type CopyCommandForms,
} from "../../../lib/externalApi";
import type { Project } from "../../../types";
import {
  toCreateProjectPayload,
  toCreateTaskPayload,
  toLaunchPayload,
  type WizardCreateResponse,
  type WizardLaunchRequest,
} from "./contract";

export type WizardLaunchOutcome =
  | { ok: true; response: WizardCreateResponse; commands: CopyCommandForms }
  | {
      ok: false;
      state: "launch-failed";
      reason: "create_project_failed" | "create_task_failed" | "launch_failed";
      detail?: string;
    };

export interface WizardLaunchDeps {
  createProject: (payload: ReturnType<typeof toCreateProjectPayload>) => Promise<{
    id: string;
    path: string;
  }>;
  createTask: (payload: ReturnType<typeof toCreateTaskPayload> & { pluginDirs: string[] }) => Promise<{
    taskId: string;
    sessionUuid: string;
    projectId: string;
  }>;
  launch: (
    taskId: string,
    body: ReturnType<typeof toLaunchPayload>,
  ) => Promise<{ commands: CopyCommandForms }>;
  /** Auto-launch channel; defaults to the sessionStorage handoff TaskDetailPage reads. */
  handoff?: (taskId: string, commands: CopyCommandForms) => void;
  navigate: (to: string) => void;
}

/** Default handoff — best-effort sessionStorage write (privacy mode → silently
 *  skipped; the TaskDetail header CTA is the manual fallback). Byte-identical to
 *  useLaunchCampaign's key + envelope so TaskDetailPage reads it unchanged. */
export function writePendingAutoLaunch(taskId: string, commands: CopyCommandForms): void {
  try {
    if (typeof window === "undefined") return;
    window.sessionStorage.setItem(
      `webui:pending-auto-launch:${taskId}`,
      JSON.stringify({ commands, resume: false, ts: Date.now() }),
    );
  } catch {
    // sessionStorage disabled — auto-launch unavailable; the task is still
    // created + launched server-side, so TaskDetail can relaunch manually.
  }
}

function detail(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Create project → create task → launch → hand off → navigate. Fails CLOSED at
 * each step with a distinct reason so the UI can say what broke without leaking
 * a half-launched state.
 */
export async function launchWizardDoor(
  request: WizardLaunchRequest,
  deps: WizardLaunchDeps,
): Promise<WizardLaunchOutcome> {
  // 1 — project. Adopt targets an existing repo (mkdir is a no-op); New creates
  //     the target directory server-side (POST /projects mkdir -p).
  let project: { id: string; path: string };
  try {
    project = await deps.createProject(toCreateProjectPayload(request));
  } catch (err) {
    return { ok: false, state: "launch-failed", reason: "create_project_failed", detail: detail(err) };
  }

  // 2 — task (actionId + brief ALWAYS present — AC3).
  let created: { taskId: string; sessionUuid: string; projectId: string };
  try {
    created = await deps.createTask({
      ...toCreateTaskPayload(request, project.id, project.path),
      pluginDirs: [],
    });
  } catch (err) {
    return { ok: false, state: "launch-failed", reason: "create_task_failed", detail: detail(err) };
  }

  // 3 — launch (actionId + brief ALWAYS present — AC3).
  let commands: CopyCommandForms;
  try {
    const result = await deps.launch(created.taskId, toLaunchPayload(request));
    commands = result.commands;
  } catch (err) {
    return { ok: false, state: "launch-failed", reason: "launch_failed", detail: detail(err) };
  }

  // 4 — hand off to the embedded terminal + navigate to Mission.
  (deps.handoff ?? writePendingAutoLaunch)(created.taskId, commands);
  deps.navigate(`/tasks/${created.taskId}`);

  return {
    ok: true,
    response: {
      projectId: created.projectId,
      taskId: created.taskId,
      sessionUuid: created.sessionUuid,
    },
    commands,
  };
}

/** React hook — preferred form. Injects the real deps + invalidates task lists. */
export function useWizardLaunch() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  return async function launch(request: WizardLaunchRequest): Promise<WizardLaunchOutcome> {
    const result = await launchWizardDoor(request, {
      createProject: (payload) => apiPost<Project>("/projects", payload),
      createTask: (payload) => apiCreateTask(payload),
      launch: (taskId, body) => launchExternalTask(taskId, body),
      navigate: (to) => navigate(to),
    });
    if (result.ok) {
      void qc.invalidateQueries({ queryKey: ["external-tasks"] });
      void qc.invalidateQueries({ queryKey: ["projects"] });
    }
    return result;
  };
}
