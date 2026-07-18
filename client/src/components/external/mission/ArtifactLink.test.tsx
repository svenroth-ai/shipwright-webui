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
