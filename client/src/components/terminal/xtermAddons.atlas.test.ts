/*
 * xtermAddons.atlas.test.ts — root-cause regression fence for the WebGL
 * glyph-atlas corruption ("einzelne Wörter mit falschen Buchstaben",
 * user report 2026-06-27; iterate-2026-06-27-webgl-atlas-glyph-corruption).
 *
 * SYMPTOM: during active rendering single cells show the WRONG glyph — a clean
 * letter-for-letter swap, NOT pixel garbage — and a manual resize heals it
 * (distinct from the hide/show "smear", which is a stale GL FRAMEBUFFER and is
 * already handled by the visibility/focus refresh in useTerminalResize).
 *
 * ROOT CAUSE: the WebGL renderer caches glyphs in a GPU texture-atlas keyed by
 * glyph+fg+bg+style. When the atlas mutates mid-stream — a page added on overflow
 * (onAddTextureAtlasCanvas) or the atlas cleared/repacked (onChangeTextureAtlas) —
 * cells drawn BEFORE the mutation are not re-marked dirty, so they keep sampling
 * their old page/coord; after a repack that coord can hold a DIFFERENT glyph → a
 * clean wrong letter. `term.refresh` re-resolves every visible cell against the
 * CURRENT atlas; the gap is purely TIMING — the existing repaint triggers never
 * fire at atlas-mutation time, so only a manual resize (which marks every cell
 * dirty) healed it.
 *
 * FIX: `createEmbeddedXterm` routes ALL of the addon's atlas-mutation events
 * (change + add + remove) through a single full-viewport `term.refresh(0, rows-1)`
 * (see webgl-atlas-repaint.ts), so the viewport is repainted exactly when the
 * atlas changes — automatically, with no manual resize. Co-located with the
 * `onContextLoss` self-recovery (both are the addon's own staleness handlers).
 *
 * This is the DETERMINISTIC half of the validation; the real-browser half (the
 * live WebGL addon actually emitting the event on a real GPU under load) is
 * e2e flow spec 94.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

// Minimal, atlas-focused mocks (independent of xtermAddons.test.ts so both
// files stay under the 300-LOC guideline). vitest 4 constructs the mock on
// `new`, so each implementation MUST be a real `function` (an arrow throws
// "is not a constructor").
const loadedAddons: unknown[] = [];

interface FakeTerm {
  cols: number;
  rows: number;
  refresh: ReturnType<typeof vi.fn>;
  loadAddon: ReturnType<typeof vi.fn>;
  open: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
  _core: { _renderService: { dimensions: unknown } };
}
let lastTerm: FakeTerm | null = null;

vi.mock("@xterm/xterm", () => ({
  Terminal: vi.fn().mockImplementation(function () {
    const t: FakeTerm = {
      cols: 80,
      rows: 24,
      refresh: vi.fn(),
      loadAddon: vi.fn((addon: unknown) => loadedAddons.push(addon)),
      open: vi.fn(),
      dispose: vi.fn(),
      _core: { _renderService: { dimensions: { existing: true } } },
    };
    lastTerm = t;
    return t;
  }),
}));

class FitAddonFake {
  activate = vi.fn();
  dispose = vi.fn();
  fit = vi.fn();
}
class WebLinksAddonFake {
  activate = vi.fn();
  dispose = vi.fn();
}
class WebglAddonFake {
  activate = vi.fn();
  dispose = vi.fn();
  clearTextureAtlas = vi.fn();
  onContextLoss = vi.fn(() => ({ dispose: vi.fn() }));
  // Mirrors @xterm/addon-webgl 0.19.0 atlas-mutation events → IDisposable. The
  // captured callbacks let a test simulate each mutation the live GPU emits.
  changeAtlasCb: (() => void) | null = null;
  addCanvasCb: (() => void) | null = null;
  removeCanvasCb: (() => void) | null = null;
  onChangeTextureAtlas = vi.fn(function (this: WebglAddonFake, cb: () => void) {
    this.changeAtlasCb = cb;
    return { dispose: vi.fn() };
  });
  onAddTextureAtlasCanvas = vi.fn(function (this: WebglAddonFake, cb: () => void) {
    this.addCanvasCb = cb;
    return { dispose: vi.fn() };
  });
  onRemoveTextureAtlasCanvas = vi.fn(function (this: WebglAddonFake, cb: () => void) {
    this.removeCanvasCb = cb;
    return { dispose: vi.fn() };
  });
}

vi.mock("@xterm/addon-fit", () => ({
  FitAddon: vi.fn().mockImplementation(function () {
    return new FitAddonFake();
  }),
}));
vi.mock("@xterm/addon-web-links", () => ({
  WebLinksAddon: vi.fn().mockImplementation(function () {
    return new WebLinksAddonFake();
  }),
}));
vi.mock("@xterm/addon-webgl", () => ({
  WebglAddon: vi.fn().mockImplementation(function () {
    return new WebglAddonFake();
  }),
}));
vi.mock("@xterm/xterm/css/xterm.css", () => ({}));

import { createEmbeddedXterm } from "./xtermAddons";

function webglOf(): WebglAddonFake {
  const w = loadedAddons.find(
    (a) =>
      (a as { constructor?: { name?: string } })?.constructor?.name ===
      "WebglAddonFake",
  ) as WebglAddonFake | undefined;
  if (!w) throw new Error("WebGL addon was not loaded");
  return w;
}

describe("xtermAddons — WebGL atlas-change full repaint (glyph-corruption fence)", () => {
  beforeEach(() => {
    loadedAddons.length = 0;
    lastTerm = null;
  });
  afterEach(() => vi.clearAllMocks());

  it("subscribes to all three atlas-mutation events exactly once each", () => {
    createEmbeddedXterm(document.createElement("div"));
    const webgl = webglOf();
    expect(webgl.onChangeTextureAtlas).toHaveBeenCalledTimes(1);
    expect(webgl.onAddTextureAtlasCanvas).toHaveBeenCalledTimes(1);
    expect(webgl.onRemoveTextureAtlasCanvas).toHaveBeenCalledTimes(1);
  });

  it("any atlas mutation (change / add / remove) forces a full-viewport term.refresh(0, rows-1)", () => {
    createEmbeddedXterm(document.createElement("div"));
    const webgl = webglOf();
    const lastRow = (lastTerm?.rows ?? 1) - 1;
    // No spurious repaint before the atlas actually mutates.
    expect(lastTerm?.refresh).not.toHaveBeenCalled();
    // Each event the live GPU can emit must trigger a full-viewport repaint —
    // crucially the page-ADD (overflow) path, the long-session corruption case.
    webgl.changeAtlasCb?.();
    expect(lastTerm?.refresh).toHaveBeenLastCalledWith(0, lastRow);
    webgl.addCanvasCb?.();
    expect(lastTerm?.refresh).toHaveBeenLastCalledWith(0, lastRow);
    webgl.removeCanvasCb?.();
    expect(lastTerm?.refresh).toHaveBeenLastCalledWith(0, lastRow);
    expect(lastTerm?.refresh).toHaveBeenCalledTimes(3);
  });

  it("the atlas repaint swallows a mid-dispose term throw (no crash)", () => {
    createEmbeddedXterm(document.createElement("div"));
    const webgl = webglOf();
    lastTerm?.refresh.mockImplementation(() => {
      throw new Error("term mid-dispose");
    });
    expect(() => webgl.changeAtlasCb?.()).not.toThrow();
    expect(() => webgl.addCanvasCb?.()).not.toThrow();
  });
});
