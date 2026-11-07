/*
 * doc-bullets.test.ts — the bullet-drop grammar (events-drop-files, issue 978,
 * unit S5b), pinned to Python `shared/scripts/lib/doc_bullets.py` +
 * `agent_doc_budget.py`: what is a bullet, what is skipped, the fold order.
 *
 * @covers FR-01.47
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { BULLETS_REL, compareBullets, entryAnchor, entryDate, iterEntries, parseBullet, readPendingBullets } from "./doc-bullets.js";

const NAME = "architecture--iterate-2026-11-07-x--0a1b2c3d--11111111.md";

// @covers FR-01.47
describe("parseBullet", () => {
  it("accepts exactly one `- ` line, tolerating CRLF and surrounding newlines", () => {
    expect(parseBullet(NAME, "\r\n- **iterate-2026-11-07-x** a line\r\n")).toEqual({
      target: "architecture", key: "iterate-2026-11-07-x", text: "- **iterate-2026-11-07-x** a line", fileName: NAME,
    });
  });

  it("rejects a bad name, a non-bullet, an empty file and more than one line", () => {
    expect(parseBullet("decisions--x--0a1b2c3d--11111111.md", "- a")).toBeNull();
    expect(parseBullet("architecture--x--0a1b2c3d--1111111.md", "- a")).toBeNull();
    expect(parseBullet("architecture--x--0a1b2c3d--11111111.json", "- a")).toBeNull();
    expect(parseBullet(NAME, "a plain line")).toBeNull();
    expect(parseBullet(NAME, "")).toBeNull();
    expect(parseBullet(NAME, "- one\n- two")).toBeNull();
  });

  it("counts lines like Python splitlines (U+2028, form feed and lone CR break a line)", () => {
    expect(parseBullet(NAME, "- one two")).toBeNull();
    expect(parseBullet(NAME, "- one\ftwo")).toBeNull();
    expect(parseBullet(NAME, "- one\rtwo")).toBeNull();
  });
});

// @covers FR-01.47
describe("entry helpers", () => {
  it("entryDate takes the first VALID paren date", () => {
    expect(entryDate("- x (2026-02-30) (2026-11-07)")).toBe("2026-11-07");
    expect(entryDate("- x 2026-11-07")).toBeNull();
  });

  it("entryAnchor: the leading run/ADR anchor, else the first 60 body characters", () => {
    expect(entryAnchor("- **iterate-2026-11-07-x** text")).toBe("iterate-2026-11-07-x");
    expect(entryAnchor("- **ADR-123** text")).toBe("ADR-123");
    expect(entryAnchor(`- ${"a".repeat(80)}`)).toBe("a".repeat(60));
  });

  it("iterEntries reads top-level blocks of one section only", () => {
    const doc = "# T\n## Architecture Updates\n- one\n  more\n- two\n## Other\n- three\n";
    expect(iterEntries(doc, "## Architecture Updates")).toEqual(["- one\n  more", "- two"]);
    expect(iterEntries(doc, "## Missing")).toEqual([]);
  });

  it("fold order is (date or earliest, key, file name)", () => {
    const b = (key: string, text: string, n: string) => ({ target: "architecture" as const, key, text, fileName: n });
    const sorted = [b("b", "- (2026-11-02)", "z"), b("a", "- (2026-11-02)", "y"), b("c", "- undated", "x")].sort(compareBullets);
    expect(sorted.map((x) => x.key)).toEqual(["c", "a", "b"]);
  });
});

let root = "";
afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
  root = "";
});

// @covers FR-01.47
describe("readPendingBullets", () => {
  it("an absent folder is ok and empty (the legacy layout)", () => {
    root = mkdtempSync(path.join(tmpdir(), "bullets-"));
    expect(readPendingBullets(root)).toEqual({ status: "ok", bullets: [], skipped: [] });
  });

  it("returns valid bullets in fold order and names every skipped file except .gitkeep", () => {
    root = mkdtempSync(path.join(tmpdir(), "bullets-"));
    const dir = path.join(root, ...BULLETS_REL.split("/"));
    mkdirSync(path.join(dir, "sub"), { recursive: true });
    writeFileSync(path.join(dir, "conventions--b--0a1b2c3d--11111111.md"), "- later (2026-11-02)\n");
    writeFileSync(path.join(dir, "architecture--a--0a1b2c3d--22222222.md"), "- earlier (2026-11-01)\n");
    writeFileSync(path.join(dir, "architecture--a--0a1b2c3d--33333333.md"), Buffer.from([0x2d, 0x20, 0xff, 0x0a]));
    writeFileSync(path.join(dir, ".gitkeep"), "");
    const read = readPendingBullets(root);
    expect(read.status).toBe("ok");
    if (read.status !== "ok") return;
    expect(read.bullets.map((b) => b.text)).toEqual(["- earlier (2026-11-01)", "- later (2026-11-02)"]);
    expect(read.skipped.sort()).toEqual(["architecture--a--0a1b2c3d--33333333.md", "sub"]);
  });

  it("a bullets path that is a file, not a folder, is unavailable (never 'none')", () => {
    root = mkdtempSync(path.join(tmpdir(), "bullets-"));
    const dir = path.join(root, ...BULLETS_REL.split("/"));
    mkdirSync(path.dirname(dir), { recursive: true });
    writeFileSync(dir, "not a folder");
    expect(readPendingBullets(root)).toEqual({ status: "unavailable" });
  });
});
