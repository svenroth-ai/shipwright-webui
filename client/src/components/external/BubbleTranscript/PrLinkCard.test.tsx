/*
 * PrLinkCard renderer specs — iterate-2026-05-27-transcript-renderer-scroll AC2.
 *
 * The parser-side defensive scheme guard is covered in
 * `session-parser.test.ts > parseSessionJsonl — pr-link (AC2)`; here
 * we only assert that a parser-validated event renders with the right
 * href, repo/number text, and link safety attributes.
 */

import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";

import { PrLinkCard } from "./PrLinkCard";
import type { PrLinkEvent } from "../../../external/session-parser";

const validEvent: PrLinkEvent = {
  kind: "pr-link",
  prNumber: 78,
  prUrl: "https://github.com/svenroth-ai/shipwright-webui/pull/78",
  prRepository: "svenroth-ai/shipwright-webui",
  timestamp: "2026-05-27T19:59:59.578Z",
  sessionId: "s",
};

describe("PrLinkCard", () => {
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

  it("exposes the bubble-shaped data-testid wrapper", () => {
    const { container } = render(<PrLinkCard event={validEvent} />);
    expect(container.querySelector("[data-testid='pr-link-card']")).not.toBeNull();
  });
});
