/*
 * Unit tests for ModalScrollBody. These assert the CONTRACT (which classes land
 * on the element), not the layout — jsdom has no layout engine, so the geometry
 * is unobservable here. The layout itself is proven in a real browser by
 * e2e/flows/triage-fix-now-more-options-clip.spec.ts. Rationale for the guard:
 * see ModalScrollBody.tsx.
 */

import { describe, it, expect, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { ModalScrollBody } from "./ModalScrollBody";

afterEach(() => {
  cleanup();
});

describe("ModalScrollBody", () => {
  it("always carries the invariant half — scrollbar + the no-shrink guard", () => {
    render(
      <ModalScrollBody data-testid="body">
        <div />
      </ModalScrollBody>,
    );
    const body = screen.getByTestId("body");
    expect(body.className).toContain("overflow-y-auto");
    expect(body.className).toContain("[&>*]:shrink-0");
    expect(body.className).toContain("flex-col");
  });

  it("merges the caller's variable half (height budget + gap) without dropping the guard", () => {
    render(
      <ModalScrollBody
        data-testid="body"
        className="max-h-[calc(100vh-260px)] gap-3.5"
      >
        <div />
      </ModalScrollBody>,
    );
    const body = screen.getByTestId("body");
    expect(body.className).toContain("max-h-[calc(100vh-260px)]");
    expect(body.className).toContain("gap-3.5");
    expect(body.className).toContain("[&>*]:shrink-0");
  });

  it("renders its children", () => {
    render(
      <ModalScrollBody>
        <span data-testid="child">field</span>
      </ModalScrollBody>,
    );
    expect(screen.getByTestId("child")).toBeInTheDocument();
  });
});
