/*
 * PrLinkCard renderer specs — iterate-2026-05-27 AC2 + iterate-2026-05-30
 * (pr-card-status). `usePrStatus` is mocked so these stay pure unit tests
 * (no QueryClientProvider needed); the real hook → route → gh path is
 * covered by the server pr-status tests + the F0.5 E2E.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { render } from "@testing-library/react";

import { PrLinkCard } from "./PrLinkCard";
import type { PrLinkEvent } from "../../../external/session-parser";
import { usePrStatus } from "../../../hooks/usePrStatus";

vi.mock("../../../hooks/usePrStatus");
const mockUsePrStatus = vi.mocked(usePrStatus);

const validEvent: PrLinkEvent = {
  kind: "pr-link",
  prNumber: 78,
  prUrl: "https://github.com/svenroth-ai/shipwright-webui/pull/78",
  prRepository: "svenroth-ai/shipwright-webui",
  timestamp: "2026-05-27T19:59:59.578Z",
  sessionId: "s",
};

function withStatus(data: unknown) {
  mockUsePrStatus.mockReturnValue({ data } as never);
}

describe("PrLinkCard", () => {
  beforeEach(() => withStatus(undefined));

  it("renders the repo and PR number", () => {
    const { container } = render(<PrLinkCard event={validEvent} />);
    expect(container.textContent).toContain("svenroth-ai/shipwright-webui");
    expect(container.textContent).toContain("#78");
  });

  it("links to the validated prUrl with target=_blank + rel=noopener", () => {
    const { container } = render(<PrLinkCard event={validEvent} />);
    const anchor = container.querySelector("a[data-testid='pr-link-anchor']");
    expect(anchor).not.toBeNull();
    expect(anchor!.getAttribute("href")).toBe(validEvent.prUrl);
    expect(anchor!.getAttribute("target")).toBe("_blank");
    const rel = anchor!.getAttribute("rel") ?? "";
    expect(rel).toContain("noopener");
    expect(rel).toContain("noreferrer");
  });

  it("adopts the assistant-bubble geometry (max-w-[90%], px-3, py-2, text-sm, 14px radius + 4px tail)", () => {
    const { container } = render(<PrLinkCard event={validEvent} />);
    const anchor = container.querySelector(
      "a[data-testid='pr-link-anchor']",
    ) as HTMLAnchorElement;
    const cls = anchor.getAttribute("class") ?? "";
    expect(cls).toContain("max-w-[90%]");
    expect(cls).toContain("px-3");
    expect(cls).toContain("py-2");
    expect(cls).toContain("text-sm");
    expect(anchor.style.borderRadius).toBe("14px");
    expect(anchor.style.borderTopLeftRadius).toBe("4px");
  });

  it("renders a Merged badge when status=merged", () => {
    withStatus({ state: "merged", merged: true });
    const { getByTestId } = render(<PrLinkCard event={validEvent} />);
    expect(getByTestId("pr-state-merged").textContent).toBe("Merged");
  });

  it("renders an Open badge when status=open", () => {
    withStatus({ state: "open", merged: false });
    const { getByTestId } = render(<PrLinkCard event={validEvent} />);
    expect(getByTestId("pr-state-open").textContent).toBe("Open");
  });

  it("renders NO badge when status is unknown or absent", () => {
    withStatus({ state: "unknown", merged: false });
    const { container } = render(<PrLinkCard event={validEvent} />);
    expect(container.querySelector("[data-testid^='pr-state-']")).toBeNull();

    withStatus(undefined);
    const second = render(<PrLinkCard event={validEvent} />);
    expect(
      second.container.querySelector("[data-testid^='pr-state-']"),
    ).toBeNull();
  });

  it("exposes the bubble-shaped data-testid wrapper", () => {
    const { container } = render(<PrLinkCard event={validEvent} />);
    expect(
      container.querySelector("[data-testid='pr-link-card']"),
    ).not.toBeNull();
  });
});
