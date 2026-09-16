/*
 * AC8 (Spec/codex-light-webui.md) — the combined "at least one engine"
 * readiness gate. Split out of readiness-probe.test.ts (which crossed the
 * 300-line guideline) — same deterministic-seam style as its sibling.
 */

import path from "node:path";

import { describe, it, expect } from "vitest";

import { probeReadiness, shipwrightCacheRoot, type RunFn, type RunResult } from "./readiness-probe.js";

const HOME = path.join("/home", "tester");
const CACHE_ROOT = shipwrightCacheRoot(HOME);
const CANARY = path.join(CACHE_ROOT, "shared", "scripts", "hooks", "capture_session_id.py");

function okRun(version: string): RunResult {
  return { ok: true, stdout: `tool ${version}`, stderr: "", code: 0 };
}
const NOT_FOUND: RunResult = { ok: false, stdout: "", stderr: "", code: null };

const allToolsRun: RunFn = async (cmd) => {
  if (cmd === "python3") return okRun("3.13.1");
  return okRun("2.0.0");
};

function healthyFs() {
  return {
    existsFn: (p: string) => p === CANARY,
    readdirFn: (p: string) =>
      p === CACHE_ROOT
        ? ["shipwright-iterate", "shipwright-grade", "shipwright-adopt", "shared", "plugins"]
        : [],
  };
}

describe("probeReadiness — AC8 combined engine gate", () => {
  // @covers FR-01.51 — AC8: the per-task toggle means either CLI suffices.
  it("Claude CLI absent but Codex CLI present → still ready (combined engine gate)", async () => {
    const r = await probeReadiness({
      run: allToolsRun, // codex resolves via the generic mock → ok
      homeDir: HOME,
      claude: { supported: false, raw: "", minSupported: "2.0.0" },
      ...healthyFs(),
    });
    const claude = r.checks.find((c) => c.key === "claude");
    const codex = r.checks.find((c) => c.key === "codex");
    expect(claude?.ok).toBe(false);
    expect(codex?.ok).toBe(true);
    expect(r.ready).toBe(true);
  });

  // @covers FR-01.51 — AC8: both engines absent → not ready, neither individually critical.
  it("both Claude and Codex CLI absent → not ready", async () => {
    const run: RunFn = async (cmd) =>
      cmd === "codex" ? NOT_FOUND : cmd === "python3" ? okRun("3.13.1") : okRun("2.0.0");
    const r = await probeReadiness({
      run,
      homeDir: HOME,
      claude: { supported: false, raw: "", minSupported: "2.0.0" },
      ...healthyFs(),
    });
    expect(r.checks.find((c) => c.key === "claude")?.ok).toBe(false);
    expect(r.checks.find((c) => c.key === "codex")?.ok).toBe(false);
    expect(r.ready).toBe(false);
  });

  // @covers FR-01.51 — codex, like the other toolchain checks, gets an
  // OS-aware install hint when absent (never fabricated, per readiness-
  // install-hints.ts's own doc comment on the "codex" case).
  it("Codex CLI absent → carries an install hint", async () => {
    const run: RunFn = async (cmd) => (cmd === "codex" ? NOT_FOUND : allToolsRun(cmd));
    const r = await probeReadiness({ run, homeDir: HOME, claude: { supported: true, raw: "2.1.9", minSupported: "2.0.0" }, ...healthyFs() });
    const codex = r.checks.find((c) => c.key === "codex");
    expect(codex?.ok).toBe(false);
    expect(codex?.hint).toBeTruthy();
  });
});
