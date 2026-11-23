import { describe, it, expect } from "vitest";
import { decisionKeyOf } from "./orgDecisionKey";

describe("decisionKeyOf (mirror of the server cases)", () => {
  it("reads the marker, the daemon header, or nothing", () => {
    expect(decisionKeyOf("<!-- decisionKey: k-1 -->\n## Proposed 2026-11-20T09:15:00.000Z — k-1\n")).toBe("k-1");
    expect(decisionKeyOf("## Proposed 2026-11-20T09:15:00.000Z — k-2\n\nbody")).toBe("k-2");
    expect(decisionKeyOf("## [2026-11-20T09:15:00.000Z] acme-lead\n\nPlain.\n")).toBeNull();
    expect(decisionKeyOf("<!--decisionKey:   spaced-key  -->\n## [x] y\n")).toBe("spaced-key");
  });
});
