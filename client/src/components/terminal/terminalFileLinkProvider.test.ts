import type { ILink } from "@xterm/xterm";
import { describe, expect, it, vi } from "vitest";

import { createClickGuard, createFileLinkProvider, type LinkTerm } from "./terminalFileLinkProvider";

/** Fake buffer: each row is a string; `wrapped[i]` marks row i as a soft-wrap continuation; "\u4E2D" is width-2. */
function fakeTerm(rows: string[], cols: number, wrapped: boolean[] = [], selection = false): LinkTerm {
  const line = (i: number) => {
    const text = rows[i];
    if (text === undefined) return undefined;
    const cells: { chars: string; width: number }[] = [];
    for (const ch of Array.from(text)) {
      const w = ch === "\u4E2D" ? 2 : 1;
      cells.push({ chars: ch === "\u2400" ? "" : ch, width: w }); // U+2400 = a never-written (empty) cell
      if (w === 2) cells.push({ chars: "", width: 0 });
    }
    while (cells.length < cols) cells.push({ chars: "", width: 1 });
    return {
      isWrapped: wrapped[i] === true,
      getCell: (x: number) => {
        const c = cells[x];
        return c ? { getWidth: () => c.width, getChars: () => c.chars } : undefined;
      },
    };
  };
  return { cols, hasSelection: () => selection, buffer: { active: { getLine: line } } } as unknown as LinkTerm;
}

const CLICK = { button: 0, detail: 1, clientX: 5, clientY: 5 } as MouseEvent;

function provide(term: LinkTerm, y: number, onActivate = vi.fn()): { links: ILink[]; onActivate: ReturnType<typeof vi.fn> } {
  let links: ILink[] = [];
  createFileLinkProvider(term, onActivate).provideLinks(y, (l) => {
    links = l ?? [];
  });
  return { links, onActivate };
}

describe("createFileLinkProvider", () => {
  // @covers FR-01.28
  it("emits a 1-based inclusive range for a path on one row", () => {
    const { links } = provide(fakeTerm(["ab src/a.ts:12 cd"], 30), 1);
    expect(links).toHaveLength(1);
    expect(links[0]!.text).toBe("src/a.ts:12");
    expect(links[0]!.range).toEqual({ start: { x: 4, y: 1 }, end: { x: 14, y: 1 } });
  });

  // @covers FR-01.28
  it("joins a soft-wrapped path into ONE link spanning both rows, offered on either row", () => {
    const term = fakeTerm(["see src/compo", "nents/a.tsx ok"], 13, [false, true]);
    for (const y of [1, 2]) {
      const { links } = provide(term, y);
      expect(links).toHaveLength(1);
      expect(links[0]!.text).toBe("src/components/a.tsx");
      expect(links[0]!.range.start).toEqual({ x: 5, y: 1 });
      expect(links[0]!.range.end).toEqual({ x: 11, y: 2 });
    }
  });

  // @covers FR-01.28
  it("maps cells correctly after a double-width character", () => {
    const { links } = provide(fakeTerm(["\u4E2D a.ts"], 20), 1);
    expect(links[0]!.range).toEqual({ start: { x: 4, y: 1 }, end: { x: 7, y: 1 } });
  });

  // @covers FR-01.28
  it("offers nothing for a row without paths or a missing row", () => {
    expect(provide(fakeTerm(["hello world"], 20), 1).links).toEqual([]);
    expect(provide(fakeTerm(["x"], 20), 5).links).toEqual([]);
  });

  // @covers FR-01.28
  it("does not offer a link that lies on another row of an unwrapped buffer", () => {
    expect(provide(fakeTerm(["a.ts", "none"], 20), 2).links).toEqual([]);
  });

  // @covers FR-01.28
  it("activates with the parsed ref, and ignores the click while text is selected", () => {
    const a = provide(fakeTerm(["src/a.ts:7"], 20), 1);
    a.links[0]!.activate(CLICK, a.links[0]!.text);
    expect(a.onActivate).toHaveBeenCalledWith({ path: "src/a.ts", line: 7 });

    const b = provide(fakeTerm(["src/a.ts:7"], 20, [], true), 1);
    b.links[0]!.activate(CLICK, b.links[0]!.text);
    expect(b.onActivate).not.toHaveBeenCalled();
  });

  // @covers FR-01.28
  it("joins a wrapped path across a row whose last cell is empty (wide char did not fit)", () => {
    const { links } = provide(fakeTerm(["src/a", "b.ts"], 6, [false, true]), 2);
    // row 1 has 5 chars + 1 empty trailing cell: no space may be inserted at the wrap
    expect(links[0]!.text).toBe("src/ab.ts");
  });

  // @covers FR-01.28
  it("keeps a mid-row empty cell on a wrapped row as a space (two links, not one glued token)", () => {
    // row 1 (soft-wrapped): "a.ts", two never-written cells, "b.md"; the last cell holds a char
    const { links } = provide(fakeTerm(["a.ts\u2400\u2400b.md", "x"], 12, [false, true]), 1);
    expect(links.map((l) => l.text)).toEqual(["a.ts", "b.md"]);
  });

  // @covers FR-01.28
  it("never opens a window itself (web links stay with the web-links addon)", () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const a = provide(fakeTerm(["https://h.test/a.ts src/a.ts"], 40), 1);
    a.links.forEach((l) => l.activate(CLICK, l.text));
    expect(a.links.map((l) => l.text)).toEqual(["src/a.ts"]);
    expect(open).not.toHaveBeenCalled();
    open.mockRestore();
  });

  // @covers FR-01.28
  it("caps the logical line (no unbounded scan of a huge wrapped block)", () => {
    const rows = Array.from({ length: 200 }, () => "x".repeat(10));
    const wrapped = rows.map((_, i) => i > 0);
    expect(provide(fakeTerm(rows, 10, wrapped), 100).links).toEqual([]);
  });
});

describe("createClickGuard", () => {
  const ev = (o: Partial<MouseEvent>) => ({ button: 0, detail: 1, clientX: 10, clientY: 10, ...o }) as MouseEvent;

  // @covers FR-01.28
  it("accepts a still primary single click that followed a mousedown", () => {
    const el = document.createElement("div");
    const g = createClickGuard(el);
    el.dispatchEvent(new MouseEvent("mousedown", { clientX: 10, clientY: 10 }));
    expect(g.isClick(ev({ clientX: 12 }))).toBe(true);
    g.dispose();
  });

  // @covers FR-01.28
  it("rejects a drag, a right/middle click, a multi-click, and a click with no mousedown", () => {
    const el = document.createElement("div");
    const g = createClickGuard(el);
    expect(g.isClick(ev({}))).toBe(false); // no mousedown seen
    el.dispatchEvent(new MouseEvent("mousedown", { clientX: 10, clientY: 10 }));
    expect(g.isClick(ev({ clientX: 40 }))).toBe(false); // dragged
    expect(g.isClick(ev({ button: 2 }))).toBe(false);
    expect(g.isClick(ev({ button: 1 }))).toBe(false);
    expect(g.isClick(ev({ detail: 2 }))).toBe(false);
    g.dispose();
  });

  // @covers FR-01.28
  it("rejects an outward-and-back drag (travelled > 4px even though it ends near the start)", () => {
    const el = document.createElement("div");
    const g = createClickGuard(el);
    el.dispatchEvent(new MouseEvent("mousedown", { clientX: 10, clientY: 10 }));
    el.dispatchEvent(new MouseEvent("mousemove", { clientX: 60, clientY: 10 }));
    el.dispatchEvent(new MouseEvent("mousemove", { clientX: 11, clientY: 10 }));
    expect(g.isClick(ev({ clientX: 11 }))).toBe(false);
    el.dispatchEvent(new MouseEvent("mousedown", { clientX: 10, clientY: 10 })); // a new gesture resets it
    expect(g.isClick(ev({ clientX: 11 }))).toBe(true);
    g.dispose();
  });
});
