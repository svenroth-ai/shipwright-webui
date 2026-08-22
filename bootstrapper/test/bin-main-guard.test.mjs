import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, symlinkSync, rmSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { isMainModule } from "../bin/shipwright.mjs";

/**
 * Guards the main-module entry check in bin/shipwright.mjs — the ONE code path
 * that decides whether `main()` runs when the bin is invoked. The rest of
 * bin.test.mjs imports `main` directly (side-effect-free) and so never exercises
 * this guard; that gap let a symlink-blind guard ship, and under npx (which
 * installs the executable as a `node_modules/.bin` symlink) `main()` never ran —
 * `npx @svenroth-ai/shipwright` did nothing at all on macOS/Linux. These tests
 * ARE that missing coverage: the npx symlink invocation path.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.resolve(HERE, "..", "bin", "shipwright.mjs");
const BIN_URL = pathToFileURL(BIN).href;
const SELF = JSON.parse(readFileSync(path.resolve(HERE, "..", "package.json"), "utf-8")).version;

const IS_CI = ["true", "1"].includes(String(process.env.CI ?? "").toLowerCase());
const IS_WIN = process.platform === "win32";

/**
 * Can this platform create a real FILE symlink here? Linux/macOS: yes. Windows:
 * only with admin / Developer Mode, so a dev box may not — but CI is Linux, so a
 * failure THERE is a real gap, not an environment quirk: hard-fail it (the
 * silent-skip CI-discipline rule) rather than let the npx path go unverified.
 */
function symlinkSupported() {
  const dir = mkdtempSync(path.join(os.tmpdir(), "sw-symcap-"));
  try {
    symlinkSync(BIN, path.join(dir, "l.mjs"), "file");
    return true;
  } catch {
    return false;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
const CAN_SYMLINK = symlinkSupported();
// Hard-fail (never silently skip) when CI CANNOT create a symlink on a platform
// where it should always work — i.e. non-Windows CI (Linux/macOS). A Windows CI
// runner without Developer Mode genuinely cannot make a usable file symlink, the
// same carve-out the e2e block makes below, so we do not fail the file there.
if (!CAN_SYMLINK && IS_CI && !IS_WIN) {
  throw new Error(
    "cannot create a file symlink in non-Windows CI — the npx symlink invocation path is then " +
      "unverifiable; enable symlink creation on the runner instead of letting this coverage silently vanish.",
  );
}

/** Run body in a fresh temp dir with `link` symlinked to the real bin; always cleaned up. */
function withSymlink(name, body) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "sw-symlink-"));
  const link = path.join(dir, name);
  try {
    symlinkSync(BIN, link, "file");
    return body(link);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("bin — isMainModule (the entry guard, unit)", () => {
  it("false when there is no argv[1]", () => {
    expect(isMainModule(undefined, BIN_URL)).toBe(false);
    expect(isMainModule("", BIN_URL)).toBe(false);
  });

  it("true when argv[1] is the module's own real path", () => {
    expect(isMainModule(BIN, BIN_URL)).toBe(true);
  });

  it("false for an unrelated path (a stray argv[1] must not trigger main)", () => {
    expect(isMainModule(path.join(HERE, "does-not-exist.mjs"), BIN_URL)).toBe(false);
  });

  it.skipIf(!CAN_SYMLINK)(
    "true when argv[1] is a SYMLINK to the module — the npx case the old guard missed",
    () => {
      // The regression: with a plain path.resolve compare this is false (symlink
      // path !== real path) and main() never runs. realpath both sides → equal.
      withSymlink("shipwright", (link) => {
        expect(isMainModule(link, BIN_URL)).toBe(true);
      });
    },
  );
});

// End-to-end: actually execute the bin THROUGH a symlink and prove main() runs.
// Skipped on Windows: real Windows npx uses a `.cmd` shim (real path, no symlink),
// and a Git-Bash symlink there makes Node resolve import.meta.url to the symlink
// dir so the bin's relative lib imports 404 — a platform artifact, not this bug.
describe("bin — executed through a symlink runs main() (npx repro)", () => {
  it.skipIf(!CAN_SYMLINK || IS_WIN)(
    "node <symlink-to-bin> --version prints the version and exits 0",
    () => {
      withSymlink("shipwright", (link) => {
        const out = execFileSync(process.execPath, [link, "--version"], { encoding: "utf-8" });
        expect(out.trim()).toBe(SELF);
      });
    },
  );
});

// End-to-end on the ACTUAL published artifact: `npm pack` the package, extract
// it, and invoke the PACKED bin through a symlink — the real npx layout (a
// node_modules/.bin symlink into the installed tree). The mechanism tests above
// use hand-made symlinks to the working-tree bin; this one proves the SHIPPED
// tarball (bin/ + lib/ resolved via the `files` whitelist) actually runs main()
// under a symlink. This is the coverage whose absence let the green-but-broken
// bug ship: every unit test passed while `npx @svenroth-ai/shipwright` did
// nothing. `--ignore-scripts` skips the prepack build (server/client dist is not
// needed for `--version`, which returns before any server import is used).
// Skipped on Windows for the same symlink reasons as above.
describe("bin — packed tarball runs main() through a symlink (real npx layout)", () => {
  const PKG_ROOT = path.resolve(HERE, "..");
  it.skipIf(!CAN_SYMLINK || IS_WIN)(
    "npm pack -> extract -> node <.bin symlink> --version prints the version",
    () => {
      const dir = mkdtempSync(path.join(os.tmpdir(), "sw-pack-"));
      try {
        const packed = JSON.parse(
          execFileSync("npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", dir], {
            cwd: PKG_ROOT,
            encoding: "utf-8",
          }),
        );
        const tgz = path.join(dir, packed[0].filename);
        execFileSync("tar", ["-xzf", tgz, "-C", dir], { encoding: "utf-8" });
        // npm tarballs always extract under a top-level `package/` directory.
        const packedBin = path.join(dir, "package", "bin", "shipwright.mjs");
        const binDir = path.join(dir, "package", "node_modules", ".bin");
        const link = path.join(binDir, "shipwright");
        // Mirror the real install layout: a .bin symlink pointing into the tree.
        execFileSync(process.execPath, ["-e", `require("fs").mkdirSync(${JSON.stringify(binDir)},{recursive:true})`]);
        symlinkSync(packedBin, link, "file");
        const out = execFileSync(process.execPath, [link, "--version"], { encoding: "utf-8" });
        expect(out.trim()).toBe(SELF);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
    60000,
  );
});
