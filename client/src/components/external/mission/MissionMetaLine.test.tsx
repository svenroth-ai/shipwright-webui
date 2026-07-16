import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { MissionMetaLine } from "./MissionMetaLine";
import type { ExternalTask } from "../../../lib/externalApi";

function makeTask(overrides: Partial<ExternalTask> = {}): ExternalTask {
  return {
    taskId: "task-1",
    sessionUuid: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    cwd: "C:/tmp/demo",
    pluginDirs: [],
    title: "Meta line demo",
    projectId: "p1",
    state: "active",
    createdAt: "2026-04-20",
    inbox: { pendingToolUseIds: [], dismissedToolUseIds: [], lastProcessedByteOffset: 0 },
    ...overrides,
  };
}

describe("MissionMetaLine", () => {
  it("renders the phase chip from a server-persisted phase + the Started line", () => {
    render(
      <MissionMetaLine
        task={makeTask({ phase: "compliance", phaseLabel: "Compliance" })}
        startedAt="2026-04-20T10:00:00.000Z"
      />,
    );
    const line = screen.getByTestId("task-detail-subline");
    expect(line).toHaveTextContent("Compliance");
    expect(line).toHaveTextContent(/Started/);
  });

  it("interpolates last-event + model when provided", () => {
    render(
      <MissionMetaLine
        task={makeTask()}
        startedAt="2026-04-20T10:00:00.000Z"
        lastEventAt="2026-04-20T12:00:00.000Z"
        modelName="claude-opus-4-8"
      />,
    );
    const line = screen.getByTestId("task-detail-subline");
    expect(line).toHaveTextContent(/last event/);
    expect(line).toHaveTextContent("claude-opus-4-8");
  });

  it("omits the phase chip when the task has no resolvable phase", () => {
    // A plain title with no phase keyword + no persisted phase → no chip.
    render(
      <MissionMetaLine task={makeTask({ title: "zzzz" })} startedAt="2026-04-20T10:00:00.000Z" />,
    );
    expect(screen.getByTestId("task-detail-subline")).toBeInTheDocument();
  });
});
