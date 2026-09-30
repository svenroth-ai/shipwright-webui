/*
 * The smoke suites' PowerShell probe must be deterministic and fail loud in CI
 * (iterate-2026-09-30-pwsh-probe-flake). child_process is mocked so both the
 * "found after a transient failure" and "never found" paths run on any host.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const spawnSync = vi.fn();
vi.mock("node:child_process", () => ({ spawnSync }));

async function load() {
  vi.resetModules();
  return import("./powershell-probe.smoke-helpers.js");
}

const ok = { status: 0, stdout: Buffer.from("7"), stderr: Buffer.from("") };
const fail = { status: null, signal: "SIGTERM", stdout: Buffer.from(""), stderr: Buffer.from("boom") };

beforeEach(() => {
  spawnSync.mockReset();
  vi.unstubAllEnvs();
});

afterEach(() => vi.unstubAllEnvs());

describe("powershell probe", () => {
  it("retries a transient failure and resolves pwsh", async () => {
    spawnSync.mockReturnValueOnce(fail).mockReturnValueOnce(fail).mockReturnValueOnce(ok);
    const m = await load();
    expect(m.requirePowerShell()).toBe("pwsh");
    expect(spawnSync.mock.calls[0]?.[2].env.POWERSHELL_UPDATECHECK).toBe("Off");
  });

  it("probes once per process: repeated calls do not respawn", async () => {
    spawnSync.mockReturnValue(ok);
    const m = await load();
    m.powershellSkip();
    m.requirePowerShell();
    m.requirePowerShell();
    expect(spawnSync).toHaveBeenCalledTimes(1);
  });

  it("missing PowerShell: skips locally, but FAILS in CI with diagnostics", async () => {
    spawnSync.mockReturnValue({ ...fail, error: undefined });
    vi.stubEnv("CI", "");
    const local = await load();
    expect(local.powershellSkip()).toBe(true);
    vi.stubEnv("CI", "true");
    expect(local.isCi()).toBe(true);
    expect(local.powershellSkip()).toBe(false);
    expect(() => local.requirePowerShell()).toThrow(/required for the real-shell smoke tests[\s\S]*attempt 3 pwsh: status=null signal=SIGTERM stderr=boom/);
  });

  it("reports a spawn error (ENOENT) in the diagnostics", async () => {
    spawnSync.mockReturnValue({ status: null, error: Object.assign(new Error("spawn pwsh ENOENT"), { name: "Error" }) });
    const m = await load();
    expect(() => m.requirePowerShell()).toThrow(/spawn pwsh ENOENT/);
  });

  it("a binary that is simply not installed (ENOENT) is not retried", async () => {
    spawnSync.mockReturnValue({ status: null, error: Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" }) });
    const m = await load();
    expect(() => m.requirePowerShell()).toThrow(/pwsh: not installed \(ENOENT\)/);
    expect(spawnSync).toHaveBeenCalledTimes(2); // pwsh + powershell, once each
  });
});
