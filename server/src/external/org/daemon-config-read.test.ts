/*
 * daemon-config-read.test.ts — GET /api/external/org/daemon-config, mirrors
 * org-chart.ts's read pattern (fixed path.join(leadsRoot,
 * "daemon-config.json"), inline symlink check). Missing file is NOT an
 * error here (unlike org-chart.ts) — it's the "show a fragment instead"
 * template branch (iterate-2026-09-07-leadwright-setup-wizard, W14).
 */
import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, symlinkSync, lstatSync, writeFileSync as fsWriteFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { daemonConfigReadCore } from "./daemon-config-read.js";

function canCreateFileSymlink(): boolean {
  const probe = mkdtempSync(path.join(tmpdir(), "symcap-"));
  try {
    fsWriteFileSync(path.join(probe, "t"), "x");
    symlinkSync(path.join(probe, "t"), path.join(probe, "l"));
    return lstatSync(path.join(probe, "l")).isSymbolicLink();
  } catch {
    return false;
  } finally {
    rmSync(probe, { recursive: true, force: true });
  }
}
const SYMLINKS_AVAILABLE = canCreateFileSymlink();
const itRealSymlink = SYMLINKS_AVAILABLE ? it : it.skip;

describe("daemonConfigReadCore", () => {
  let dir: string;

  function setup() {
    dir = mkdtempSync(path.join(tmpdir(), "daemon-config-read-test-"));
    return dir;
  }

  it("returns found:false with a computed template when daemon-config.json does not exist", () => {
    const leadsRoot = setup();
    const result = daemonConfigReadCore({ leadsRoot, webuiBaseUrl: "http://localhost:5173" });
    expect(result).toEqual({
      status: 200,
      body: {
        found: false,
        template: {
          orgChartPath: path.join(leadsRoot, "org-chart.json"),
          webuiBaseUrl: "http://localhost:5173",
        },
      },
    });
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns found:true with the parsed config when the file exists", () => {
    const leadsRoot = setup();
    const config = { orgChartPath: "/x/org-chart.json", webuiBaseUrl: "http://x" };
    writeFileSync(path.join(leadsRoot, "daemon-config.json"), JSON.stringify(config));
    const result = daemonConfigReadCore({ leadsRoot, webuiBaseUrl: "http://localhost:5173" });
    expect(result).toEqual({ status: 200, body: { found: true, config } });
    rmSync(dir, { recursive: true, force: true });
  });

  it("502s on a malformed (non-JSON) daemon-config.json — never half-parses a live config", () => {
    const leadsRoot = setup();
    writeFileSync(path.join(leadsRoot, "daemon-config.json"), "not json{");
    const result = daemonConfigReadCore({ leadsRoot, webuiBaseUrl: "http://localhost:5173" });
    expect(result.status).toBe(502);
    rmSync(dir, { recursive: true, force: true });
  });

  it("403s on a symlinked daemon-config.json (host-independent, via injected lstatSync)", () => {
    const leadsRoot = setup();
    const lstatSpy = vi.fn(() => ({ isSymbolicLink: () => true }));
    const result = daemonConfigReadCore({ leadsRoot, webuiBaseUrl: "http://localhost:5173", lstatSync: lstatSpy });
    expect(result.status).toBe(403);
    rmSync(dir, { recursive: true, force: true });
  });

  itRealSymlink(
    "403s on a REAL symlinked daemon-config.json" + (SYMLINKS_AVAILABLE ? "" : " (skipped — no elevation)"),
    () => {
      const leadsRoot = setup();
      const real = path.join(leadsRoot, "real.json");
      writeFileSync(real, "{}");
      symlinkSync(real, path.join(leadsRoot, "daemon-config.json"));
      const result = daemonConfigReadCore({ leadsRoot, webuiBaseUrl: "http://localhost:5173" });
      expect(result.status).toBe(403);
      rmSync(dir, { recursive: true, force: true });
    },
  );
});
