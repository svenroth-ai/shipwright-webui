/*
 * powershell-probe.smoke-helpers.ts — the ONE place the real-shell smoke
 * tests decide whether (and which) PowerShell is available.
 *
 * Why this exists (iterate-2026-09-30-pwsh-probe-flake): both smoke suites
 * used to probe with `it.skipIf(!findPowerShell())` (evaluated at COLLECTION)
 * plus a second probe in `beforeAll`. Those are independent process spawns, so
 * one could succeed while the other failed — the test then RAN but held
 * `null` and died with "No PowerShell available" / a null passed to spawn
 * (PR #496, Diff coverage job). pwsh was on the image the whole time. The
 * fix is to probe ONCE per test file (module instance), retry a transient failure, and keep the
 * failure diagnosable.
 *
 * Contract: `powershellSkip()` is the skipIf predicate — false in CI, so a
 * missing PowerShell FAILS there (never a silent skip) via `requirePowerShell()`
 * with the captured diagnostics. Locally (no pwsh) the tests skip as before.
 */

import { spawnSync } from "node:child_process";

const PROBE_ATTEMPTS = 3;
const PROBE_TIMEOUT_MS = 30_000;
const PROBE_BACKOFF_MS = 300;

/** Keep pwsh off the network / first-run telemetry paths while under test. */
export const POWERSHELL_QUIET_ENV: Record<string, string> = {
  POWERSHELL_TELEMETRY_OPTOUT: "1",
  POWERSHELL_UPDATECHECK: "Off",
  DOTNET_CLI_TELEMETRY_OPTOUT: "1",
  DOTNET_NOLOGO: "1",
};

export interface PowerShellProbe {
  bin: string | null;
  diagnostics: string[];
}

let cached: PowerShellProbe | null = null;

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function probeOnce(): PowerShellProbe {
  const diagnostics: string[] = [];
  for (let attempt = 1; attempt <= PROBE_ATTEMPTS; attempt++) {
    let transient = false;
    for (const candidate of ["pwsh", "powershell"]) {
      const r = spawnSync(candidate, ["-NoProfile", "-Command", "$PSVersionTable.PSVersion.Major"], {
        stdio: "pipe",
        timeout: PROBE_TIMEOUT_MS,
        env: { ...process.env, ...POWERSHELL_QUIET_ENV },
      });
      if (r.status === 0) return { bin: candidate, diagnostics };
      if ((r.error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") {
        diagnostics.push(`${candidate}: not installed (ENOENT)`);
        continue; // deterministic — never worth a retry
      }
      transient = true;
      const why = r.error
        ? `${r.error.name}: ${r.error.message}`
        : `status=${r.status} signal=${r.signal ?? "none"} stderr=${r.stderr?.toString().trim().slice(0, 200) ?? ""}`;
      diagnostics.push(`attempt ${attempt} ${candidate}: ${why}`);
    }
    if (!transient) break; // every candidate is simply not installed — retrying cannot help
    if (attempt < PROBE_ATTEMPTS) sleepSync(PROBE_BACKOFF_MS * attempt);
  }
  return { bin: null, diagnostics };
}

export function resolvePowerShell(): PowerShellProbe {
  cached ??= probeOnce();
  return cached;
}

export function isCi(env: NodeJS.ProcessEnv = process.env): boolean {
  return ["true", "1"].includes((env.CI ?? "").toLowerCase());
}

/** `it.skipIf` predicate: skip only off-CI; in CI the test runs and fails loud. */
export function powershellSkip(): boolean {
  return resolvePowerShell().bin === null && !isCi();
}

export function requirePowerShell(): string {
  const { bin, diagnostics } = resolvePowerShell();
  if (bin) return bin;
  throw new Error(
    "PowerShell (pwsh/powershell) is required for the real-shell smoke tests but could not be run" +
      ` after ${PROBE_ATTEMPTS} attempts.\n${diagnostics.join("\n")}`,
  );
}
