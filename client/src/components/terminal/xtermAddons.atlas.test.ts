/*
 * xtermAddons.atlas.test.ts — root-cause regression fence for the WebGL
 * glyph-atlas corruption ("einzelne Wörter mit falschen Buchstaben",
 * user reports 2026-06-27 + 2026-07-07).
 *
 * SYMPTOM: during active rendering single cells show the WRONG glyph — a clean
 * letter-for-letter swap, NOT pixel garbage — and a manual resize heals it
 * (distinct from the hide/show "smear", which is a stale GL FRAMEBUFFER and is
 * already handled by the visibility/focus refresh in useTerminalResize).
 *
 * ROOT CAUSE (2026-07-07, superseding the #175 `term.refresh` approach): the
 * WebGL renderer caches glyphs in a GPU texture-atlas. The LOAD-BEARING corruption
 * is a WHOLE-ATLAS SWAP on a terminal-option change — WebglRenderer._handleOptionsChanged
 * → _refreshCharAtlas fires onChangeTextureAtlas but does NOT clear the render
 * model, so cells keep coordinates into the OLD atlas layout (a clean letter-swap).
 * This fires on the live theme re-resolve (`term.options.theme = <fresh object>`,
 * FR-01.44 #201). `term.refresh` can't heal it because _updateModel skips cells
 * that "look unchanged"; only a manual resize (which clears the model) healed it.
 * (The atlas REPACK path — _mergePages → onRemoveTextureAtlasCanvas — self-heals
 * via _requestClearModel; we still clear on it defensively.)
 *
 * FIX: `attachWebglAtlasRepaint` calls `term.clearTextureAtlas()` — the public
 * equivalent of the resize heal (clears atlas + model + glyph renderer, then a
 * full redraw) — on the two atlas events that reassign EXISTING coordinates
 * (onChangeTextureAtlas + onRemoveTextureAtlasCanvas). Two invariants this fence
 * pins, because getting either wrong makes the "fix" worse than the bug:
 *   1. onAddTextureAtlasCanvas is NOT subscribed. A plain page-add appends new
 *      glyphs to fresh coordinates (no letter-swap), and clearing on add is a
 *      feedback loop: clear → re-raster → page overflow → onAdd → clear → …
 *   2. The clear is DEFERRED (one coalesced microtask), never synchronous —
 *      onRemoveTextureAtlasCanvas fires MID-_mergePages, so a synchronous clear
 *      would tear down the atlas the merge is still mutating.
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
  clearTextureAtlas: ReturnType<typeof vi.fn>;
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
      clearTextureAtlas: vi.fn(),
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

/** Flush the pending microtask the deferred atlas heal schedules. */
const flushMicrotasks = (): Promise<void> => Promise.resolve();

function webglOf(): WebglAddonFake {
  const w = loadedAddons.find(
    (a) =>
      (a as { constructor?: { name?: string } })?.constructor?.name ===
      "WebglAddonFake",
  ) as WebglAddonFake | undefined;
  if (!w) throw new Error("WebGL addon was not loaded");
  return w;
}

describe("xtermAddons — WebGL atlas-corruption heal (clearTextureAtlas fence)", () => {
  beforeEach(() => {
    loadedAddons.length = 0;
    lastTerm = null;
  });
  afterEach(() => vi.clearAllMocks());

  it("subscribes to the coordinate-reassigning events (change + remove) only, NOT add", () => {
    createEmbeddedXterm(document.createElement("div"));
    const webgl = webglOf();
    expect(webgl.onChangeTextureAtlas).toHaveBeenCalledTimes(1);
    expect(webgl.onRemoveTextureAtlasCanvas).toHaveBeenCalledTimes(1);
    // onAdd is a plain append (no coordinate reassignment) AND clearing on it
    // would feedback-loop (clear → re-raster → overflow → onAdd → clear …), so
    // it MUST NOT be subscribed.
    expect(webgl.onAddTextureAtlasCanvas).not.toHaveBeenCalled();
  });

  it("a change or remove mutation heals via a DEFERRED term.clearTextureAtlas()", async () => {
    createEmbeddedXterm(document.createElement("div"));
    const webgl = webglOf();
    // No spurious heal before the atlas actually mutates.
    expect(lastTerm?.clearTextureAtlas).not.toHaveBeenCalled();

    webgl.changeAtlasCb?.();
    // Deferred: the clear must NOT run synchronously inside the event handler
    // (onRemove fires mid-_mergePages — a re-entrant clear would corrupt it).
    expect(lastTerm?.clearTextureAtlas).not.toHaveBeenCalled();
    await flushMicrotasks();
    expect(lastTerm?.clearTextureAtlas).toHaveBeenCalledTimes(1);

    webgl.removeCanvasCb?.();
    await flushMicrotasks();
    expect(lastTerm?.clearTextureAtlas).toHaveBeenCalledTimes(2);

    // We never call refresh anymore — clearTextureAtlas forces its own full redraw.
    expect(lastTerm?.refresh).not.toHaveBeenCalled();
  });

  it("coalesces a burst of atlas mutations in one tick into a single clear", async () => {
    createEmbeddedXterm(document.createElement("div"));
    const webgl = webglOf();
    webgl.changeAtlasCb?.();
    webgl.removeCanvasCb?.();
    webgl.changeAtlasCb?.();
    await flushMicrotasks();
    // One global clear heals every corruption up to this point; a per-event
    // clear would be N full re-rasters for one repack burst.
    expect(lastTerm?.clearTextureAtlas).toHaveBeenCalledTimes(1);
  });

  it("the atlas heal swallows a mid-dispose term throw (no unhandled rejection)", async () => {
    createEmbeddedXterm(document.createElement("div"));
    const webgl = webglOf();
    lastTerm?.clearTextureAtlas.mockImplementation(() => {
      throw new Error("term mid-dispose");
    });
    webgl.changeAtlasCb?.();
    await expect(flushMicrotasks()).resolves.toBeUndefined();
    expect(lastTerm?.clearTextureAtlas).toHaveBeenCalled();
  });

  it("disposing the handle cancels a subsequent heal (no clear on a dead term)", async () => {
    const handle = createEmbeddedXterm(document.createElement("div"));
    const webgl = webglOf();
    handle.dispose();
    webgl.changeAtlasCb?.();
    await flushMicrotasks();
    expect(lastTerm?.clearTextureAtlas).not.toHaveBeenCalled();
  });
});
