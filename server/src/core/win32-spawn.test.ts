/*
 * win32-spawn — the extracted CORE resolver.
 *
 * Run-ID: iterate-2026-08-01-win32-spawn-followups.
 *
 * `preview-win32-spawn.ts` was renamed and re-homed: the resolution lives here
 * and the preview module is now a thin wrapper that adds
 * `PreviewProfileInvalidError`. These pin the three things that split buys and
 * the one thing it must not cost.
 *
 *   1. The `null` return contract (this module) vs the throw (the wrapper).
 *   2. win32 path SEMANTICS under a stubbed platform (the whole point of the
 *      `path.win32` flavouring — see the module header's (a)/(b) audit).
 *   3. Core and wrapper stay behaviourally identical everywhere else — a
 *      differential matrix, so the extraction cannot silently drift.
 *
 * The fourth thing the split buys — the BOOT path staying out of the preview
 * ESM cycle — is guarded by the sibling `win32-spawn.import-closure.test.ts`.
 * It lives apart because it is static import-graph analysis and needs none of
 * the platform/env/tmpdir harness below (and because one file carrying both
 * crossed the 300-line limit).
 *
 * Cross-OS determinism: the win32 branch is reached only when
 * `process.platform` is stubbed, and CI runs this suite on ubuntu. Every
 * assertion below is therefore written to hold on BOTH hosts — which is exactly
 * the property the old code did not have.
 */
import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { resolveSpawn } from "./win32-spawn.js";
import { resolveSpawn as previewResolveSpawn } from "./preview-win32-spawn.js";
import { PreviewProfileInvalidError } from "./preview-session-manager.js";

const REAL_PLATFORM = process.platform;
const ENV_KEYS = ["PATH", "Path", "PATHEXT", "ComSpec", "COMSPEC", "SystemRoot", "windir"] as const;
const ORIG_ENV: Record<string, string | undefined> = {};
for (const k of ENV_KEYS) ORIG_ENV[k] = process.env[k];

const tmpDirs: string[] = [];

function setPlatform(p: NodeJS.Platform): void {
  Object.defineProperty(process, "platform", { value: p, configurable: true });
}

function tmp(): string {
  const d = mkdtempSync(path.join(tmpdir(), "win32spawn-"));
  tmpDirs.push(d);
  return d;
}

/** Plant a real file (never executed) so the fs-touching lookup has something to find. */
function plant(dir: string, rel: string): string {
  const full = path.join(dir, rel);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, "@echo planted\r\n");
  return full;
}

/** Lowercase `.cmd` + PATHEXT=".cmd" matches on a case-SENSITIVE fs too. */
function usePathExt(): void {
  process.env.PATHEXT = ".cmd";
}

afterEach(() => {
  setPlatform(REAL_PLATFORM);
  for (const k of ENV_KEYS) {
    if (ORIG_ENV[k] === undefined) delete process.env[k];
    else process.env[k] = ORIG_ENV[k];
  }
  for (const d of tmpDirs.splice(0)) {
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      // best-effort temp cleanup
    }
  }
});

describe("win32-spawn — the null return contract (AC-2)", () => {
  it("returns null for a BARE name PATHEXT cannot place, instead of throwing", () => {
    setPlatform("win32");
    process.env.PATH = tmp(); // empty dir → nothing resolves
    usePathExt();
    expect(resolveSpawn(["definitely-not-installed-xyz", "--version"], tmp())).toBeNull();
  });

  it("the PREVIEW wrapper turns that same null into PreviewProfileInvalidError", () => {
    setPlatform("win32");
    process.env.PATH = tmp();
    usePathExt();
    const cwd = tmp();
    expect(() => previewResolveSpawn(["definitely-not-installed-xyz", "--version"], cwd))
      .toThrow(PreviewProfileInvalidError);
  });

  it("POSIX is still a pass-through and never null", () => {
    setPlatform("linux");
    expect(resolveSpawn(["claude", "--version"], "/tmp")).toEqual({
      command: "claude",
      args: ["--version"],
    });
  });
});

describe("win32-spawn — win32 path SEMANTICS hold on a POSIX host (AC-5)", () => {
  /*
   * The ComSpec fallback is the LIVE instance of the host-`path` gap. Before
   * the `path.win32` flavouring, a POSIX host with a stubbed platform produced
   * `C:\Win/System32/cmd.exe` — mixed separators — which is why the older
   * assertions had to be loosened to `/(?:^|[\\/])cmd\.exe$/`. Pinned exactly
   * here, so the suite means the same thing on Windows and on ubuntu CI.
   */
  function comSpecFor(root: string): string {
    setPlatform("win32");
    delete process.env.ComSpec;
    delete process.env.COMSPEC;
    process.env.SystemRoot = root;
    // A `.cmd` target always routes through cmd.exe, so `command` IS the ComSpec.
    const plan = resolveSpawn(["C:\\npm\\x.cmd"], "C:\\proj");
    return plan!.command;
  }

  it("falls back to exactly <SystemRoot>\\System32\\cmd.exe — all backslashes", () => {
    expect(comSpecFor("C:\\Win")).toBe("C:\\Win\\System32\\cmd.exe");
  });

  it("emits no forward slash on the fallback, on any host", () => {
    expect(comSpecFor("C:\\Windows")).not.toContain("/");
  });

  it("still prefers an explicit ComSpec from the environment", () => {
    setPlatform("win32");
    process.env.ComSpec = "D:\\alt\\cmd.exe";
    expect(resolveSpawn(["C:\\npm\\x.cmd"], "C:\\proj")!.command).toBe("D:\\alt\\cmd.exe");
  });

  it("classifies a leading-dot basename by win32 rules, not host rules", () => {
    /*
     * The ONE input that makes the two `extname` flavours disagree, and
     * therefore the only BEHAVIOURAL pin on the (a)-class extname calls.
     * Stage-3 doubt review established that without it the extname half of the
     * flavouring was unobservable: no other argv in any suite distinguishes
     * host/posix/win32 `extname`, so `path.extname` could be restored and
     * every runtime test would stay green.
     *
     * `x\.exe` — win32 splits on the backslash, so the basename is `.exe`, a
     * DOTFILE, and the extension is `""` -> falls through to PATHEXT
     * resolution -> unresolvable but path-like -> wrapped by cmd.exe.
     * POSIX sees one segment ending `.exe` -> classified EXECUTABLE ->
     * spawned DIRECTLY. Windows is right; assert Windows.
     */
    setPlatform("win32");
    process.env.ComSpec = "C:\\Windows\\System32\\cmd.exe";
    process.env.PATH = tmp();
    usePathExt();

    const plan = resolveSpawn(["x\\.exe"], tmp());
    expect(plan).not.toBeNull();
    expect(plan!.command).toBe("C:\\Windows\\System32\\cmd.exe");
    expect(plan!.command).not.toBe("x\\.exe");
    expect(plan!.args).toEqual(["/d", "/s", "/c", "x\\.exe"]);
  });
});

describe("win32-spawn — PATH is split on the win32 `;` and scanned in order (AC-11)", () => {
  it("finds a planted shim in a LATER PATH entry", () => {
    // The server side previously only ever set ONE PATH directory, so the
    // delimiter behaviour was incidental. External plan review finding 3.
    setPlatform("win32");
    const dirA = tmp(); // empty
    const dirB = tmp();
    const shim = plant(dirB, "multient.cmd");
    process.env.PATH = [dirA, dirB].join(";");
    usePathExt();

    const plan = resolveSpawn(["multient", "run"], tmp());
    expect(plan).not.toBeNull();
    // args = ["/d","/s","/c", <resolved shim>, "run"] — the resolved candidate
    // is a HOST path, which is the (b)-class call working as designed (AC-6).
    expect(plan!.args[3].toLowerCase()).toContain("multient.cmd");
    expect(plan!.args[3]).toContain(dirB);
    expect(shim.toLowerCase()).toContain("multient.cmd");
  });

  it("an EARLIER entry still wins over a later duplicate", () => {
    setPlatform("win32");
    const dirA = tmp();
    const dirB = tmp();
    plant(dirA, "dupe.cmd");
    plant(dirB, "dupe.cmd");
    process.env.PATH = [dirA, dirB].join(";");
    usePathExt();

    const plan = resolveSpawn(["dupe"], tmp());
    expect(plan!.args[3]).toContain(dirA);
    expect(plan!.args[3]).not.toContain(dirB);
  });
});

describe("win32-spawn — core and preview wrapper are identical except at one point (AC-12)", () => {
  /*
   * External plan review finding 6: extraction can subtly alter argv handling.
   * The frozen preview guard covers the SECURITY cases; this covers shape.
   */
  const MATRIX: { label: string; argv: string[] }[] = [
    { label: "an .exe target, no args", argv: ["C:\\bin\\tool.exe"] },
    { label: "an .exe target with args", argv: ["C:\\bin\\tool.exe", "--version"] },
    { label: "a MIXED-CASE .EXE target", argv: ["C:\\bin\\TOOL.EXE", "-v"] },
    { label: "a .cmd shim, discrete argv", argv: ["C:\\npm\\x.cmd", "a", "b"] },
    { label: "a .BAT shim", argv: ["C:\\tools\\thing.BAT"] },
    { label: "a SPACED path (verbatim branch)", argv: ["C:\\Program Files\\npm\\x.cmd", "--version"] },
    { label: "a cmd metacharacter in the target", argv: ["C:\\R&D\\x.cmd"] },
    { label: "a spaced ARGUMENT", argv: ["C:\\npm\\x.cmd", "--name", "my task"] },
    { label: "an EMPTY-STRING argument", argv: ["C:\\npm\\x.cmd", "", "tail"] },
    { label: "a path-like ABSENT target", argv: ["C:\\tools\\ghostserver", "run"] },
    { label: "a dot-relative shim", argv: [".\\local.cmd"] },
  ];

  it.each(MATRIX)("$label — core and wrapper agree exactly", ({ argv }) => {
    setPlatform("win32");
    process.env.ComSpec = "C:\\Windows\\System32\\cmd.exe";
    process.env.PATH = tmp(); // resolves nothing, so the branch is deterministic
    usePathExt();
    const cwd = tmp();

    const core = resolveSpawn(argv, cwd);
    const wrapped = previewResolveSpawn(argv, cwd);
    expect(core).not.toBeNull();
    expect(wrapped).toEqual(core);
  });

  it("they agree on a RESOLVABLE bare name too", () => {
    setPlatform("win32");
    process.env.ComSpec = "C:\\Windows\\System32\\cmd.exe";
    const dir = tmp();
    plant(dir, "agreed.cmd");
    process.env.PATH = dir;
    usePathExt();
    const cwd = tmp();

    expect(previewResolveSpawn(["agreed", "x"], cwd)).toEqual(resolveSpawn(["agreed", "x"], cwd));
  });

  it("and diverge ONLY on the unresolvable bare name", () => {
    setPlatform("win32");
    process.env.PATH = tmp();
    usePathExt();
    const cwd = tmp();

    expect(resolveSpawn(["nope-not-here-xyz"], cwd)).toBeNull();
    expect(() => previewResolveSpawn(["nope-not-here-xyz"], cwd)).toThrow(PreviewProfileInvalidError);
  });

  it("POSIX pass-through agrees as well", () => {
    setPlatform("linux");
    const argv = ["/usr/bin/claude", "--version"];
    expect(previewResolveSpawn(argv, "/tmp")).toEqual(resolveSpawn(argv, "/tmp"));
  });
});
