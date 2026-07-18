import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, symlinkSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

import { resolveCampaignsDir, isWithin } from "./campaign-paths.js";

const SEGMENTS = [".shipwright", "planning", "iterate", "campaigns"];

describe("campaign-paths: resolveCampaignsDir", () => {
  let workDir: string;
  let projectDir: string;

  beforeEach(() => {
    workDir = mkdtempSync(path.join(tmpdir(), "campaign-paths-"));
    projectDir = path.join(workDir, "project-a");
    mkdirSync(projectDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  // @covers FR-01.33
  it("rejects synthesized projects", () => {
    const r = resolveCampaignsDir({ path: projectDir, synthesized: true });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.reason).toBe("synthesized_project");
  });

  // @covers FR-01.33
  it("rejects empty path", () => {
    const r = resolveCampaignsDir({ path: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.reason).toBe("missing_project_path");
  });

  // @covers FR-01.33
  it("returns ok+existed:false when the campaigns dir does not exist yet", () => {
    const r = resolveCampaignsDir({ path: projectDir });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.existed).toBe(false);
      expect(r.absolute).toContain("campaigns");
      expect(r.projectRoot).toBeTruthy();
    }
  });

  // @covers FR-01.33
  it("returns ok+existed:true when the campaigns dir exists", () => {
    mkdirSync(path.join(projectDir, ...SEGMENTS), { recursive: true });
    const r = resolveCampaignsDir({ path: projectDir });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.existed).toBe(true);
  });

  // @covers FR-01.33
  it("rejects symlink-escape via a .shipwright dir pointing outside the project", () => {
    const escapeDir = path.join(workDir, "escape");
    mkdirSync(path.join(escapeDir, "planning", "iterate", "campaigns"), {
      recursive: true,
    });
    try {
      symlinkSync(escapeDir, path.join(projectDir, ".shipwright"), "junction");
    } catch (err) {
      // Windows symlinks may require admin; skip on EPERM/EACCES.
      if (
        err instanceof Error &&
        ["EPERM", "EACCES", "EEXIST", "ENOSYS"].includes(
          (err as NodeJS.ErrnoException).code ?? "",
        )
      ) {
        return;
      }
      throw err;
    }
    const r = resolveCampaignsDir({ path: projectDir });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.reason).toBe("path_traversal");
  });

  // @covers FR-01.33
  it("rejects when project.path points at a file", () => {
    const filePath = path.join(workDir, "not-a-dir.txt");
    writeFileSync(filePath, "");
    const r = resolveCampaignsDir({ path: filePath });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.reason).toBe("project_root_not_directory");
  });

  // @covers FR-01.33
  it("missing project root → ok+existed:false (route returns [])", () => {
    const r = resolveCampaignsDir({ path: path.join(workDir, "nope") });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.existed).toBe(false);
  });
});

describe("campaign-paths: isWithin", () => {
  // @covers FR-01.33
  it("accepts the root itself and descendants, rejects escapes", () => {
    const root = path.resolve("/tmp/proj");
    expect(isWithin(root, root)).toBe(true);
    expect(isWithin(root, path.join(root, "a", "b"))).toBe(true);
    expect(isWithin(root, path.resolve("/tmp/other"))).toBe(false);
  });

  // @covers FR-01.33
  it("accepts a descendant whose name merely begins with '..' (not a real escape)", () => {
    const root = path.resolve("/tmp/proj");
    // path.relative(root, root/..safe/x) === "..safe/x" — a leading-".." NAME,
    // not a ".." SEGMENT. Must NOT be treated as an escape.
    expect(isWithin(root, path.join(root, "..safe", "x"))).toBe(true);
    // a genuine one-level escape is still rejected
    expect(isWithin(root, path.dirname(root))).toBe(false);
  });
});
