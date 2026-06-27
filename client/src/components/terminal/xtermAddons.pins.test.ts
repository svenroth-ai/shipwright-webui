/*
 * xtermAddons.pins — version-pin assertion (CLAUDE.md rule 22), split out of
 * xtermAddons.test.ts to keep both files under the 300-LOC guideline (the atlas-
 * mutation mock additions for iterate-2026-06-27 pushed the parent over).
 *
 * Reads client/package.json via fs and asserts the four xterm packages are
 * EXACT-pinned (no caret/tilde) to the XTERM_PIN constants — the only protection
 * against a stale node_modules causing server/client snapshot version drift
 * (ADR-097/098). TEST-time only, not a runtime import-time throw.
 */

import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

// xtermAddons.ts imports the xterm css; stub it so the module loads under vitest.
vi.mock("@xterm/xterm/css/xterm.css", () => ({}));

import { XTERM_PIN } from "./xtermAddons";

describe("xtermAddons — version-pin assertion (CLAUDE.md rule 22)", () => {
  /**
   * Resolve `client/package.json` relative to THIS test file. Using `__dirname`
   * keeps the path independent of vitest's cwd. The test asserts the
   * package.json literal values match the `XTERM_PIN` constants — a caret prefix
   * (e.g. `"^6.0.0"`) would fail the exact-equal check (the regression fence).
   */
  const packageJson = JSON.parse(
    fs.readFileSync(
      path.resolve(__dirname, "..", "..", "..", "package.json"),
      "utf8",
    ),
  ) as { dependencies: Record<string, string> };

  it("@xterm/xterm is exact-pinned to 6.0.0 (no caret)", () => {
    expect(packageJson.dependencies["@xterm/xterm"]).toBe(
      XTERM_PIN["@xterm/xterm"],
    );
    expect(packageJson.dependencies["@xterm/xterm"]).toBe("6.0.0");
  });
  it("@xterm/addon-fit is exact-pinned to 0.11.0 (no caret)", () => {
    expect(packageJson.dependencies["@xterm/addon-fit"]).toBe(
      XTERM_PIN["@xterm/addon-fit"],
    );
  });
  it("@xterm/addon-web-links is exact-pinned to 0.12.0 (no caret)", () => {
    expect(packageJson.dependencies["@xterm/addon-web-links"]).toBe(
      XTERM_PIN["@xterm/addon-web-links"],
    );
  });
  it("@xterm/addon-webgl is exact-pinned to 0.19.0 (no caret)", () => {
    expect(packageJson.dependencies["@xterm/addon-webgl"]).toBe(
      XTERM_PIN["@xterm/addon-webgl"],
    );
  });
  it("none of the four xterm packages may carry a caret prefix (regression fence)", () => {
    for (const pkg of Object.keys(XTERM_PIN)) {
      const value = packageJson.dependencies[pkg];
      expect(value, `${pkg} version`).toBeDefined();
      expect(
        value.startsWith("^"),
        `${pkg} must be exact-pinned (no caret); got "${value}"`,
      ).toBe(false);
      expect(
        value.startsWith("~"),
        `${pkg} must be exact-pinned (no tilde); got "${value}"`,
      ).toBe(false);
    }
  });
});
