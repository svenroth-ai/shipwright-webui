import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import { OperationLive } from "./OperationLive";

describe("OperationLive — plain-language live narration (AC1)", () => {
  // @covers FR-01.66
  it("renders the rolling summary line + the recent-activity list", () => {
    render(
      <OperationLive
        narration={{
          summary: "Editing login.tsx",
          activity: [
            { id: "a0", text: "You said: Add a login page" },
            { id: "a1", text: "Editing login.tsx" },
          ],
        }}
      />,
    );
    expect(screen.getByTestId("mission-narration-summary")).toHaveTextContent("Editing login.tsx");
    const hero = screen.getByTestId("mission-narration");
    expect(hero).toHaveTextContent("You said: Add a login page");
    expect(hero).toHaveTextContent("Editing login.tsx");
    expect(hero).not.toHaveAttribute("data-empty");
  });

  // @covers FR-01.66
  it("no activity → honest waiting, never fabricated (AC3)", () => {
    render(<OperationLive narration={{ summary: null, activity: [] }} />);
    expect(screen.getByTestId("mission-narration-summary")).toHaveTextContent(/waiting/i);
    const hero = screen.getByTestId("mission-narration");
    expect(hero).toHaveAttribute("data-empty", "true");
    expect(hero).toHaveTextContent(/No activity/i);
  });
});

describe("OperationLive — is NOT the terminal (AC5, rule 1)", () => {
  // @covers FR-01.66
  it("has no xterm/canvas/textarea and constructs no WebSocket", () => {
    const wsSpy = vi.spyOn(globalThis, "WebSocket");
    const { container } = render(
      <OperationLive
        narration={{ summary: "Editing x", activity: [{ id: "a", text: "Editing x" }] }}
      />,
    );
    expect(container.querySelector(".xterm")).toBeNull();
    expect(container.querySelector("canvas")).toBeNull();
    expect(container.querySelector("[data-testid='embedded-terminal']")).toBeNull();
    expect(container.querySelector("textarea")).toBeNull();
    expect(wsSpy).not.toHaveBeenCalled();
    wsSpy.mockRestore();
  });
});
