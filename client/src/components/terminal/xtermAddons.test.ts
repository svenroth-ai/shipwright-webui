/*
 * xtermAddons — unit tests (Campaign C / C5).
 *
 * Three concerns:
 *  1. Version-pin assertion: read `client/package.json` via fs and assert
 *     the four xterm packages are EXACT-pinned (no caret) to CLAUDE.md
 *     rule 22 values. Failure here is the only protection against a stale
 *     `node_modules` causing server/client snapshot version drift
 *     (ADR-097/098). Plan-review openai #4+#5 MED — TEST-time only, not
 *     a runtime import-time throw.
 *
 *  2. Terminal-options invariants — convertEol:false (Bug B fence),
 *     no windowsMode (xterm 6.x removed it), allowProposedApi:true,
 *     rescaleOverlappingGlyphs:true, VS Code selection knobs.
 *
 *  3. Factory wiring — `createEmbeddedXterm(container)` returns
 *     `{ term, fit, dispose }`; WebGL addon is loaded BEFORE `term.open`
 *     (ADR-099 canonical ordering); the disposer is bound to the term.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";

// --- Spy on the xterm constructor + addons ---------------------------------
// Track call order across @xterm/xterm + @xterm/addon-webgl so we can prove
// WebGL is loaded BEFORE term.open(). The Terminal instance is a minimal
// object — open / loadAddon / dispose / etc. all need to be observable spies.
const callLog: string[] = [];
const loadedAddons: unknown[] = [];
let capturedOptions: Record<string, unknown> | null = null;

vi.mock("@xterm/xterm", () => ({
  // vitest 4 constructs the implementation on `new`, so it must be a real
  // (constructable) function — an arrow throws "is not a constructor".
  Terminal: vi.fn().mockImplementation(function (opts?: Record<string, unknown>) {
    capturedOptions = opts ?? null;
    return {
      cols: 120,
      rows: 30,
      loadAddon: vi.fn((addon: unknown) => {
        loadedAddons.push(addon);
        const tag =
          (addon as { constructor?: { name?: string } })?.constructor?.name ??
          "anon";
        callLog.push(`loadAddon:${tag}`);
      }),
      open: vi.fn(() => {
        callLog.push("open");
      }),
      dispose: vi.fn(() => {
        callLog.push("dispose");
      }),
      write: vi.fn(),
      focus: vi.fn(),
      // _core surface for the dimensions-stub guard.
      _core: { _renderService: { dimensions: { existing: true } } },
    };
  }),
}));

class FitAddonFake {
  fit = vi.fn(() => {
    callLog.push("fit");
  });
  activate = vi.fn();
  dispose = vi.fn();
}
class WebLinksAddonFake {
  activate = vi.fn();
  dispose = vi.fn();
}
class WebglAddonFake {
  activate = vi.fn();
  dispose = vi.fn();
  // Mirrors @xterm/addon-webgl 0.19.0: onContextLoss(listener) → IDisposable.
  contextLossCb: ((e?: unknown) => void) | null = null;
  onContextLoss = vi.fn((cb: (e?: unknown) => void) => {
    this.contextLossCb = cb;
    return { dispose: vi.fn() };
  });
}

vi.mock("@xterm/addon-fit", () => ({
  FitAddon: vi.fn().mockImplementation(function () { return new FitAddonFake(); }),
}));
vi.mock("@xterm/addon-web-links", () => ({
  WebLinksAddon: vi.fn().mockImplementation(function () { return new WebLinksAddonFake(); }),
}));
vi.mock("@xterm/addon-webgl", () => ({
  WebglAddon: vi.fn().mockImplementation(function () { return new WebglAddonFake(); }),
}));
vi.mock("@xterm/xterm/css/xterm.css", () => ({}));

import {
  XTERM_PIN,
  buildEmbeddedXtermOptions,
  createEmbeddedXterm,
} from "./xtermAddons";

describe("xtermAddons — version-pin assertion (CLAUDE.md rule 22)", () => {
  /**
   * Resolve `client/package.json` relative to THIS test file
   * (`client/src/components/terminal/xtermAddons.test.ts`). Using
   * `__dirname` keeps the path independent of vitest's cwd.
   *
   * The test asserts the package.json literal values match the
   * `XTERM_PIN` constants. A caret prefix (e.g. `"^6.0.0"`) would fail
   * the exact-equal check — that's the regression fence.
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

describe("xtermAddons — terminal options invariants", () => {
  it("convertEol: false (Bug B regression fence — memory `project_bug_b_remount_smear_writerace`)", () => {
    const opts = buildEmbeddedXtermOptions();
    expect(opts.convertEol).toBe(false);
  });
  it("does NOT carry `windowsMode` (CLAUDE.md rule 22 — removed in xterm 6.x)", () => {
    const opts = buildEmbeddedXtermOptions() as Record<string, unknown>;
    expect("windowsMode" in opts).toBe(false);
  });
  it("rescaleOverlappingGlyphs: true (ADR-099 fence)", () => {
    const opts = buildEmbeddedXtermOptions();
    expect(opts.rescaleOverlappingGlyphs).toBe(true);
  });
  it("allowProposedApi: true (ADR-093 fence)", () => {
    const opts = buildEmbeddedXtermOptions();
    expect(opts.allowProposedApi).toBe(true);
  });
  it("scrollback: 10000", () => {
    const opts = buildEmbeddedXtermOptions();
    expect(opts.scrollback).toBe(10000);
  });
  it("rightClickSelectsWord: true (VS Code parity, iterate-2026-05-23)", () => {
    const opts = buildEmbeddedXtermOptions();
    expect(opts.rightClickSelectsWord).toBe(true);
  });
  it("macOptionClickForcesSelection: true (VS Code parity)", () => {
    const opts = buildEmbeddedXtermOptions();
    expect(opts.macOptionClickForcesSelection).toBe(true);
  });
  it("wordSeparator matches VS Code's terminalWordSeparators default", () => {
    const opts = buildEmbeddedXtermOptions();
    expect(opts.wordSeparator).toBe(" ()[]{}',\"`|;:!?");
  });
  it("theme palette has cream foreground on dark background", () => {
    // Spot-check the slots most likely to regress if EMBEDDED_TERMINAL_PALETTE
    // gets accidentally swapped to the brand palette (the original Bug A).
    const opts = buildEmbeddedXtermOptions();
    expect(opts.theme?.background).toBe("#1a1a1a");
    expect(opts.theme?.foreground).toBe("#f5f0eb");
  });
});

describe("xtermAddons — createEmbeddedXterm factory", () => {
  beforeEach(() => {
    callLog.length = 0;
    loadedAddons.length = 0;
    capturedOptions = null;
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns { term, fit, dispose }", () => {
    const container = document.createElement("div");
    const handle = createEmbeddedXterm(container);
    expect(handle.term).toBeDefined();
    expect(handle.fit).toBeDefined();
    expect(typeof handle.dispose).toBe("function");
  });

  it("loads WebGL addon BEFORE term.open(container) (ADR-099 canonical ordering)", () => {
    const container = document.createElement("div");
    createEmbeddedXterm(container);
    const openIdx = callLog.indexOf("open");
    const webglLoadIdx = callLog.findIndex(
      (entry) => entry === "loadAddon:WebglAddonFake",
    );
    expect(openIdx).toBeGreaterThan(-1);
    expect(webglLoadIdx).toBeGreaterThan(-1);
    expect(webglLoadIdx).toBeLessThan(openIdx);
  });

  it("loads FitAddon AND WebLinksAddon before open (canonical demo order)", () => {
    const container = document.createElement("div");
    createEmbeddedXterm(container);
    const openIdx = callLog.indexOf("open");
    const fitIdx = callLog.findIndex((e) => e === "loadAddon:FitAddonFake");
    const linksIdx = callLog.findIndex(
      (e) => e === "loadAddon:WebLinksAddonFake",
    );
    expect(fitIdx).toBeGreaterThan(-1);
    expect(linksIdx).toBeGreaterThan(-1);
    expect(fitIdx).toBeLessThan(openIdx);
    expect(linksIdx).toBeLessThan(openIdx);
  });

  it("initial fit() runs after open()", () => {
    const container = document.createElement("div");
    createEmbeddedXterm(container);
    const openIdx = callLog.indexOf("open");
    const fitIdx = callLog.indexOf("fit");
    expect(openIdx).toBeGreaterThan(-1);
    expect(fitIdx).toBeGreaterThan(-1);
    expect(fitIdx).toBeGreaterThan(openIdx);
  });

  it("captured Terminal options reflect buildEmbeddedXtermOptions()", () => {
    const container = document.createElement("div");
    createEmbeddedXterm(container);
    expect(capturedOptions).not.toBeNull();
    expect(capturedOptions?.convertEol).toBe(false);
    expect(capturedOptions?.allowProposedApi).toBe(true);
    expect(capturedOptions?.rescaleOverlappingGlyphs).toBe(true);
    expect("windowsMode" in (capturedOptions ?? {})).toBe(false);
  });

  it("bound dispose() calls term.dispose() — installs dimensions-stub first", () => {
    const container = document.createElement("div");
    const handle = createEmbeddedXterm(container);
    handle.dispose();
    expect(callLog).toContain("dispose");
  });

  it("registers a WebGL onContextLoss handler that disposes the addon (GPU-context-loss recovery)", () => {
    const container = document.createElement("div");
    createEmbeddedXterm(container);
    const webgl = loadedAddons.find(
      (a) => (a as { constructor?: { name?: string } })?.constructor?.name === "WebglAddonFake",
    ) as WebglAddonFake | undefined;
    expect(webgl).toBeDefined();
    // Handler registered exactly once.
    expect(webgl?.onContextLoss).toHaveBeenCalledTimes(1);
    expect(webgl?.contextLossCb).toBeTypeOf("function");
    // Firing the handler (simulated GPU context loss) disposes the WebGL addon
    // → xterm falls back to the DOM renderer instead of a frozen smear.
    expect(webgl?.dispose).not.toHaveBeenCalled();
    webgl?.contextLossCb?.();
    expect(webgl?.dispose).toHaveBeenCalledTimes(1);
  });

  it("WebGL constructor throwing falls back gracefully (Canvas/DOM fallback path)", async () => {
    // Re-mock WebglAddon to throw — simulates jsdom / WebGL-off / blacklisted GPU.
    vi.doMock("@xterm/addon-webgl", () => ({
      WebglAddon: vi.fn().mockImplementation(() => {
        throw new Error("WebGL is not available");
      }),
    }));
    vi.resetModules();
    const { createEmbeddedXterm: createX } = await import("./xtermAddons");
    const container = document.createElement("div");
    expect(() => createX(container)).not.toThrow();
    // Restore happy-path mock for any subsequent test in this run.
    vi.doUnmock("@xterm/addon-webgl");
    vi.resetModules();
  });
});
