// @covers FR-01.30
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { TriageGroupList } from "./TriageGroupList";
import { entry } from "../../test/triageFixtures";

vi.mock("./TriageItemRow", () => ({
  TriageItemRow: ({ item }: { item: { id: string } }) => <li data-testid={`row-${item.id}`} />,
}));

function mount(revisitDue: boolean) {
  const e = entry("p1", { id: "a", severity: "low", revisitDue });
  render(
    <QueryClientProvider client={new QueryClient()}>
      <TriageGroupList
        groups={[{ key: "severity:low", label: "Low", entries: [e] }]}
        groupBy="severity"
        collapsed={new Set(["severity:low"])}
        onToggle={vi.fn()}
        projectLabel={() => undefined}
        onOpen={vi.fn()}
        onFixNow={vi.fn()}
        onNavigateToBoard={vi.fn()}
      />
    </QueryClientProvider>,
  );
}

// @covers FR-01.30
describe("TriageGroupList collapse", () => {
  it("a saved-collapsed group hides its rows", () => {
    mount(false);
    expect(screen.queryByTestId("row-a")).toBeNull();
  });

  it("a collapsed group holding a returned park stays open", () => {
    mount(true);
    expect(screen.getByTestId("row-a")).toBeInTheDocument();
  });
});

function mountProjects(onReorderProject = vi.fn(), groupBy: "project" | "severity" = "project") {
  const g = (id: string) => ({
    key: `${groupBy}:${id}`,
    label: `Proj ${id}`,
    color: "hsl(200 50% 50%)",
    entries: [entry(id, { id: `t-${id}` })],
  });
  render(
    <QueryClientProvider client={new QueryClient()}>
      <TriageGroupList
        groups={[g("p1"), g("p2"), g("p3")]}
        groupBy={groupBy}
        collapsed={new Set()}
        onToggle={vi.fn()}
        projectLabel={() => undefined}
        onOpen={vi.fn()}
        onFixNow={vi.fn()}
        onNavigateToBoard={vi.fn()}
        onReorderProject={onReorderProject}
      />
    </QueryClientProvider>,
  );
  return onReorderProject;
}

// @covers FR-01.30
describe("TriageGroupList project lane order", () => {
  it("every project lane has a drag handle; the arrow keys on it move the lane by one place", async () => {
    const { fireEvent } = await import("@testing-library/react");
    const onReorder = mountProjects();
    const mid = screen.getByTestId("triage-group-handle-project:p2");
    fireEvent.keyDown(mid, { key: "ArrowUp" });
    expect(onReorder).toHaveBeenLastCalledWith("p2", "p1");
    fireEvent.keyDown(mid, { key: "ArrowDown" });
    expect(onReorder).toHaveBeenLastCalledWith("p2", "p3");
  });

  it("the first lane cannot move up and the last cannot move down", async () => {
    const { fireEvent } = await import("@testing-library/react");
    const onReorder = mountProjects();
    fireEvent.keyDown(screen.getByTestId("triage-group-handle-project:p1"), { key: "ArrowUp" });
    fireEvent.keyDown(screen.getByTestId("triage-group-handle-project:p3"), { key: "ArrowDown" });
    expect(onReorder).not.toHaveBeenCalled();
  });

  it("lanes grouped by anything but project have no handle", () => {
    mountProjects(vi.fn(), "severity");
    expect(screen.queryByTestId("triage-group-handle-severity:p1")).toBeNull();
  });
});
