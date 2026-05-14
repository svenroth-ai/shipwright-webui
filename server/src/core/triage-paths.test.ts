import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  mkdirSync,
  symlinkSync,
} from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

import { resolveTriagePath } from "./triage-paths.js";

describe("triage-paths: resolveTriagePath", () => {
  let workDir: string;
  let projectDir: string;

  beforeEach(() => {
    workDir = mkdtempSync(path.join(tmpdir(), "triage-paths-"));
    projectDir = path.join(workDir, "project-a");
    mkdirSync(projectDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  it("rejects synthesized projects", () => {
    const result = resolveTriagePath({ path: projectDir, synthesized: true });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.reason).toBe("synthesized_project");
    }
  });

  it("rejects empty path", () => {
    const result = resolveTriagePath({ path: "" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.reason).toBe("missing_project_path");
    }
  });

  it("returns valid path even when triage.jsonl does not yet exist", () => {
    const result = resolveTriagePath({ path: projectDir });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.existed).toBe(false);
      expect(result.absolute).toContain(".shipwright");
      expect(result.absolute).toContain("triage.jsonl");
    }
  });

  it("returns valid path when triage.jsonl exists", () => {
    mkdirSync(path.join(projectDir, ".shipwright"));
    writeFileSync(
      path.join(projectDir, ".shipwright", "triage.jsonl"),
      `{"v":1,"schema":"triage","created":"2026-05-13T08:00:00Z"}\n`,
    );
    const result = resolveTriagePath({ path: projectDir });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.existed).toBe(true);
    }
  });

  it("rejects symlink-escape via .shipwright dir pointing outside project", () => {
    // Set up: <project>/.shipwright is a symlink to /tmp/escape
    const escapeDir = path.join(workDir, "escape");
    mkdirSync(escapeDir);
    writeFileSync(
      path.join(escapeDir, "triage.jsonl"),
      `{"v":1,"schema":"triage","created":"2026-05-13T08:00:00Z"}\n`,
    );
    try {
      symlinkSync(escapeDir, path.join(projectDir, ".shipwright"), "junction");
    } catch (err) {
      // Windows symlinks may require admin; skip on EACCES/EPERM
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

    const result = resolveTriagePath({ path: projectDir });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.reason).toBe("path_traversal");
    }
  });

  it("rejects when project.path points at a file, not a directory", () => {
    const filePath = path.join(workDir, "not-a-dir.txt");
    writeFileSync(filePath, "");
    const result = resolveTriagePath({ path: filePath });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.reason).toBe("project_root_not_directory");
    }
  });

  it("missing project root returns existed=false but ok=true (route layer 404s separately)", () => {
    const missing = path.join(workDir, "does-not-exist");
    const result = resolveTriagePath({ path: missing });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.existed).toBe(false);
    }
  });
});
