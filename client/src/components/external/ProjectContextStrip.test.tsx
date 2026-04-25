/*
 * Tests for ProjectContextStrip — v0.3.2 narrow-modal robustness fix.
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import {
  ProjectContextStrip,
  shortenProjectPath,
} from "./ProjectContextStrip";

describe("shortenProjectPath", () => {
  it("returns the last two segments with a leading ellipsis for long paths", () => {
    expect(
      shortenProjectPath(
        "C:\\Users\\Sven\\dinovo\\AI Backup\\03 Development\\shipwright-webui",
      ),
    ).toBe("…/03 Development/shipwright-webui");
  });

  it("handles POSIX paths the same as Windows paths", () => {
    expect(shortenProjectPath("/home/sven/dinovo/03 Development/repo")).toBe(
      "…/03 Development/repo",
    );
  });

  it("returns the input unchanged when it has 2 or fewer segments", () => {
    expect(shortenProjectPath("/foo")).toBe("/foo");
    expect(shortenProjectPath("foo/bar")).toBe("foo/bar");
  });

  it("returns empty string for undefined / empty input", () => {
    expect(shortenProjectPath(undefined)).toBe("");
    expect(shortenProjectPath("")).toBe("");
  });
});

describe("ProjectContextStrip — narrow-modal robustness (v0.3.2)", () => {
  it("renders the project name + shortened path", () => {
    render(
      <ProjectContextStrip
        name="Shipwright WebUI"
        path="C:\\Users\\Sven\\dinovo GmbH\\AI Backup\\03 Development\\shipwright-webui"
      />,
    );
    const name = screen.getByTestId("project-context-name");
    const pathEl = screen.getByTestId("project-context-path");
    expect(name.textContent).toBe("Shipwright WebUI");
    expect(pathEl.textContent).toBe("…/03 Development/shipwright-webui");
    // Tooltip preserves the full path so power users can copy it.
    expect(pathEl.getAttribute("title")).toContain("shipwright-webui");
    expect(pathEl.getAttribute("title")).toContain("C:");
  });

  it("applies whitespace-nowrap to the 'Creating in' label so it doesn't wrap when the modal narrows", () => {
    render(
      <ProjectContextStrip
        name="Shipwright WebUI"
        path="/long/path/to/project"
      />,
    );
    const strip = screen.getByTestId("project-context-strip");
    // The leading "Creating in" span is the second child (icon is first).
    const creatingInSpan = strip.querySelector("span.opacity-85");
    expect(creatingInSpan?.className).toContain("whitespace-nowrap");
    expect(creatingInSpan?.className).toContain("shrink-0");
  });

  it("applies whitespace-nowrap to the project name span", () => {
    render(
      <ProjectContextStrip name="Shipwright WebUI" path="/p/q/r" />,
    );
    const name = screen.getByTestId("project-context-name");
    expect(name.className).toContain("whitespace-nowrap");
    expect(name.className).toContain("shrink-0");
  });

  it("does not render path span when path is missing", () => {
    render(<ProjectContextStrip name="Demo" />);
    expect(screen.queryByTestId("project-context-path")).toBeNull();
  });
});
