import type { ILink } from "@xterm/xterm";
import { describe, expect, it } from "vitest";

import { createFileLinkProvider } from "./terminalFileLinkProvider";
import type { LinkTerm } from "./terminalLogicalLine";

/** Fake buffer: rows are strings; `wrapped[i]` = row i is a terminal soft-wrap continuation; "\u4E2D" is width-2. */
function fakeTerm(rows: string[], cols: number, wrapped: boolean[] = []): LinkTerm {
  const line = (i: number) => {
    const text = rows[i];
    if (text === undefined) return undefined;
    const cells: { chars: string; width: number }[] = [];
    for (const ch of Array.from(text)) {
      const w = ch === "\u4E2D" ? 2 : 1;
      cells.push({ chars: ch === "␀" ? "" : ch, width: w }); // U+2400 = a never-written cell
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
  return { cols, hasSelection: () => false, buffer: { active: { getLine: line } } } as unknown as LinkTerm;
}

function links(term: LinkTerm, y: number): ILink[] {
  let out: ILink[] = [];
  createFileLinkProvider(term, () => undefined).provideLinks(y, (l) => {
    out = l ?? [];
  });
  return out;
}

const FULL = "C:\\01_Development\\shipwright-webui\\.worktrees\\campaign\\.shipw";

describe("logical line - app hard wrap (Claude TUI)", () => {
  // @covers FR-01.28
  it("joins a path the TUI broke mid-word at the last column into ONE link, offered on both rows", () => {
    const rows = [`Datei: ${FULL}`, "right\\planning\\campaigns\\MEASURE.md"];
    const term = fakeTerm(rows, rows[0]!.length);
    for (const y of [1, 2]) {
      const l = links(term, y);
      expect(l).toHaveLength(1);
      expect(l[0]!.text).toBe(`${FULL}right\\planning\\campaigns\\MEASURE.md`);
      expect(l[0]!.range.start).toEqual({ x: 8, y: 1 });
      expect(l[0]!.range.end).toEqual({ x: 35, y: 2 });
    }
  });

  // @covers FR-01.28
  it("joins across three rows and skips a small continuation indent", () => {
    const rows = ["see /home/u/projects/aaaa", "  bbbb/cccc/dddd/eeee/fff", "  gggg/hhhh.ts and more"];
    const term = fakeTerm(rows, 25);
    const l = links(term, 2);
    expect(l).toHaveLength(1);
    expect(l[0]!.text).toBe("/home/u/projects/aaaabbbb/cccc/dddd/eeee/fffgggg/hhhh.ts");
  });

  // @covers FR-01.28
  it("maps cells correctly across a wide character before the path", () => {
    const rows = ["\u4E2D /a/b/c/d/e/f", "g/h.ts"];
    const term = fakeTerm(rows, 15);
    const l = links(term, 1);
    expect(l).toHaveLength(1);
    expect(l[0]!.text).toBe("/a/b/c/d/e/fg/h.ts");
    expect(l[0]!.range.start).toEqual({ x: 4, y: 1 });
    expect(l[0]!.range.end).toEqual({ x: 6, y: 2 });
  });

  // @covers FR-01.28
  it("never merges two separate paths on adjacent rows", () => {
    const term = fakeTerm(["/home/u/projects/aaaa.ts", "C:\\other\\bbbb.ts"], 24);
    expect(links(term, 1).map((x) => x.text)).toEqual(["/home/u/projects/aaaa.ts"]);
    expect(links(term, 2).map((x) => x.text)).toEqual(["C:\\other\\bbbb.ts"]);
    const rel = fakeTerm(["/home/u/projects/aaaa.ts", "./other/bbbb.ts"], 24);
    expect(links(rel, 2).map((x) => x.text)).toEqual(["./other/bbbb.ts"]);
    const root = fakeTerm(["/home/u/projects/aaaa.ts", "/etc/hosts.conf"], 24);
    expect(links(root, 1)).toHaveLength(1);
    expect(links(root, 1)[0]!.text).toBe("/home/u/projects/aaaa.ts");
  });

  // @covers FR-01.28
  it("does not join prose, a plain word, a short row, or a URL", () => {
    expect(links(fakeTerm(["/home/u/projects/aaaa.ts", "and then"], 24), 1)[0]!.text).toBe("/home/u/projects/aaaa.ts");
    expect(links(fakeTerm(["/home/u/projects/aaaa.ts", "done"], 24), 1)[0]!.text).toBe("/home/u/projects/aaaa.ts");
    expect(links(fakeTerm(["/home/u/projects/aaaa.ts", "Next."], 24), 1)[0]!.text).toBe("/home/u/projects/aaaa.ts");
    // previous row not filled to the last column
    expect(links(fakeTerm(["src/components/a.ts", "b/c.ts"], 30), 1)[0]!.text).toBe("src/components/a.ts");
    // URL tail
    expect(links(fakeTerm(["see http://host/some/pa", "th/file.html"], 23), 2).map((x) => x.text)).toEqual(["th/file.html"]);
  });

  // @covers FR-01.28
  it("does not merge two relative paths when the first ends in a file extension at the last column", () => {
    const term = fakeTerm(["src/components/aaa.ts", "src/lib/bbb.ts"], 21);
    expect(links(term, 1).map((x) => x.text)).toEqual(["src/components/aaa.ts"]);
    expect(links(term, 2).map((x) => x.text)).toEqual(["src/lib/bbb.ts"]);
  });

  // @covers FR-01.28
  it("never joins a tail that already ends in a file extension", () => {
    expect(links(fakeTerm(["docs/planning/a.md", "  b.md is stale"], 18), 1).map((x) => x.text)).toEqual(["docs/planning/a.md"]);
  });

  // @covers FR-01.28
  it("does not join over a deep indent or a boxed row", () => {
    expect(links(fakeTerm(["/home/u/projects/aaaa/bb", "          cc/dd.ts"], 24), 2).map((x) => x.text)).toEqual(["cc/dd.ts"]);
  });
});

describe("logical line - terminal soft wrap", () => {
  // @covers FR-01.28
  it("joins a path that fills the row exactly and continues on a wrapped row", () => {
    const term = fakeTerm(["/home/u/proj/", "x/y.ts"], 13, [false, true]);
    const l = links(term, 2);
    expect(l).toHaveLength(1);
    expect(l[0]!.text).toBe("/home/u/proj/x/y.ts");
  });

  // @covers FR-01.28
  it("joins a 3-row soft wrap and offers the same single link on the middle row", () => {
    const term = fakeTerm(["/aaaa/bbbb/cccc", "/dddd/eeee/ffff", "/gggg/hhhh.ts"], 15, [false, true, true]);
    for (const y of [1, 2, 3]) {
      const l = links(term, y);
      expect(l).toHaveLength(1);
      expect(l[0]!.text).toBe("/aaaa/bbbb/cccc/dddd/eeee/ffff/gggg/hhhh.ts");
    }
  });

  // @covers FR-01.28
  it("a wide character that did not fit at the last cell inserts no space at the soft wrap", () => {
    const term = fakeTerm(["/aaaa/bbbb/cc␀", "dd/e.ts"], 14, [false, true]);
    expect(links(term, 2)[0]!.text).toBe("/aaaa/bbbb/ccdd/e.ts");
  });

  // @covers FR-01.28
  it("pins the row cap boundary: 20 rows join, 21 rows fall back to the hovered row alone", () => {
    const mk = (n: number) => {
      const rows = [...Array.from({ length: n - 1 }, () => "/aaaa/bbbb/cccc"), "/gggg/hhhh.ts"];
      return fakeTerm(rows, 15, rows.map((_, i) => i > 0));
    };
    expect(links(mk(20), 10)).toHaveLength(1);
    expect(links(mk(20), 10)[0]!.text).toContain("/aaaa/bbbb/cccc/aaaa");
    expect(links(mk(21), 10)).toEqual([]);
    expect(links(mk(21), 21).map((x) => x.text)).toEqual(["/gggg/hhhh.ts"]);
  });

  // @covers FR-01.28
  it("caps the logical line at 20 rows (no links, no runaway)", () => {
    const rows = Array.from({ length: 25 }, () => "/aaaa/bbbb/cccc");
    expect(links(fakeTerm(rows, 15, rows.map((_, i) => i > 0)), 12)).toEqual([]);
    const ok = [...Array.from({ length: 9 }, () => "/aaaa/bbbb/cccc"), "/gggg/hhhh.ts"];
    expect(links(fakeTerm(ok, 15, ok.map((_, i) => i > 0)), 5)).toHaveLength(1);
  });
});
