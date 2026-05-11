/*
 * headless-probe.test.ts — Iterate C (ADR-087, MEDIUM-B2 fix).
 *
 * Coverage:
 *   - Successful probe returns ok=true + a version string.
 *   - @xterm/headless import failure → ok=false + reason.
 *   - @xterm/addon-serialize import failure → ok=false + reason.
 *   - Missing `Terminal` export (corrupt package) → ok=false.
 *   - Missing `SerializeAddon` export → ok=false.
 *   - Real-package probe smoke (production-mode unit) — guards against
 *     unexpected packaging regressions in the pinned deps.
 */

import { describe, expect, it, vi } from "vitest";
import { probeHeadlessDeps } from "./headless-probe.js";

describe("probeHeadlessDeps — synthetic stub paths", () => {
  it("returns ok=true with a version string when both deps load cleanly", async () => {
    const importer = vi.fn().mockImplementation(async (spec: string) => {
      if (spec === "@xterm/headless") {
        return { default: { Terminal: class {} } };
      }
      if (spec === "@xterm/addon-serialize") {
        return { default: { SerializeAddon: class {} } };
      }
      if (spec === "@xterm/headless/package.json") {
        return { default: { version: "5.5.0" } };
      }
      throw new Error(`unexpected import: ${spec}`);
    });
    const r = await probeHeadlessDeps(importer);
    expect(r.ok).toBe(true);
    expect(r.terminalVersion).toBe("5.5.0");
    expect(r.reason).toBeNull();
  });

  it("returns ok=false when @xterm/headless fails to import", async () => {
    const importer = vi.fn().mockImplementation(async (spec: string) => {
      if (spec === "@xterm/headless") {
        throw new Error("MODULE_NOT_FOUND: cannot find module");
      }
      throw new Error("unreached");
    });
    const r = await probeHeadlessDeps(importer);
    expect(r.ok).toBe(false);
    expect(r.terminalVersion).toBeNull();
    expect(r.reason).toContain("@xterm/headless import failed");
    expect(r.reason).toContain("MODULE_NOT_FOUND");
  });

  it("returns ok=false when @xterm/headless lacks a Terminal export", async () => {
    const importer = vi.fn().mockImplementation(async (spec: string) => {
      if (spec === "@xterm/headless") return { default: {} };
      throw new Error("unreached");
    });
    const r = await probeHeadlessDeps(importer);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("Terminal");
  });

  it("returns ok=false when @xterm/addon-serialize fails to import", async () => {
    const importer = vi.fn().mockImplementation(async (spec: string) => {
      if (spec === "@xterm/headless") {
        return { default: { Terminal: class {} } };
      }
      if (spec === "@xterm/addon-serialize") {
        throw new Error("ENOENT");
      }
      throw new Error("unreached");
    });
    const r = await probeHeadlessDeps(importer);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("addon-serialize");
  });

  it("returns ok=false when addon-serialize lacks SerializeAddon export", async () => {
    const importer = vi.fn().mockImplementation(async (spec: string) => {
      if (spec === "@xterm/headless") {
        return { default: { Terminal: class {} } };
      }
      if (spec === "@xterm/addon-serialize") return { default: {} };
      throw new Error("unreached");
    });
    const r = await probeHeadlessDeps(importer);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("SerializeAddon");
  });

  it("returns ok=true with null version when package.json read fails", async () => {
    const importer = vi.fn().mockImplementation(async (spec: string) => {
      if (spec === "@xterm/headless") {
        return { default: { Terminal: class {} } };
      }
      if (spec === "@xterm/addon-serialize") {
        return { default: { SerializeAddon: class {} } };
      }
      if (spec === "@xterm/headless/package.json") {
        throw new Error("import-attr not supported");
      }
      throw new Error("unreached");
    });
    const r = await probeHeadlessDeps(importer);
    expect(r.ok).toBe(true);
    expect(r.terminalVersion).toBeNull();
  });
});

describe("probeHeadlessDeps — real package smoke", () => {
  it("loads the actual installed @xterm/headless + addon-serialize", async () => {
    // Uses the default importer (no stub) — verifies the production
    // dependencies are present + load through dynamic-import. Without
    // this we could miss a packaging regression where the package
    // *physically* exists in node_modules but its `default.Terminal`
    // is shaped wrong on the runtime path.
    const r = await probeHeadlessDeps();
    expect(r.ok).toBe(true);
    // We don't assert a specific version (the pin may bump in future
    // iterates); just confirm a string came back when the pin is
    // intact.
    expect(typeof r.terminalVersion === "string" || r.terminalVersion === null).toBe(
      true,
    );
  });
});
