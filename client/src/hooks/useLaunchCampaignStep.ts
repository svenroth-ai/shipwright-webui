/*
 * useLaunchCampaignStep — open a TaskDetail terminal that auto-runs
 * `/shipwright-iterate "<specPath>"` for a SINGLE campaign sub-iterate
 * (FR-01.36).
 *
 * Sibling of `useLaunchCampaign` (autonomous). Both share the
 * create→launch→sessionStorage-handoff→navigate core (`launchCampaignTask`):
 * the only differences are the task title and which server endpoint builds the
 * command. The command itself is built ENTIRELY server-side from a validated
 * `{ slug, stepId }` (`launchCampaignStepRun` → the campaign-step launch
 * branch) — the client never dictates it (Architecture rule 1 / guard #19).
 *
 * The imperative `launchCampaignStep(args, deps)` is the testable core (no
 * React); the `useLaunchCampaignStep()` hook injects the real deps + query
 * invalidation.
 */

import { useQueryClient } from "@tanstack/react-query";

import { createTask, type CopyCommandForms } from "../lib/externalApi";
import { launchCampaignStepRun } from "../lib/campaignsApi";
import { launchCampaignTask, type LaunchCampaignResult } from "./useLaunchCampaign";

export type { LaunchCampaignResult } from "./useLaunchCampaign";

export interface LaunchCampaignStepArgs {
  project: { id: string; path: string };
  slug: string;
  stepId: string;
}

export interface LaunchCampaignStepDeps {
  create: Parameters<typeof launchCampaignTask>[1]["create"];
  launch: (
    taskId: string,
    slug: string,
    stepId: string,
  ) => Promise<{ task: { taskId: string }; commands: CopyCommandForms }>;
  handoff?: Parameters<typeof launchCampaignTask>[1]["handoff"];
}

export async function launchCampaignStep(
  args: LaunchCampaignStepArgs,
  deps: LaunchCampaignStepDeps,
): Promise<LaunchCampaignResult> {
  return launchCampaignTask(
    {
      project: args.project,
      // A short, glanceable task title: "<slug> · <stepId>".
      title: `${args.slug} · ${args.stepId}`,
      performLaunch: (taskId) => deps.launch(taskId, args.slug, args.stepId),
    },
    { create: deps.create, handoff: deps.handoff },
  );
}

/** React hook — preferred form. Injects the real deps + invalidates task lists. */
export function useLaunchCampaignStep() {
  const qc = useQueryClient();
  return async function launchCampaignStepFromHook(
    args: LaunchCampaignStepArgs,
  ): Promise<LaunchCampaignResult> {
    const result = await launchCampaignStep(args, {
      create: createTask,
      launch: launchCampaignStepRun,
    });
    if (result.ok) {
      void qc.invalidateQueries({ queryKey: ["external-tasks"] });
    }
    return result;
  };
}
