/*
 * GET /tasks/:id/session-file?assetOf=<html> — an OUTSIDE html page the session evidences may load the
 * images / stylesheets / fonts that sit in its own folder (iterate-2026-11-02-smartviewer-html-images).
 * The evidence gate stays the boundary: the owner page must be evidenced, the asset must be an allowed
 * type inside the owner's directory tree, and nothing sensitive or dot-prefixed is ever served.
 */
import { describe, expect, it } from "vitest";
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { decideAssetAccess, isBroadFolder, resetOwnerMemo } from "../../core/session-file/asset-access.js";
import { evidenceKey } from "../../core/session-file/evidence.js";
import { app, fx, installFixtures, j, say, session } from "./session-file.fixture.js";
import { assistant, toolUse } from "../../core/session-info/test-fixtures.js";

installFixtures();

const PNG = Buffer.from("89504e470d0a1a0a", "hex");
const asset = (p: string, owner: string, a = app()) =>
  a.request(`/api/external/tasks/t1/session-file?path=${encodeURIComponent(p)}&assetOf=${encodeURIComponent(owner)}`);

function evidenceFor(page: string): void {
  session(assistant(1, { blocks: [toolUse("Write", { file_path: page, content: "<html></html>" })] }));
}

function layout(): { page: string; png: string } {
  const page = path.join(fx.out, "report.html");
  const png = path.join(fx.out, "shot.png");
  writeFileSync(page, "<html></html>");
  writeFileSync(png, PNG);
  return { page, png };
}

describe("session-file assetOf", () => {
  // @covers FR-01.66
  it("serves an image next to an evidenced html page, and refuses it without assetOf", async () => {
    const { page, png } = layout();
    evidenceFor(page);
    const r = await asset(png, page);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("image/png");
    expect(r.headers.get("x-session-file-scope")).toBe("session");
    expect(Buffer.from(await r.arrayBuffer()).equals(PNG)).toBe(true);
    const plain = await app().request(`/api/external/tasks/t1/session-file?path=${encodeURIComponent(png)}`);
    expect(plain.status).toBe(403);
  });

  // @covers FR-01.66
  it("403 when the owner page itself is not evidenced by the session", async () => {
    const { page, png } = layout();
    session(say(1, "nothing relevant"));
    const r = await asset(png, page);
    expect(r.status).toBe(403);
    expect((await j(r)).error).toBe("path_not_evidenced");
  });

  // @covers FR-01.66
  it("serves assets from a sub folder, stylesheets and fonts", async () => {
    const { page } = layout();
    mkdirSync(path.join(fx.out, "img"));
    writeFileSync(path.join(fx.out, "img", "a b.png"), PNG);
    writeFileSync(path.join(fx.out, "mockup.css"), "body{}");
    writeFileSync(path.join(fx.out, "f.woff2"), "wOF2");
    evidenceFor(page);
    for (const [rel, mime] of [
      ["img/a b.png", "image/png"],
      ["mockup.css", "text/plain; charset=utf-8"],
      ["f.woff2", "font/woff2"],
    ] as const) {
      const r = await asset(path.join(fx.out, rel), page);
      expect(r.status, rel).toBe(200);
      expect(r.headers.get("content-type"), rel).toBe(mime);
    }
  });

  // @covers FR-01.66
  it("refuses types that are not images / stylesheets / fonts (scripts, html, text, json)", async () => {
    const { page } = layout();
    for (const n of ["s.js", "o.html", "a.txt", "d.json", "x.md"]) writeFileSync(path.join(fx.out, n), "x");
    evidenceFor(page);
    for (const n of ["s.js", "o.html", "a.txt", "d.json", "x.md"]) {
      const r = await asset(path.join(fx.out, n), page);
      expect(r.status, n).toBe(403);
      expect((await j(r)).error, n).toBe("asset_type_not_allowed");
    }
  });

  // @covers FR-01.66
  it("refuses anything outside the page's folder tree (parent, sibling dir, other absolute path)", async () => {
    const { page } = layout();
    const parentFile = path.join(path.dirname(fx.out), "sf-escape.png");
    writeFileSync(parentFile, PNG);
    try {
      evidenceFor(page);
      for (const p of [parentFile, path.join(fx.out, "..", "sf-escape.png"), path.join(fx.proj, "x.png")]) {
        const r = await asset(p, page);
        expect(r.status, p).toBe(403);
        expect((await j(r)).error, p).toBe("asset_outside_page_folder");
      }
    } finally {
      rmSync(parentFile, { force: true });
    }
  });

  // @covers FR-01.66
  it("refuses dot segments and secret-looking locations below the page folder", async () => {
    const { page } = layout();
    for (const d of [".git", ".ssh", ".hidden"]) {
      mkdirSync(path.join(fx.out, d));
      writeFileSync(path.join(fx.out, d, "x.png"), PNG);
    }
    evidenceFor(page);
    for (const d of [".git", ".ssh", ".hidden"]) {
      const r = await asset(path.join(fx.out, d, "x.png"), page);
      expect(r.status, d).toBe(403);
    }
  });

  // @covers FR-01.66
  it("the owner must be an html page and must be absolute-resolvable", async () => {
    const { png } = layout();
    const note = path.join(fx.out, "note.txt");
    writeFileSync(note, "x");
    evidenceFor(note);
    expect((await asset(png, note)).status).toBe(403);
    expect((await asset(png, "report.html")).status).toBe(403); // relative owner is never an outside page
  });

  // @covers FR-01.66
  it("refuses a symlink that leads out of the page folder", async () => {
    const { page } = layout();
    const target = path.join(path.dirname(fx.out), "sf-linked.png");
    writeFileSync(target, PNG);
    try {
      try {
        symlinkSync(target, path.join(fx.out, "link.png"));
      } catch (err) {
        if (process.env.CI) throw err; // never silently skip in CI
        return; // no symlink privilege on this workstation
      }
      evidenceFor(page);
      expect((await asset(path.join(fx.out, "link.png"), page)).status).toBe(403);
    } finally {
      rmSync(target, { force: true });
    }
  });

  // @covers FR-01.66
  it("a page that sits in a filesystem root or the home directory opens nothing", async () => {
    expect(isBroadFolder(path.parse(process.cwd()).root)).toBe(true);
    expect(isBroadFolder(os.homedir())).toBe(true);
    expect(isBroadFolder(fx.out)).toBe(false);
    const { page, png } = layout();
    evidenceFor(page);
    const saved = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
    process.env.HOME = process.env.USERPROFILE = fx.out; // os.homedir() reads these per call
    try {
      const r = await asset(png, page);
      expect(r.status).toBe(403);
      expect((await j(r)).error).toBe("asset_page_folder_too_broad");
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  });

  // @covers FR-01.66
  it("catch-all folders (home ancestors, temp, Desktop/Documents/Downloads) count as too broad", () => {
    const home = os.homedir();
    expect(isBroadFolder(path.dirname(home))).toBe(true); // the parent of all user profiles
    expect(isBroadFolder(os.tmpdir())).toBe(true);
    for (const d of ["Desktop", "documents", "Downloads"]) expect(isBroadFolder(path.join(home, d)), d).toBe(true);
    expect(isBroadFolder(path.join(home, "Documents", "report"))).toBe(false);
    expect(isBroadFolder(path.join(home, "work"))).toBe(false);
  });

  // @covers FR-01.66
  it("a page reached through a symlinked folder still gets its assets (lexical spelling), but nothing outside it", async () => {
    const { png } = layout();
    const holder = path.join(path.dirname(fx.out), "sf-link-" + path.basename(fx.out));
    try {
      symlinkSync(fx.out, holder, "junction");
    } catch (err) {
      if (process.env.CI) throw err; // never silently skip in CI
      return; // no link privilege on this workstation
    }
    const outside = path.join(path.dirname(fx.out), "sf-outside.png");
    try {
      const viaPage = path.join(holder, "report.html");
      // The session must name BOTH spellings of a page behind a link (access.ts: a symlink hop needs evidence).
      session(
        assistant(1, {
          blocks: [
            toolUse("Write", { file_path: viaPage, content: "x" }),
            toolUse("Write", { file_path: path.join(fx.out, "report.html"), content: "x" }),
          ],
        }),
      );
      expect((await asset(path.join(holder, "shot.png"), viaPage)).status).toBe(200);
      expect((await asset(png, viaPage)).status).toBe(200); // the real spelling of the same file
      writeFileSync(outside, PNG);
      expect((await asset(path.join(holder, "..", "sf-outside.png"), viaPage)).status).toBe(403);
    } finally {
      rmSync(holder, { force: true, recursive: true });
      rmSync(outside, { force: true });
    }
  });

  // @covers FR-01.66
  it("alternate-data-stream, trailing-dot and trailing-space spellings are not assets", async () => {
    const { page } = layout();
    evidenceFor(page);
    for (const n of ["shot.png::$DATA", "shot.png.", "shot.png "]) {
      expect((await asset(path.join(fx.out, n), page)).status, n).toBe(403);
    }
  });

  // @covers FR-01.66
  it("proves the owner page once for a burst of asset requests (one transcript scan, not one per image)", async () => {
    resetOwnerMemo();
    const { page, png } = layout();
    let scans = 0;
    const findEvidence = async (candidates: string[]) => {
      scans++;
      await new Promise((r) => setTimeout(r, 10)); // concurrent callers must join the in-flight decision
      return { found: new Set(candidates.map(evidenceKey)), incomplete: false };
    };
    const ask = () => decideAssetAccess({ roots: [], requested: png, owner: page, findEvidence, memoKey: "t-burst" });
    const results = await Promise.all(Array.from({ length: 40 }, ask));
    expect(results.every((r) => r.ok)).toBe(true);
    expect(scans).toBe(1);
    expect((await ask()).ok).toBe(true);
    expect(scans).toBe(1);
  });

  // @covers FR-01.66
  it("never remembers a refusal: once the session evidences the page the next request succeeds", async () => {
    resetOwnerMemo();
    const { page, png } = layout();
    let evidenced = false;
    const findEvidence = async (candidates: string[]) => ({ found: new Set(evidenced ? candidates.map(evidenceKey) : []), incomplete: false });
    const ask = () => decideAssetAccess({ roots: [], requested: png, owner: page, findEvidence, memoKey: "t-refusal" });
    expect((await ask()).ok).toBe(false);
    evidenced = true;
    expect((await ask()).ok).toBe(true);
  });

  // @covers FR-01.66
  it("an NTFS alternate data stream behind an image extension is refused on Windows", async () => {
    const { page } = layout();
    evidenceFor(page);
    const r = await asset(path.join(fx.out, "notes.txt:evil.png"), page);
    if (process.platform === "win32") expect(r.status).toBe(400);
    else expect(r.status).toBe(404); // a colon is an ordinary filename character elsewhere; the file just does not exist
  });
});
