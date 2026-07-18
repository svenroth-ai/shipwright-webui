/*
 * worktree-roots.test.ts — read-root membership + path guarding (CONTRACT §5.1 c/d).
 *
 * The load-bearing case is the RELOCATED worktree: it lives OUTSIDE the project
 * root, so containment is the wrong test and membership is the right one. These
 * cases pin both directions — the legitimate outside-root worktree is ACCEPTED,
 * a hostile sibling that git does not report is REJECTED.
 *
 * @covers FR-01.66
 */

import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  chooseRoot,
  isRegisteredWorktree,
  readAllowedRoots,
  resolveDocIn,
  resolveFirstDoc,
} from "./worktree-roots.js";

function tmp(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

describe("readAllowedRoots", () => {
  it("parses git worktree list --porcelain into the root set", () => {
    const root = tmp("mc-roots-");
    try {
      const relocated = join(root, "..", "wt-relocated");
      const git = (args: string[]) => {
        expect(args).toEqual(["worktree", "list", "--porcelain"]);
        return [
          `worktree ${root}`,
          "HEAD abc123",
          "branch refs/heads/main",
          "",
          `worktree ${relocated}`,
          "HEAD def456",
          "branch refs/heads/iterate/x",
          "",
        ].join("\n");
      };
      const roots = readAllowedRoots(root, git);
      expect(roots).toHaveLength(2);
      expect(roots[0]).toBe(join(root));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("fails CLOSED to just the project root when git is unavailable", () => {
    const root = tmp("mc-roots-");
    try {
      const git = () => {
        throw new Error("git not found");
      };
      expect(readAllowedRoots(root, git)).toEqual([join(root)]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("worktree membership (the relocated-worktree case)", () => {
  it("ACCEPTS a git-registered worktree that lives OUTSIDE the project root", () => {
    const parent = tmp("mc-parent-");
    const root = join(parent, "repo");
    const relocated = join(parent, "wt-traceability-retrofit");
    mkdirSync(root, { recursive: true });
    mkdirSync(relocated, { recursive: true });
    try {
      const git = () => [`worktree ${root}`, "", `worktree ${relocated}`, ""].join("\n");
      const roots = readAllowedRoots(root, git);
      expect(isRegisteredWorktree(roots, relocated)).toBe(true);
      const chosen = chooseRoot(roots, relocated);
      expect(chosen.isWorktree).toBe(true);
      expect(chosen.root).toBe(relocated);
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  });

  it("REJECTS a sibling directory git does not report, even next to a real worktree", () => {
    const parent = tmp("mc-parent-");
    const root = join(parent, "repo");
    const hostile = join(parent, "wt-hostile");
    mkdirSync(root, { recursive: true });
    mkdirSync(hostile, { recursive: true });
    try {
      const git = () => `worktree ${root}\n\n`;
      const roots = readAllowedRoots(root, git);
      expect(isRegisteredWorktree(roots, hostile)).toBe(false);
      // …and the resolver falls back to the project root rather than reading it.
      expect(chooseRoot(roots, hostile).root).toBe(root);
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  });

  it("falls back to the project root when the registered worktree is gone (post-Finalize)", () => {
    const parent = tmp("mc-parent-");
    const root = join(parent, "repo");
    const pruned = join(parent, "wt-pruned");
    mkdirSync(root, { recursive: true });
    try {
      const git = () => [`worktree ${root}`, "", `worktree ${pruned}`, ""].join("\n");
      const roots = readAllowedRoots(root, git);
      const chosen = chooseRoot(roots, pruned);
      expect(chosen.root).toBe(root);
      expect(chosen.isWorktree).toBe(false);
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  });
});

describe("resolveDocIn", () => {
  it("resolves a known-layout document", () => {
    const root = tmp("mc-doc-");
    try {
      mkdirSync(join(root, ".shipwright", "planning", "iterate", "iterate-x"), { recursive: true });
      writeFileSync(join(root, ".shipwright", "planning", "iterate", "iterate-x", "mini-plan.md"), "# hi");
      const r = resolveDocIn(root, [".shipwright", "planning", "iterate", "iterate-x", "mini-plan.md"]);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.sizeBytes).toBe(4);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("DENIES a traversal that would escape the chosen root", () => {
    const root = tmp("mc-doc-");
    try {
      const r = resolveDocIn(root, ["..", "..", "etc", "passwd"]);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe("denied");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("DENIES a symlink that points outside the root (realPathGuard, TOCTOU class)", () => {
    const parent = tmp("mc-link-");
    const root = join(parent, "repo");
    const outside = join(parent, "outside");
    mkdirSync(root, { recursive: true });
    mkdirSync(outside, { recursive: true });
    writeFileSync(join(outside, "secret.md"), "secret");
    let linked = false;
    try {
      try {
        symlinkSync(join(outside, "secret.md"), join(root, "link.md"), "file");
        linked = true;
      } catch {
        return; // Windows without developer mode — symlink not permitted; skip.
      }
      const r = resolveDocIn(root, ["link.md"]);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe("denied");
    } finally {
      if (!linked) { /* nothing extra to clean */ }
      rmSync(parent, { recursive: true, force: true });
    }
  });

  it("reports not_found (not denied) for a legitimately absent document", () => {
    const root = tmp("mc-doc-");
    try {
      const r = resolveDocIn(root, [".shipwright", "nope.md"]);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe("not_found");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("resolveFirstDoc", () => {
  it("returns the first candidate that exists (worktree layout preference)", () => {
    const root = tmp("mc-cand-");
    try {
      mkdirSync(join(root, ".shipwright", "planning", "iterate"), { recursive: true });
      writeFileSync(join(root, ".shipwright", "planning", "iterate", "2026-07-18-demo.md"), "flat");
      const r = resolveFirstDoc(root, [
        [".shipwright", "planning", "iterate", "iterate-2026-07-18-demo", "mini-plan.md"],
        [".shipwright", "planning", "iterate", "2026-07-18-demo.md"],
      ]);
      expect(r.ok).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("propagates `denied` rather than masking a guard rejection as not_found", () => {
    const root = tmp("mc-cand-");
    try {
      const r = resolveFirstDoc(root, [["..", "escape.md"]]);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe("denied");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
