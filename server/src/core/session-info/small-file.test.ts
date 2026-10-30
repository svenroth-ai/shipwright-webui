import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { readSmallRegularFile } from "./small-file.js";

const dirs: string[] = [];
function tmp(): string {
  const d = mkdtempSync(path.join(tmpdir(), "small-file-"));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function canSymlink(): boolean {
  const d = tmp();
  writeFileSync(path.join(d, "t"), "x");
  try {
    symlinkSync(path.join(d, "t"), path.join(d, "l"), "file");
    return true;
  } catch {
    return false;
  }
}

describe("readSmallRegularFile", () => {
  it("reads a regular file within the cap", async () => {
    const d = tmp();
    writeFileSync(path.join(d, "a.json"), '{"ok":true}');
    expect(await readSmallRegularFile(path.join(d, "a.json"), 1024)).toBe('{"ok":true}');
  });

  it("refuses a file over the cap, a directory and a missing path", async () => {
    const d = tmp();
    writeFileSync(path.join(d, "big.json"), "x".repeat(2048));
    mkdirSync(path.join(d, "sub"));
    expect(await readSmallRegularFile(path.join(d, "big.json"), 1024)).toBeNull();
    expect(await readSmallRegularFile(path.join(d, "sub"), 1024)).toBeNull();
    expect(await readSmallRegularFile(path.join(d, "nope.json"), 1024)).toBeNull();
  });

  it.skipIf(!canSymlink())("refuses a symlink even when its target is a small regular file", async () => {
    const d = tmp();
    writeFileSync(path.join(d, "target.json"), '{"secret":1}');
    symlinkSync(path.join(d, "target.json"), path.join(d, "link.json"), "file");
    expect(await readSmallRegularFile(path.join(d, "link.json"), 1024)).toBeNull();
  });
});
