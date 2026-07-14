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
 * ROOT CAUSE + FIX (2026-07-07, superseding the #175 `term.refresh` approach):
 * full derivation in the webgl-atlas-repaint.ts header. In short — the render
 * model keeps coordinates into a replaced atlas, and `term.refresh` cannot undo
 * that (it skips cells that "look unchanged"); only `clearTextureAtlas()` clears
 * atlas + model. Two invariants this fence pins, because getting either wrong
 * makes the "fix" worse than the bug:
 *   1. onAddTextureAtlasCanvas is NOT subscribed — clearing on add feedback-loops
 *      (clear → re-raster → page overflow → onAdd → clear → …).
 *   2. The clear is DEFERRED (one coalesced microtask), never synchronous —
 *      onRemoveTextureAtlasCanvas fires MID-_mergePages.
 *
 * iterate-2026-07-14 adds the RE-SHOW half: a background GPU-texture eviction
 * fires NO atlas event (and does not lose the context), so the fence is also
 * exposed as `handle.healAtlas` for the refocus/activation path to call.
 *
 * This is the DETERMINISTIC half of the validation; the real-browser half is
 * e2e flow spec 94.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

// Minimal, atlas-focused mocks (independent of xtermAddons.test.ts). vitest 4
// constructs the mock on `new`, so each implementation MUST be a real
// `function` (an arrow throws "is not a constructor").
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
      loadAddon: vi.fn((addon: unknown) => {
        loadedAddons.push(addon);
        // `loadAddon` is where WebglAddon.activate() runs — a GPU-process
        // restart mid-activation surfaces as a context loss right here.
        if (loseContextOnLoad) {
          (addon as { contextLossCb?: (() => void) | null }).contextLossCb?.();
        }
      }),
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
/** When true, the term mock loses the GPU context DURING `loadAddon`. */
let loseContextOnLoad = false;

class WebglAddonFake {
  activate = vi.fn();
  dispose = vi.fn();
  clearTextureAtlas = vi.fn();
  contextLossCb: (() => void) | null = null;
  onContextLoss = vi.fn(function (this: WebglAddonFake, cb: () => void) {
    this.contextLossCb = cb;
    return { dispose: vi.fn() };
  });
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
import { RENDERER_STORAGE_KEY } from "./terminal-renderer";

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

  // --- The heal as an EXPLICIT handle (iterate-2026-07-14, FR-01.28) ---
  // The re-show path has no atlas-mutation event to ride, so it invokes the SAME
  // fence directly rather than growing a second heal (see the file header).

  it("exposes healAtlas — one deferred, coalesced clear per call", async () => {
    const handle = createEmbeddedXterm(document.createElement("div"));
    expect(handle.healAtlas).toBeTypeOf("function");

    handle.healAtlas?.();
    // Deferred — same fence as the event-driven heal (never re-entrant).
    expect(lastTerm?.clearTextureAtlas).not.toHaveBeenCalled();
    await flushMicrotasks();
    expect(lastTerm?.clearTextureAtlas).toHaveBeenCalledTimes(1);
  });

  it("a burst of healAtlas() calls in one tick collapses into a single clear", async () => {
    const handle = createEmbeddedXterm(document.createElement("div"));
    handle.healAtlas?.();
    handle.healAtlas?.();
    handle.healAtlas?.();
    await flushMicrotasks();
    expect(lastTerm?.clearTextureAtlas).toHaveBeenCalledTimes(1);
  });

  it("healAtlas + a concurrent atlas mutation still yield ONE clear per tick", async () => {
    // openai plan-review #4: prove the clear cannot compound with the
    // event-driven heal (they share one `pending` flag, not two).
    const handle = createEmbeddedXterm(document.createElement("div"));
    const webgl = webglOf();
    handle.healAtlas?.();
    webgl.changeAtlasCb?.();
    await flushMicrotasks();
    expect(lastTerm?.clearTextureAtlas).toHaveBeenCalledTimes(1);
  });

  it("a healAtlas queued before dispose() never lands on the torn-down term", async () => {
    // openai plan-review #5: the real race is a re-show event scheduling a heal
    // immediately before React cleanup runs.
    const handle = createEmbeddedXterm(document.createElement("div"));
    handle.healAtlas?.(); // queued…
    handle.dispose(); // …then the terminal dies before the microtask drains
    await flushMicrotasks();
    expect(lastTerm?.clearTextureAtlas).not.toHaveBeenCalled();
  });

  // --- GPU context loss retracts the heal (external code-review MED) ---
  // The addon disposes and xterm swaps to the DOM renderer: no atlas is left to
  // clear, so a heal must neither run nor be COUNTED (the probe is what e2e
  // spec 94 reads as "the heal fired").

  it("a heal queued just before a context loss is cancelled, not counted", async () => {
    const handle = createEmbeddedXterm(document.createElement("div"));
    const webgl = webglOf();
    handle.healAtlas?.(); // queued on the fence…
    webgl.contextLossCb?.(); // …GPU context dies before the microtask drains
    await flushMicrotasks();
    expect(lastTerm?.clearTextureAtlas).not.toHaveBeenCalled();
  });

  it("healAtlas is inert after a context loss (renderer is DOM now)", async () => {
    const handle = createEmbeddedXterm(document.createElement("div"));
    const webgl = webglOf();
    webgl.contextLossCb?.();
    handle.healAtlas?.();
    await flushMicrotasks();
    expect(lastTerm?.clearTextureAtlas).not.toHaveBeenCalled();
  });

  it("a context loss DURING activation does not resurrect the heal", async () => {
    // The loss fires from inside loadAddon → BEFORE `webglAtlasLive = …`, so an
    // unconditional `true` there would hand out a heal for a dead renderer.
    loseContextOnLoad = true;
    try {
      const handle = createEmbeddedXterm(document.createElement("div"));
      handle.healAtlas?.();
      await flushMicrotasks();
      expect(lastTerm?.clearTextureAtlas).not.toHaveBeenCalled();
    } finally {
      loseContextOnLoad = false;
    }
  });

  it("healAtlas is undefined in the DOM-renderer arm (no atlas to clear)", () => {
    localStorage.setItem(RENDERER_STORAGE_KEY, "dom");
    try {
      const handle = createEmbeddedXterm(document.createElement("div"));
      expect(handle.healAtlas).toBeUndefined();
    } finally {
      localStorage.removeItem(RENDERER_STORAGE_KEY);
    }
  });
});
