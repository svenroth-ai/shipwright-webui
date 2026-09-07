/*
 * org-file-lock.test.ts — generic single-file lock module for the new
 * leadwright-setup-wizard write routes (org-chart.json, daemon-config.json,
 * <leadId>/charter.md — three independent files, three independent
 * acquisitions). Structural copy of external/org/decisions-lock.ts's
 * withDecisionsLock (which is hardcoded to the two decisions files, so a
 * literal reuse isn't possible), generalized over one target path.
 *
 * `mustExist` (daemon-config.json's case): the existence check happens
 * INSIDE the lock acquisition (via proper-lockfile's own realpath ENOENT),
 * never via a plain existsSync before it — external-review finding, GLM:
 * checking existence outside the lock races a concurrent writer, and this
 * module's own ensureFile (wx-create) would itself create the file the
 * caller is trying to detect as absent.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync, existsSync, lstatSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { withOrgFileLock, OrgFileSymlinkEscapeError } from "./org-file-lock.js";

/** Can this host create a *file* symlink? (Windows needs admin / Dev Mode.)
 *  Same capability probe as core/claim-record-lock-symlink.test.ts. */
function canCreateFileSymlink(): boolean {
  const probe = mkdtempSync(path.join(tmpdir(), "symcap-"));
  try {
    writeFileSync(path.join(probe, "t"), "x");
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

describe("withOrgFileLock", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "org-file-lock-test-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("refuses to lock when lstatSync reports a symlink (host-independent — the real-fs proof below is gated on symlink capability)", async () => {
    const target = path.join(dir, "org-chart.json");
    writeFileSync(target, "{}");
    const lstatSpy = vi.fn(() => ({ isSymbolicLink: () => true }));
    await expect(withOrgFileLock(target, { lstatSync: lstatSpy }, () => "unreachable")).rejects.toBeInstanceOf(
      OrgFileSymlinkEscapeError,
    );
  });

  it("creates the target file if missing (default, mustExist unset) and runs fn inside the lock", async () => {
    const target = path.join(dir, "org-chart.json");
    expect(existsSync(target)).toBe(false);

    const result = await withOrgFileLock(target, {}, (ctx) => {
      expect(existsSync(target)).toBe(true);
      return ctx.read();
    });
    expect(result).toBe("");
  });

  it("read()/write() round-trip inside the critical section", async () => {
    const target = path.join(dir, "org-chart.json");
    await withOrgFileLock(target, {}, (ctx) => {
      ctx.write(JSON.stringify({ a: 1 }));
    });
    const after = await withOrgFileLock(target, {}, (ctx) => ctx.read());
    expect(JSON.parse(after)).toEqual({ a: 1 });
  });

  it("mustExist:true throws ENOENT (never creates the file) when the target is absent — the 'show a fragment instead' signal", async () => {
    const target = path.join(dir, "daemon-config.json");
    await expect(withOrgFileLock(target, { mustExist: true }, () => "unreachable")).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(existsSync(target)).toBe(false);
  });

  it("mustExist:true succeeds when the file already exists", async () => {
    const target = path.join(dir, "daemon-config.json");
    writeFileSync(target, JSON.stringify({ x: 1 }));
    const result = await withOrgFileLock(target, { mustExist: true }, (ctx) => ctx.read());
    expect(JSON.parse(result)).toEqual({ x: 1 });
  });

  itRealSymlink(
    "refuses to lock through a REAL pre-existing symlink target on a host that can create one" +
      (SYMLINKS_AVAILABLE ? "" : " (skipped — this host cannot create a file symlink without elevation)"),
    async () => {
      const real = path.join(dir, "real.json");
      writeFileSync(real, "{}");
      const link = path.join(dir, "org-chart.json");
      symlinkSync(real, link);

      await expect(withOrgFileLock(link, {}, () => "unreachable")).rejects.toBeInstanceOf(OrgFileSymlinkEscapeError);
    },
  );

  it("releases the lock even when fn throws", async () => {
    const target = path.join(dir, "org-chart.json");
    await expect(
      withOrgFileLock(target, {}, () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    // A second acquisition must succeed promptly — proves the first release() ran.
    const result = await withOrgFileLock(target, {}, (ctx) => ctx.read());
    expect(result).toBe("");
  });

  it("two overlapping writers: the second blocks until the first releases, and both writes land (no lost update)", async () => {
    const target = path.join(dir, "org-chart.json");
    await withOrgFileLock(target, {}, (ctx) => ctx.write(JSON.stringify({ leads: {} })));

    const first = withOrgFileLock(target, {}, async (ctx) => {
      const current = JSON.parse(ctx.read()) as { leads: Record<string, number> };
      await new Promise((r) => setTimeout(r, 30));
      current.leads.a = 1;
      ctx.write(JSON.stringify(current));
    });
    const second = withOrgFileLock(target, {}, async (ctx) => {
      const current = JSON.parse(ctx.read()) as { leads: Record<string, number> };
      current.leads.b = 2;
      ctx.write(JSON.stringify(current));
    });

    await Promise.all([first, second]);
    const final = JSON.parse(await withOrgFileLock(target, {}, (ctx) => ctx.read())) as {
      leads: Record<string, number>;
    };
    expect(final.leads).toEqual({ a: 1, b: 2 });
  });

  it("lstatSync injection point is honoured (test seam, mirrors DecisionsLockDeps)", async () => {
    const target = path.join(dir, "org-chart.json");
    const lstatSpy = vi.fn((p: string) => ({ isSymbolicLink: () => false }) as { isSymbolicLink(): boolean });
    await withOrgFileLock(target, { lstatSync: lstatSpy }, (ctx) => ctx.read());
    expect(lstatSpy).toHaveBeenCalled();
  });
});
