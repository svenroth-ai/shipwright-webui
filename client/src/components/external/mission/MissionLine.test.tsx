import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";

// The whole point of this component is that its words come from A10's narrator,
// not a literal in the component. Mock the narrator and assert the component
// renders ITS output — so a hardcoded phrase book here would fail the test.
const narrateMissionMock = vi.fn();
vi.mock("../../../lib/narrator", () => ({
  narrateMission: (input: unknown) => narrateMissionMock(input),
}));

import { MissionLine } from "./MissionLine";

afterEach(() => narrateMissionMock.mockReset());

describe("MissionLine", () => {
  // @covers FR-01.56
  it("renders the narrator's text + bolds its emphasis clause", () => {
    narrateMissionMock.mockReturnValue({
      text: "Sentence from the narrator.",
      emphasis: "the bolded consequence.",
    });
    render(<MissionLine input={{ state: "hold" }} />);
    const line = screen.getByTestId("mission-line");
    expect(line).toHaveTextContent("Sentence from the narrator. the bolded consequence.");
    // the consequence clause is the bolded part
    expect(line.querySelector("b")).toHaveTextContent("the bolded consequence.");
  });

  // @covers FR-01.56
  it("passes its input straight to the narrator (no second phrase book here)", () => {
    narrateMissionMock.mockReturnValue({ text: "x", emphasis: "" });
    render(<MissionLine input={{ state: "designgate", screenCount: 5 }} />);
    expect(narrateMissionMock).toHaveBeenCalledWith({ state: "designgate", screenCount: 5 });
  });

  // @covers FR-01.56
  it("an empty emphasis renders no <b> (honest degradation)", () => {
    narrateMissionMock.mockReturnValue({ text: "Just the lead.", emphasis: "" });
    render(<MissionLine input={{ state: "complete", changeCount: null, fileCount: null }} />);
    expect(screen.getByTestId("mission-line").querySelector("b")).toBeNull();
  });
});
