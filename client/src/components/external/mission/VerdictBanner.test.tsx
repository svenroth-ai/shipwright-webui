import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { VerdictBanner } from "./VerdictBanner";

describe("VerdictBanner", () => {
  // @covers FR-01.56
  it("clear -> the .ok banner with ALL CLEAR + the real test count, icon + text", () => {
    render(<VerdictBanner outcome="clear" tests={{ passed: 1882, total: 1882 }} />);
    const banner = screen.getByTestId("verdict-banner");
    expect(banner).toHaveClass("mc-verdict", "ok");
    expect(banner).toHaveAttribute("data-outcome", "clear");
    expect(banner).toHaveTextContent("ALL CLEAR");
    expect(banner).toHaveTextContent("1882/1882");
    // icon + text, never colour alone (AC7): an svg AND an aria-label are present.
    expect(banner.querySelector("svg")).toBeTruthy();
    expect(banner).toHaveAttribute("aria-label", expect.stringContaining("ALL CLEAR"));
  });

  // @covers FR-01.56
  it("clear with unknown tests drops the count (honest degradation)", () => {
    render(<VerdictBanner outcome="clear" tests={null} />);
    expect(screen.getByTestId("verdict-banner")).not.toHaveTextContent("/");
  });

  // @covers FR-01.56
  it("hold -> the .err banner with a GATE HOLD badge, icon + text", () => {
    render(<VerdictBanner outcome="hold" />);
    const banner = screen.getByTestId("verdict-banner");
    expect(banner).toHaveClass("mc-verdict", "err");
    expect(banner).toHaveAttribute("data-outcome", "hold");
    expect(banner).toHaveTextContent("GATE HOLD");
    expect(banner.querySelector("svg")).toBeTruthy();
    expect(banner).toHaveAttribute("aria-label", expect.stringContaining("GATE HOLD"));
  });

  // @covers FR-01.56
  it("neutral/no-data -> an honest muted 'No run data yet', NOT ALL CLEAR", () => {
    render(<VerdictBanner outcome="neutral" reason="no-data" />);
    const banner = screen.getByTestId("verdict-banner");
    expect(banner).toHaveClass("mc-verdict", "neutral");
    expect(banner).toHaveTextContent("No run data yet");
    expect(banner).not.toHaveTextContent("ALL CLEAR");
    expect(banner.querySelector("svg")).toBeTruthy();
  });

  // @covers FR-01.56
  it("neutral/in-progress -> 'In progress'", () => {
    render(<VerdictBanner outcome="neutral" reason="in-progress" />);
    expect(screen.getByTestId("verdict-banner")).toHaveTextContent("In progress");
  });

  // @covers FR-01.56
  it("neutral/unverified -> 'Not fully verified', NOT a false ALL CLEAR", () => {
    render(<VerdictBanner outcome="neutral" reason="unverified" />);
    const banner = screen.getByTestId("verdict-banner");
    expect(banner).toHaveClass("mc-verdict", "neutral");
    expect(banner).toHaveTextContent("Not fully verified");
    expect(banner).not.toHaveTextContent("ALL CLEAR");
  });
});
