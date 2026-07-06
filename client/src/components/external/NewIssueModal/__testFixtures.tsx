/*
 * Shared test fixtures for the NewIssueModal directory test files.
 *
 * Exports: action presets, a `makeFetchMock`, and a `renderModal` helper.
 * No `describe`/`it` here — that would emit zero-test files into the
 * vitest run. Each per-concern test file imports from this fixture.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { vi } from "vitest";

import { NewIssueModal } from "./NewIssueModal";
import type {
  ActionDefinition,
  ResolvedProjectActions,
} from "../../../lib/externalApi";

export const TASK_ACTION: ActionDefinition = {
  id: "new-task",
  label: "New task",
  kind: "external_launch",
  command_template: "claude /shipwright-{task.phase}",
};
export const PIPELINE_ACTION: ActionDefinition = {
  id: "new-pipeline",
  label: "New pipeline",
  kind: "external_launch",
  command_template: "claude /shipwright-run",
};
export const ITERATE_ACTION: ActionDefinition = {
  id: "new-iterate",
  label: "New iterate",
  kind: "external_launch",
  command_template: "claude /shipwright-iterate",
};
export const PLAIN_ACTION: ActionDefinition = {
  id: "new-plain",
  label: "Plain Claude",
  kind: "external_launch",
  command_template: 'cd "{project.path}" && claude --session-id {task.uuid}',
};
export const GENERIC_ACTION: ActionDefinition = {
  id: "new-content-orchestrator",
  label: "Content Orchestrator",
  kind: "external_launch",
  description: "Run the content pipeline.",
  command_template:
    'cd "p" && claude --session-id {task.uuid} /content-orchestrator',
};

export const SAMPLE_ACTIONS: ResolvedProjectActions = {
  actions: [TASK_ACTION, PIPELINE_ACTION, ITERATE_ACTION, PLAIN_ACTION],
  phases: [
    { id: "build", label: "Build" },
    { id: "design", label: "Design" },
  ],
  defaults: { autonomy: "guided" },
  preview: {
    enabled: false,
    command: null,
    port: null,
    ready_path: null,
    ready_timeout_seconds: null,
  },
  diagnostics: [],
};

export interface FetchMockOpts {
  taskId?: string;
  captureCreate?: { body?: string };
  captureLaunch?: { body?: string };
  launchResponse?: { commands: { powershell: string; cmd: string; posix: string } };
}

export function makeFetchMock(opts: FetchMockOpts) {
  const taskId = opts.taskId ?? "task-x";
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/launch") && init?.method !== "GET") {
      if (opts.captureLaunch) opts.captureLaunch.body = init?.body as string;
      return new Response(
        JSON.stringify({
          task: { taskId },
          commands: opts.launchResponse?.commands ?? {
            powershell: "ps-cmd",
            cmd: "cmd-cmd",
            posix: "posix-cmd",
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    if (url.endsWith("/api/external/tasks") && init?.method === "POST") {
      if (opts.captureCreate) opts.captureCreate.body = init?.body as string;
      return new Response(
        JSON.stringify({
          task: {
            taskId,
            sessionUuid: "00000000-0000-0000-0000-000000000001",
            cwd: "/tmp/demo",
            pluginDirs: [],
            title: "x",
            projectId: "proj-1",
            state: "draft",
            createdAt: "",
            inbox: {
              pendingToolUseIds: [],
              dismissedToolUseIds: [],
              lastProcessedByteOffset: 0,
            },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    return new Response("{}", { status: 200 });
  });
}

/**
 * Expand the collapsed "More options" section so the below-Description
 * fields (leadwright inputs, advanced params, command preview) mount.
 * iterate-2026-07-06-collapse-dialog-more-options: these are collapsed by
 * default, so any test asserting on them must open the disclosure first.
 * `fireEvent` auto-wraps in act for the synchronous toggle.
 */
export function openMoreOptions() {
  const toggle = screen.queryByTestId("new-issue-more-options-toggle");
  if (toggle && toggle.getAttribute("aria-expanded") !== "true") {
    fireEvent.click(toggle);
  }
}

export type RenderModalOverrides = Partial<
  React.ComponentProps<typeof NewIssueModal>
> & {
  projectsOverride?: Array<Record<string, unknown>>;
};

export function renderModal(overrides: RenderModalOverrides = {}) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const { projectsOverride, ...rest } = overrides;
  qc.setQueryData(
    ["projects"],
    projectsOverride ?? [
      {
        id: "proj-1",
        name: "demo",
        path: "/tmp/demo",
        profile: "supabase-nextjs",
        status: "active",
        createdAt: "2026-04-01",
        lastActive: "2026-04-20",
      },
    ],
  );
  const props = {
    open: true,
    onOpenChange: vi.fn(),
    action: TASK_ACTION,
    projectActions: SAMPLE_ACTIONS,
    ...rest,
  };
  return {
    qc,
    ...render(
      <MemoryRouter>
        <QueryClientProvider client={qc}>
          <NewIssueModal {...props} />
        </QueryClientProvider>
      </MemoryRouter>,
    ),
  };
}
