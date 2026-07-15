/*
 * Temp-dir machinery + the fixture self-lock. Split out of `fixtures.ts`
 * (iterate-2026-07-10-harness-hardening, A00) when that file crossed the 300-LOC
 * ceiling. Cohesive seam: this module is about WHERE a fixture may write;
 * `fixtures.ts` is about WHAT it seeds through the API.
 *
 * ⚠️ SAFETY. `seedProject()` makes the server mkdir the path it is handed and drop a
 * `.code-workspace` into it, and cleanup later `rm -rf`s it. Every path a fixture
 * hands over is created under `os.tmpdir()`, and `assertTempPath()` HARD-ABORTS on
 * anything that is not — the same paranoia `helpers/isolated-store.ts` applies to the
 * task store, extended (as the A00 brief requires) to every new fixture that writes.
 */

import fs from "node:fs/promises";
import fsSync from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Hard-abort unless `p` resolves under the OS temp dir. A fumbled fixture must fail
 * loudly here rather than mkdir into (or later delete) a real directory on the
 * developer's disk.
 */
export function assertTempPath(p: string): string {
  const real = (q: string) => {
    try {
      return fsSync.realpathSync.native(q);
    } catch {
      return path.resolve(q);
    }
  };
  const norm = (s: string) => (process.platform === "win32" ? s.toLowerCase() : s);
  const tmp = norm(real(os.tmpdir()));
  const target = norm(real(path.dirname(p)));
  const rel = path.relative(tmp, target);
  const under = rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
  if (!under) {
    throw new Error(
      `[fixtures SELF-LOCK] Refusing to use ${p}: E2E fixtures may only create ` +
        `directories under the OS temp dir (${tmp}). Got parent=${target}.`,
    );
  }
  return p;
}

/** Create a throwaway directory under the OS temp dir. */
export async function makeTempDir(prefix = "sw-e2e-"): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

/**
 * A temp dir with a FIXED name — for the visual specs only.
 *
 * The Projects page renders the project's PATH. With `mkdtemp` the random suffix
 * changes every run, so those glyphs differ on a no-op change and the pixel gate
 * fails against its own baselines. Determinism has to come from the fixture, not
 * from a pixel budget loose enough to swallow a line of text — a budget that could
 * swallow a path could swallow a broken layout too.
 *
 * Safe because the `visual` project runs with workers: 1 and each spec cleans up
 * after itself; a fixed name would be a collision hazard under parallelism, which is
 * why it is opt-in rather than the default.
 */
export async function makeFixedDir(name: string): Promise<string> {
  const dir = assertTempPath(path.join(os.tmpdir(), name));
  await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

/**
 * Remove a temp dir created here. Self-locks, then retries: Windows holds an EBUSY on
 * a freshly-released dir for a few ms after a pty exits.
 */
export async function removeTempDir(dir: string | undefined): Promise<void> {
  if (!dir) return;
  assertTempPath(dir);
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      await fs.rm(dir, { recursive: true, force: true });
      return;
    } catch {
      if (attempt === 4) return;
      await new Promise((r) => setTimeout(r, 250));
    }
  }
}

/** Write `files` (relative path -> contents) into `dir`, creating parents. */
export async function writeFiles(
  dir: string,
  files: Record<string, string> | undefined,
): Promise<void> {
  for (const [rel, contents] of Object.entries(files ?? {})) {
    const target = path.join(dir, rel);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, contents, "utf-8");
  }
}
