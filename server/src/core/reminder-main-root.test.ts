import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { resolveMainCheckout } from "./reminder-main-root.js";

describe("resolveMainCheckout", () => {
  const base = mkdtempSync(path.join(os.tmpdir(), "rem-root-"));
  afterAll(() => rmSync(base, { recursive: true, force: true }));

  // @covers FR-01.04
  it("returns a normal checkout and a missing path unchanged", () => {
    const normal = path.join(base, "normal");
    mkdirSync(path.join(normal, ".git"), { recursive: true });
    expect(resolveMainCheckout(normal)).toBe(normal);
    expect(resolveMainCheckout(path.join(base, "nope"))).toBe(path.join(base, "nope"));
  });

  // @covers FR-01.04
  it("maps a linked worktree to the main checkout", () => {
    const main = path.join(base, "main");
    const wt = path.join(base, "wt");
    mkdirSync(path.join(main, ".git", "worktrees", "wt"), { recursive: true });
    mkdirSync(wt, { recursive: true });
    writeFileSync(path.join(wt, ".git"), `gitdir: ${path.join(main, ".git", "worktrees", "wt")}\n`);
    expect(resolveMainCheckout(wt)).toBe(main);
  });

  // @covers FR-01.04
  it("leaves a submodule-shaped or garbled .git file alone", () => {
    const sub = path.join(base, "sub");
    mkdirSync(sub, { recursive: true });
    writeFileSync(path.join(sub, ".git"), "gitdir: ../.git/modules/sub\n");
    expect(resolveMainCheckout(sub)).toBe(sub);
    writeFileSync(path.join(sub, ".git"), "garbage");
    expect(resolveMainCheckout(sub)).toBe(sub);
  });
});
