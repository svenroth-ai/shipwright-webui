/*
 * ArtifactLink.test.tsx — the rail node's 5-state rendering (CONTRACT §6/§8).
 *
 * The contract worth pinning: an `unavailable` artifact is VISIBLE but INERT.
 * It must not be a button that does nothing when pressed, and it must not be
 * hidden — it means "this should exist and could not be read".
 *
 * @covers FR-01.66
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { ArtifactLink } from "./ArtifactLink";
import type { ArtifactDescriptor, ArtifactState } from "../../../lib/missionContextApi";

function artifact(state: ArtifactState, over: Partial<ArtifactDescriptor> = {}): ArtifactDescriptor {
  return {
    kind: "spec",
    label: "Spec",
    state,
    summary: null,
    receipt: state === "available" ? "mini-plan.md" : null,
    detail: null,
    ...over,
  } as ArtifactDescriptor;
}

describe("available artifact", () => {
  it("renders as a button and fires onClick", () => {
    const onClick = vi.fn();
    render(<ArtifactLink artifact={artifact("available")} active={false} onClick={onClick} />);
    const node = screen.getByTestId("artifact-link-spec");
    expect(node.tagName).toBe("BUTTON");
    fireEvent.click(node);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("shows the receipt and marks the active node", () => {
    render(<ArtifactLink artifact={artifact("available")} active onClick={vi.fn()} />);
    const node = screen.getByTestId("artifact-link-spec");
    expect(node).toHaveTextContent("mini-plan.md");
    expect(node.className).toContain("active");
  });
});

describe("unavailable artifact", () => {
  it("is VISIBLE but NOT a button (inert, not a dead button)", () => {
    const onClick = vi.fn();
    render(
      <ArtifactLink
        artifact={artifact("unavailable", { note: "The run record could not be read." })}
        active={false}
        onClick={onClick}
      />,
    );
    const node = screen.getByTestId("artifact-link-spec");
    expect(node.tagName).not.toBe("BUTTON");
    expect(node).toHaveTextContent("The run record could not be read.");
    fireEvent.click(node);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("carries a non-visual state word (a11y — state never rides colour alone)", () => {
    render(<ArtifactLink artifact={artifact("unavailable")} active={false} onClick={vi.fn()} />);
    expect(screen.getByTestId("artifact-link-spec")).toHaveAttribute(
      "aria-label",
      expect.stringContaining("currently unavailable"),
    );
  });

  it("exposes the raw state for styling + E2E assertions", () => {
    render(<ArtifactLink artifact={artifact("error")} active={false} onClick={vi.fn()} />);
    expect(screen.getByTestId("artifact-link-spec")).toHaveAttribute("data-state", "error");
  });
});

/*
 * A run IN FLIGHT (iterate-2026-07-21). `not_yet_created` is shown as a plain
 * pending entry instead of being hidden — otherwise the rail is empty for the
 * whole early phase of every run. It must stay INERT, must say so in words a
 * non-expert reads, and must never be confused with a read failure.
 */
describe("pending artifact (the run is still going)", () => {
  it("says 'Not written yet' in plain words and is inert", () => {
    const onClick = vi.fn();
    render(
      <ArtifactLink
        artifact={artifact("not_yet_created")}
        active={false}
        onClick={onClick}
        runLive
      />,
    );
    const node = screen.getByTestId("artifact-link-spec");
    expect(node.tagName).not.toBe("BUTTON");
    expect(node).toHaveTextContent("Not written yet");
    fireEvent.click(node);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("carries the pending state word for screen readers", () => {
    render(
      <ArtifactLink artifact={artifact("not_yet_created")} active={false} onClick={vi.fn()} runLive />,
    );
    expect(screen.getByTestId("artifact-link-spec")).toHaveAttribute(
      "aria-label",
      expect.stringContaining("not written yet"),
    );
  });

  it("does NOT relabel a read failure as pending, even while live", () => {
    render(
      <ArtifactLink
        artifact={artifact("unavailable", { note: "The run record could not be read." })}
        active={false}
        onClick={vi.fn()}
        runLive
      />,
    );
    const node = screen.getByTestId("artifact-link-spec");
    expect(node).toHaveTextContent("The run record could not be read.");
    expect(node).not.toHaveTextContent("Not written yet");
    expect(node).toHaveAttribute("aria-label", expect.stringContaining("currently unavailable"));
  });

  it("shows nothing extra when the run is NOT live (hide-empty still owns it)", () => {
    render(
      <ArtifactLink artifact={artifact("not_yet_created")} active={false} onClick={vi.fn()} />,
    );
    expect(screen.getByTestId("artifact-link-spec")).not.toHaveTextContent("Not written yet");
  });
});
