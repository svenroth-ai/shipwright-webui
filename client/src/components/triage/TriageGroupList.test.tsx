// @covers FR-01.30
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { TriageGroupList } from "./TriageGroupList";
import { entry } from "../../test/triageFixtures";

vi.mock("./TriageItemCard", () => ({
  TriageItemCard: ({ item }: { item: { id: string } }) => <div data-testid={`card-${item.id}`} />,
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
  it("a saved-collapsed group hides its cards", () => {
    mount(false);
    expect(screen.queryByTestId("card-a")).toBeNull();
  });

  it("a collapsed group holding a returned park stays open", () => {
    mount(true);
    expect(screen.getByTestId("card-a")).toBeInTheDocument();
  });
});
