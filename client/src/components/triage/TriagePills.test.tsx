// @covers FR-01.30
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { TRIAGE_GRID } from "./triageGrid";
import { TriagePills } from "./TriagePills";
import type { TriageItem } from "../../lib/triageApi";

const item = {
  id: "trg-pill0001",
  source: "compliance",
  severity: "medium",
  title: "t",
  detail: "d",
  pendingDelivery: false,
  revisitDue: false,
} as unknown as TriageItem;

// @covers FR-01.30
describe("TriagePills + grid", () => {
  it("shows the source label with its help, a severity pill WITHOUT help, and no project pill by default", () => {
    render(<TriagePills item={item} projectId="p1" />);
    expect(screen.getByTestId("triage-source-compliance")).toHaveTextContent("Compliance");
    expect(screen.getByTestId("triage-help-source-compliance")).toBeInTheDocument();
    expect(screen.getByTestId("triage-severity-medium")).toBeInTheDocument();
    expect(screen.queryByTestId("triage-help-severity-medium")).toBeNull();
    expect(screen.queryByTestId("triage-item-trg-pill0001-project")).toBeNull();
  });

  it("project pill uses dark text on the muted surface, never a translucent one", () => {
    render(<TriagePills item={item} projectId="p1" projectLabel="alpha" />);
    const pill = screen.getByTestId("triage-item-trg-pill0001-project");
    expect(pill).toHaveTextContent("alpha");
    expect(pill.className).toContain("text-[var(--color-text)]");
    expect(pill.className).toContain("bg-[var(--color-muted-bg)]");
  });

  it("the card grid is 1 column, then 2, then 3", () => {
    expect(TRIAGE_GRID).toMatch(/grid-cols-\[minmax\(0,1fr\)\]/);
    expect(TRIAGE_GRID).toMatch(/min-\[1100px\]:grid-cols-\[repeat\(2,minmax\(0,1fr\)\)\]/);
    expect(TRIAGE_GRID).toMatch(/min-\[1700px\]:grid-cols-\[repeat\(3,minmax\(0,1fr\)\)\]/);
  });

  it("a project-specific source is shown as written and gets the generic help", () => {
    render(<TriagePills item={{ ...item, source: "my-campaign" }} projectId="p1" />);
    expect(screen.getByTestId("triage-source-my-campaign")).toHaveTextContent("my-campaign");
  });
});
