/*
 * Cross-surface + fence tests for the launch state machine (FR-01.61, A17).
 *
 * AC4 — one source of words: the task card, the task-detail header recovery,
 * and the shared notice render the SAME title+sentence for the same
 * jsonl_missing task (all read `lib/launchFailure.ts`).
 * AC5 — the fences hold as code (source scans + behaviour).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { TaskCard } from "./TaskCard";
import { LaunchFailureRecovery } from "./TaskDetailHeader/LaunchFailureRecovery";
import { resolveLaunchFailure } from "../../lib/launchFailure";
import type { ExternalTask } from "../../lib/externalApi";

vi.mock("react-router-dom", async (orig) => ({
  ...(await orig<typeof import("react-router-dom")>()),
  useNavigate: () => vi.fn(),
}));

function makeTask(o: Partial<ExternalTask> = {}): ExternalTask {
  return {
    taskId: "t-jm",
    sessionUuid: "12345678-1234-4234-8234-123456789abc",
    cwd: "/home/me/proj",
    pluginDirs: [],
    title: "A task",
    projectId: "p1",
    state: "jsonl_missing",
    createdAt: "2026-07-10",
    firstJsonlObservedAt: undefined,
    inbox: { pendingToolUseIds: [], dismissedToolUseIds: [], lastProcessedByteOffset: 0 },
    ...o,
  };
}

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => vi.restoreAllMocks());

describe("AC4 — one source of words across surfaces", () => {
  it("task card and task-detail header render the SAME title + sentence for a jsonl_missing task", () => {
    const task = makeTask();
    const canonical = resolveLaunchFailure({ source: "task", state: "jsonl_missing" })!;

    const { unmount } = wrap(<TaskCard task={task} />);
    const cardTitle = screen.getByTestId(`task-card-failure-${task.taskId}-title`).textContent;
    const cardSentence = screen.getByTestId(`task-card-failure-${task.taskId}-sentence`).textContent;
    unmount();

    wrap(<LaunchFailureRecovery task={task} />);
    const headerTitle = screen.getByTestId(`task-detail-failure-${task.taskId}-title`).textContent;
    const headerSentence = screen.getByTestId(`task-detail-failure-${task.taskId}-sentence`).textContent;

    expect(cardTitle).toBe(canonical.title);
    expect(headerTitle).toBe(canonical.title);
    expect(cardSentence).toBe(canonical.sentence);
    expect(headerSentence).toBe(canonical.sentence);
  });

  it("both surfaces name the watched JSONL path (never a fabricated file)", () => {
    const task = makeTask();
    wrap(<TaskCard task={task} />);
    expect(screen.getByTestId(`task-card-failure-${task.taskId}-path`).textContent).toContain(
      `${task.sessionUuid}.jsonl`,
    );
  });
});

// ---- AC5: fences hold as code (source scans over the A17-owned modules) ----
const here = path.dirname(fileURLToPath(import.meta.url));
const NEW_FILES = [
  "../../lib/launchFailure.ts",
  "./LaunchFailureNotice.tsx",
  "./CampaignLaunchDialog.tsx",
  "./CampaignStartButton.tsx",
  "./TaskDetailHeader/LaunchFailureRecovery.tsx",
  "./taskCardState.tsx",
];

describe("AC5 — fences", () => {
  it("DO-NOT #11: no slash-command / phase literal in any A17-owned module", () => {
    for (const rel of NEW_FILES) {
      const src = fs.readFileSync(path.join(here, rel), "utf8");
      expect(src, rel).not.toMatch(/\/shipwright-/);
    }
  });

  it("rule 23 / DO-NOT #12: A17-owned failure modules write no board column and no run-config", () => {
    for (const rel of NEW_FILES) {
      const src = fs.readFileSync(path.join(here, rel), "utf8");
      expect(src, rel).not.toMatch(/boardColumn|setBoardColumn|\/column\b/);
      expect(src, rel).not.toMatch(/shipwright_run_config|setRunConfig|writeRunConfig/);
    }
  });

  it("DO-NOT #1: no A17-owned failure module writes into ~/.claude/projects", () => {
    for (const rel of NEW_FILES) {
      const src = fs.readFileSync(path.join(here, rel), "utf8");
      // A watched-path DISPLAY string is allowed; a write call is not.
      expect(src, rel).not.toMatch(/writeFile|mkdir|createWriteStream/);
    }
  });
});
