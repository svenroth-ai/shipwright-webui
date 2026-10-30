import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import {
  STANDALONE_VIEW_KEY,
  isStandaloneViewEnabled,
  setStandaloneViewEnabled,
} from "./standaloneView";
import { openProjectLog } from "./projectNav";
import { StandaloneViewCard } from "../components/settings/StandaloneViewCard";
import { HiddenInStandaloneView } from "../components/common/HiddenInStandaloneView";

beforeEach(() => localStorage.clear());

describe("standalone view preference", () => {
  // @covers FR-01.03
  it("is off by default", () => {
    expect(isStandaloneViewEnabled()).toBe(false);
  });

  // @covers FR-01.03
  it("persists under its key", () => {
    setStandaloneViewEnabled(true);
    expect(localStorage.getItem(STANDALONE_VIEW_KEY)).toBe("true");
    expect(isStandaloneViewEnabled()).toBe(true);
  });
});

describe("StandaloneViewCard", () => {
  // @covers FR-01.03
  it("explains what is hidden and toggles the preference", async () => {
    render(<StandaloneViewCard />);
    expect(screen.getByText("Triage", { selector: "strong" })).toBeInTheDocument();
    expect(screen.getByText(/Ship's Log/, { selector: "strong" })).toBeInTheDocument();
    const box = screen.getByTestId("standalone-view-toggle") as HTMLInputElement;
    expect(box.checked).toBe(false);
    await userEvent.click(box);
    expect(box.checked).toBe(true);
    expect(isStandaloneViewEnabled()).toBe(true);
  });
});

describe("HiddenInStandaloneView", () => {
  const app = () =>
    render(
      <MemoryRouter initialEntries={["/triage"]}>
        <Routes>
          <Route path="/" element={<div>board</div>} />
          <Route path="/triage" element={<HiddenInStandaloneView><div>triage page</div></HiddenInStandaloneView>} />
        </Routes>
      </MemoryRouter>,
    );

  // @covers FR-01.03
  it("renders the page when the view is off", () => {
    app();
    expect(screen.getByText("triage page")).toBeInTheDocument();
  });

  // @covers FR-01.03
  it("redirects to the board when on, and live when toggled", () => {
    app();
    act(() => setStandaloneViewEnabled(true));
    expect(screen.getByText("board")).toBeInTheDocument();
  });
});

describe("openProjectLog", () => {
  // @covers FR-01.03
  it("goes to the Ship's Log normally and to the board in standalone view", () => {
    const navigate = vi.fn();
    const setActiveProjectId = vi.fn();
    openProjectLog("p1", { navigate, setActiveProjectId });
    expect(navigate).toHaveBeenLastCalledWith("/projects/p1/log");
    setStandaloneViewEnabled(true);
    openProjectLog("p1", { navigate, setActiveProjectId });
    expect(navigate).toHaveBeenLastCalledWith("/");
    expect(setActiveProjectId).toHaveBeenLastCalledWith("p1");
  });
});

describe("real router wiring", () => {
  // @covers FR-01.03
  it("guards the Triage and project-log routes and keeps Triage out of the palette when on", async () => {
    const { router } = await import("../router");
    const { STANDALONE_HIDDEN_DESTINATION_IDS } = await import("./standaloneView");
    const root = router.routes.find((r) => r.path === "/")!;
    const guarded = (path: string) => {
      const el = root.children!.find((c) => c.path === path)!.element as { type: unknown };
      return el.type === HiddenInStandaloneView;
    };
    expect(guarded("triage")).toBe(true);
    expect(guarded("projects/:projectId/log")).toBe(true);
    expect(STANDALONE_HIDDEN_DESTINATION_IDS).toContain("triage");
  });
});
