/*
 * image-paste.test.ts — unit coverage for the embedded-terminal image-paste
 * server flow (iterate-2026-05-03 / ADR-067).
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";

import {
  MAX_IMAGE_BYTES,
  PASTES_DIR,
  appendGitignoreLine,
  parseFilenameTimestamp,
  pruneKeepLastN,
  savePastedImage,
  sniffImageKind,
} from "./image-paste.js";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x00]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
const WEBP = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
]);
const GIF = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00, 0x00, 0x00]);
const PLAIN_TEXT = new Uint8Array([0x68, 0x65, 0x6c, 0x6c, 0x6f, 0, 0, 0, 0, 0, 0, 0]);

let tmpDir = "";

async function makeTmp(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "embedded-terminal-paste-"));
  return dir;
}

beforeEach(async () => {
  tmpDir = await makeTmp();
});
afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("sniffImageKind — magic-byte detection", () => {
  it("accepts png/jpeg/webp/gif", () => {
    expect(sniffImageKind(PNG)).toBe("png");
    expect(sniffImageKind(JPEG)).toBe("jpeg");
    expect(sniffImageKind(WEBP)).toBe("webp");
    expect(sniffImageKind(GIF)).toBe("gif");
  });
  it("rejects plain text", () => {
    expect(sniffImageKind(PLAIN_TEXT)).toBe(null);
  });
  it("rejects too-short buffers", () => {
    expect(sniffImageKind(new Uint8Array([0x89]))).toBe(null);
  });
});

describe("parseFilenameTimestamp", () => {
  it("returns the ms part for img-<ms>-<hex>.<ext>", () => {
    expect(parseFilenameTimestamp("img-1714776000000-deadbeef.png")).toBe(1714776000000);
    expect(parseFilenameTimestamp("img-42-aaaaaaaa.jpg")).toBe(42);
  });
  it("returns NaN for unrelated filenames", () => {
    expect(Number.isNaN(parseFilenameTimestamp("readme.md"))).toBe(true);
    expect(Number.isNaN(parseFilenameTimestamp("img-no-rand.png"))).toBe(true);
  });
});

describe("savePastedImage", () => {
  it("writes a png with the expected filename pattern under .claude-pastes/", async () => {
    const r = await savePastedImage({ cwd: tmpDir, bytes: PNG, keepLast: 20 });
    expect(r.kind).toBe("png");
    const dir = path.join(tmpDir, PASTES_DIR);
    const entries = await fs.readdir(dir);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatch(/^img-\d+-[0-9a-f]{8}\.png$/);
    expect(r.absolutePath.startsWith(dir)).toBe(true);
  });

  it("rejects unsupported types (no magic-byte match)", async () => {
    await expect(savePastedImage({ cwd: tmpDir, bytes: PLAIN_TEXT, keepLast: 20 })).rejects.toMatchObject({
      code: "unsupported_image_type",
    });
    // Nothing was written.
    await expect(fs.readdir(path.join(tmpDir, PASTES_DIR)).catch(() => [])).resolves.toEqual([]);
  });

  it("rejects oversize blobs (> MAX_IMAGE_BYTES)", async () => {
    const tooBig = new Uint8Array(MAX_IMAGE_BYTES + 1);
    tooBig.set(PNG, 0);
    await expect(savePastedImage({ cwd: tmpDir, bytes: tooBig, keepLast: 20 })).rejects.toMatchObject({
      code: "image_too_large",
    });
  });

  it("after the (N+1)th save, only N files remain (keep-last-N prune)", async () => {
    const dir = path.join(tmpDir, PASTES_DIR);
    for (let i = 0; i < 5; i++) {
      await savePastedImage({ cwd: tmpDir, bytes: PNG, keepLast: 3 });
      // Sleep a millisecond so the filename timestamps differ.
      await new Promise((r) => setTimeout(r, 2));
    }
    const entries = (await fs.readdir(dir)).sort();
    expect(entries.length).toBe(3);
  });

  it("filenames are unique even when called rapidly within the same millisecond", async () => {
    // Force same Date.now() by stubbing.
    const origNow = Date.now;
    Date.now = () => 1_000_000_000_000;
    try {
      const r1 = await savePastedImage({ cwd: tmpDir, bytes: PNG, keepLast: 100 });
      const r2 = await savePastedImage({ cwd: tmpDir, bytes: PNG, keepLast: 100 });
      const r3 = await savePastedImage({ cwd: tmpDir, bytes: PNG, keepLast: 100 });
      const names = new Set([
        path.basename(r1.absolutePath),
        path.basename(r2.absolutePath),
        path.basename(r3.absolutePath),
      ]);
      expect(names.size).toBe(3);
    } finally {
      Date.now = origNow;
    }
  });

  it("gitignoreSuggestion=true when .gitignore exists but does NOT mention .claude-pastes/", async () => {
    await fs.writeFile(path.join(tmpDir, ".gitignore"), "node_modules/\n");
    const r = await savePastedImage({ cwd: tmpDir, bytes: PNG, keepLast: 20 });
    expect(r.gitignoreSuggestion).toBe(true);
  });

  it("gitignoreSuggestion=false when .gitignore already contains .claude-pastes/", async () => {
    await fs.writeFile(path.join(tmpDir, ".gitignore"), "node_modules/\n.claude-pastes/\n");
    const r = await savePastedImage({ cwd: tmpDir, bytes: PNG, keepLast: 20 });
    expect(r.gitignoreSuggestion).toBe(false);
  });

  it("gitignoreSuggestion=false when .gitignore does not exist (we don't propose creating one)", async () => {
    const r = await savePastedImage({ cwd: tmpDir, bytes: PNG, keepLast: 20 });
    expect(r.gitignoreSuggestion).toBe(false);
  });
});

describe("pruneKeepLastN", () => {
  it("is a no-op when count <= n", async () => {
    const dir = path.join(tmpDir, PASTES_DIR);
    await fs.mkdir(dir);
    for (let i = 0; i < 3; i++) {
      await fs.writeFile(path.join(dir, `img-${i}-${"a".repeat(8)}.png`), PNG);
    }
    const r = await pruneKeepLastN(dir, 5);
    expect(r.deleted).toEqual([]);
    expect(r.kept.length).toBe(3);
  });

  it("ignores non-img files in the same dir", async () => {
    const dir = path.join(tmpDir, PASTES_DIR);
    await fs.mkdir(dir);
    await fs.writeFile(path.join(dir, "img-1-aaaaaaaa.png"), PNG);
    await fs.writeFile(path.join(dir, "README.txt"), "doc");
    const r = await pruneKeepLastN(dir, 1);
    expect(r.deleted).toEqual([]);
    expect(r.kept).toEqual(["img-1-aaaaaaaa.png"]);
  });

  it("deletes the oldest by parsed-timestamp primary order", async () => {
    const dir = path.join(tmpDir, PASTES_DIR);
    await fs.mkdir(dir);
    await fs.writeFile(path.join(dir, "img-100-aaaaaaaa.png"), PNG);
    await fs.writeFile(path.join(dir, "img-200-bbbbbbbb.png"), PNG);
    await fs.writeFile(path.join(dir, "img-300-cccccccc.png"), PNG);
    const r = await pruneKeepLastN(dir, 1);
    expect(r.kept).toEqual(["img-300-cccccccc.png"]);
    expect(r.deleted.sort()).toEqual(["img-100-aaaaaaaa.png", "img-200-bbbbbbbb.png"]);
  });
});

describe("appendGitignoreLine", () => {
  it("appends .claude-pastes/ when missing", async () => {
    const gi = path.join(tmpDir, ".gitignore");
    await fs.writeFile(gi, "node_modules/\n");
    const did = await appendGitignoreLine(gi);
    expect(did).toBe(true);
    const after = await fs.readFile(gi, "utf8");
    expect(after).toMatch(/\.claude-pastes\//);
  });

  it("is idempotent — second call is a no-op", async () => {
    const gi = path.join(tmpDir, ".gitignore");
    await fs.writeFile(gi, "node_modules/\n.claude-pastes/\n");
    const did = await appendGitignoreLine(gi);
    expect(did).toBe(false);
  });

  it("returns false when the file is missing (caller decides 404 vs no-op)", async () => {
    const did = await appendGitignoreLine(path.join(tmpDir, "does-not-exist"));
    expect(did).toBe(false);
  });

  it("ensures a leading newline before the appended line when the file lacks a trailing \\n", async () => {
    const gi = path.join(tmpDir, ".gitignore");
    await fs.writeFile(gi, "node_modules/");
    await appendGitignoreLine(gi);
    const after = await fs.readFile(gi, "utf8");
    expect(after).toBe("node_modules/\n.claude-pastes/\n");
  });
});
