/*
 * Submit-callback slice for useNewIssueForm.
 *
 * This is the bit-perfectness boundary: the createPayload + launchBody
 * shapes here MUST match the pre-split snapshots (see mini-plan
 * Phase 1 — Pre-snap). All cleanup-invariant tests assert against these
 * payloads.
 *
 * The hook returns { onSubmit, submitting, error } — wrap the result and
 * forward to ModalShell. The duplicate-submit guard is the existing
 * `if (!canSubmit) return` + `submitting` setter: while a request is
 * in-flight `canSubmit` is false, so a rapid second click is a no-op.
 */

import { useCallback, useRef, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";

import {
  createTask,
  launchExternalTask,
  type ActionDefinition,
  type PhaseDefinition,
} from "../../../lib/externalApi";
import type { AutonomyValue } from "../AutonomyToggle";
import type { RenderableParamSchema } from "../../../types/action-schema";
import type { Project } from "../../../types";

import { explicitParamEntries } from "./paramHelpers";
import type { Mode, SubmitAction } from "./types";

export interface UseNewIssueFormSubmitInput {
  // Identity
  mode: Mode;
  action: ActionDefinition | null;
  // Form values
  title: string;
  description: string;
  autonomy: AutonomyValue;
  leadDomain: string;
  leadPriority: "" | "P0" | "P1" | "P2" | "P3";
  leadComplexityHint: "" | "small" | "medium" | "large";
  leadTagsRaw: string;
  leadBlockedByRaw: string;
  paramValues: Record<string, string | boolean>;
  paramEnabled: Record<string, boolean>;
  // Derived
  canSubmit: boolean;
  selectedProject: Project | undefined;
  currentPhase: PhaseDefinition | undefined;
  currentSchema: RenderableParamSchema[];
  showAutonomyToggle: boolean;
  showLeadDomain: boolean;
  showLeadPriority: boolean;
  showLeadComplexityHint: boolean;
  showLeadTags: boolean;
  showLeadBlockedBy: boolean;
  // Setters for surrounding state
  setSubmitting: (b: boolean) => void;
  setError: (s: string | null) => void;
  // Callbacks
  onOpenChange: (open: boolean) => void;
  onTaskCreated?: () => void;
  onToast: (msg: string, sev: "info" | "error") => void;
  writeToClipboard: (text: string) => Promise<void>;
}

export function useNewIssueFormSubmit(input: UseNewIssueFormSubmitInput) {
  const navigate = useNavigate();
  // Synchronous in-flight guard (Step 3.5 review OpenAI #3 —
  // duplicate-submit protection). The setSubmitting(true) below is async
  // (React batches), so a rapid double-click within the same event-loop
  // tick would otherwise pass the canSubmit gate twice. The ref flips
  // synchronously, blocking the second fire before the first POST returns.
  const inFlightRef = useRef(false);

  const onSubmit = useCallback(
    async (ev: FormEvent, submitAction: SubmitAction) => {
      ev.preventDefault();
      if (inFlightRef.current) return;
      if (!input.canSubmit || !input.selectedProject || !input.action) return;
      inFlightRef.current = true;
      input.setSubmitting(true);
      input.setError(null);
      try {
        // ─── createPayload ─── (bit-perfect mirror of pre-split shape)
        const createPayload: {
          title: string;
          cwd: string;
          pluginDirs: string[];
          projectId: string;
          phase?: string;
          actionId?: string;
          description?: string;
          domain?: string;
          priority?: "P0" | "P1" | "P2" | "P3";
          complexityHint?: "small" | "medium" | "large";
          tags?: string[];
          blockedBy?: string[];
        } = {
          title: input.title.trim(),
          cwd: input.selectedProject.path,
          pluginDirs: [],
          projectId: input.selectedProject.id,
          actionId: input.action.id,
        };
        if (input.mode === "new-task" && input.currentPhase) {
          createPayload.phase = input.currentPhase.id;
        }
        if (input.description.trim().length > 0) {
          createPayload.description = input.description.trim();
        }
        if (input.showLeadDomain && input.leadDomain.trim().length > 0) {
          createPayload.domain = input.leadDomain.trim();
        }
        if (input.showLeadPriority && input.leadPriority !== "") {
          createPayload.priority = input.leadPriority;
        }
        if (input.showLeadComplexityHint && input.leadComplexityHint !== "") {
          createPayload.complexityHint = input.leadComplexityHint;
        }
        if (input.showLeadTags) {
          const tags = input.leadTagsRaw
            .split(",")
            .map((s) => s.trim())
            .filter((s) => s.length > 0);
          if (tags.length > 0) createPayload.tags = tags;
        }
        if (input.showLeadBlockedBy) {
          const blockedBy = input.leadBlockedByRaw
            .split(",")
            .map((s) => s.trim())
            .filter((s) => s.length > 0);
          if (blockedBy.length > 0) createPayload.blockedBy = blockedBy;
        }
        const task = await createTask(createPayload);

        if (submitAction === "save") {
          input.onTaskCreated?.();
          input.onOpenChange(false);
          input.onToast("Saved to Backlog", "info");
          return;
        }

        // ─── launchBody ─── (bit-perfect mirror of pre-split shape)
        const body: {
          description?: string;
          autonomy?: AutonomyValue;
          actionId?: string;
          phase?: string;
          phaseLabel?: string;
          parameters?: Record<string, string | boolean>;
        } = {
          actionId: input.action.id,
        };
        if (input.description.trim()) body.description = input.description.trim();
        if (input.showAutonomyToggle) body.autonomy = input.autonomy;
        if (input.mode === "new-task" && input.currentPhase) {
          body.phase = input.currentPhase.id;
          body.phaseLabel = input.currentPhase.label;
        }
        const explicit = explicitParamEntries(
          input.currentSchema,
          input.paramValues,
          input.paramEnabled,
        );
        if (Object.keys(explicit).length > 0) body.parameters = explicit;
        const { commands } = await launchExternalTask(task.taskId, body);
        input.onTaskCreated?.();

        // ADR-068-A1 handoff: sessionStorage is the auto-launch channel.
        // Fallback to clipboard if sessionStorage is disabled (privacy mode).
        try {
          if (typeof window !== "undefined") {
            window.sessionStorage.setItem(
              `webui:pending-auto-launch:${task.taskId}`,
              JSON.stringify({
                commands,
                resume: false,
                ts: Date.now(),
              }),
            );
          }
        } catch {
          try {
            const isWin =
              typeof navigator !== "undefined" &&
              /win/i.test(navigator.userAgent || "");
            const copyText = isWin ? commands.powershell : commands.posix;
            await input.writeToClipboard(copyText);
            input.onToast(
              "Auto-launch unavailable — command copied to clipboard.",
              "info",
            );
          } catch {
            input.onToast(
              "Auto-launch unavailable. Open TaskDetail to copy manually.",
              "error",
            );
          }
        }
        input.onOpenChange(false);
        navigate(`/tasks/${task.taskId}`);
      } catch (err) {
        input.setError(String(err));
      } finally {
        input.setSubmitting(false);
        inFlightRef.current = false;
      }
    },
    [navigate, input],
  );

  return { onSubmit };
}
