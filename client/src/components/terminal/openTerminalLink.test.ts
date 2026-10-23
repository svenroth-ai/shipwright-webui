import { afterEach, describe, expect, it, vi } from "vitest";

import { openTerminalLink } from "./xtermAddons";

// @covers FR-01.02
describe("openTerminalLink", () => {
  afterEach(() => vi.restoreAllMocks());

  it("opens http(s) links in a new tab with noopener", () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    openTerminalLink("http://127.0.0.1:8765/");
    expect(open).toHaveBeenCalledWith("http://127.0.0.1:8765/", "_blank", "noopener,noreferrer");
  });

  it("ignores non-http schemes", () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    openTerminalLink("javascript:alert(1)");
    openTerminalLink("file:///etc/passwd");
    expect(open).not.toHaveBeenCalled();
  });
});
