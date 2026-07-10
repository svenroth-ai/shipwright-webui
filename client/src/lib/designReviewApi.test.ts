import { describe, it, expect } from "vitest";

import {
  isDesignFeedbackMessage,
  designsViewerUrl,
  DESIGN_FEEDBACK_MESSAGE_TYPE,
} from "./designReviewApi";

describe("isDesignFeedbackMessage", () => {
  it("accepts a well-formed feedback envelope", () => {
    expect(
      isDesignFeedbackMessage({ type: DESIGN_FEEDBACK_MESSAGE_TYPE, markdown: "# x" }),
    ).toBe(true);
  });
  it("rejects wrong type / missing markdown / non-objects", () => {
    expect(isDesignFeedbackMessage({ type: "other", markdown: "x" })).toBe(false);
    expect(isDesignFeedbackMessage({ type: DESIGN_FEEDBACK_MESSAGE_TYPE })).toBe(false);
    expect(isDesignFeedbackMessage({ type: DESIGN_FEEDBACK_MESSAGE_TYPE, markdown: 3 })).toBe(false);
    expect(isDesignFeedbackMessage(null)).toBe(false);
    expect(isDesignFeedbackMessage("string")).toBe(false);
  });
});

describe("designsViewerUrl", () => {
  it("is a RELATIVE, encoded /api URL ending in /designs/index.html (plan review R7)", () => {
    expect(designsViewerUrl("p 1/x")).toBe(
      "/api/external/projects/p%201%2Fx/designs/index.html",
    );
  });
});
