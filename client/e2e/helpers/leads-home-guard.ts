/*
 * Safety guard for E2E specs that touch the Leads tree (`~/.claude/leads`).
 *
 * Those specs seed and reset the tree in beforeEach/afterEach. Run against the
 * operator's REAL home (no isolated-stack harness) that overwrites and deletes
 * real Lead data. Every spec therefore takes its root from `guardedLeadsRoot()`
 * (fails at module load, before any write) and removes paths ONLY through
 * `removeLeadsPath()`. Both refuse unless the harness marker is set AND
 * HOME/USERPROFILE (os.homedir()) resolves strictly under the OS temp dir,
 * which is what `client/e2e/isolated-stack.mjs` sets up.
 * Ratchet: client/src/test/e2e-leads-rm-guard.test.ts.
 *
 * @covers FR-01.71 (test infrastructure only; no product behaviour)
 */
import { existsSync, realpathSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";

function norm(p: string): string {
  return process.platform === "win32" ? p.toLowerCase() : p;
}

/** Real path when it exists (a realpath failure on an existing path propagates: fail closed). */
function real(p: string): string {
  return existsSync(p) ? realpathSync.native(p) : path.resolve(p);
}

function isUnder(parent: string, child: string): boolean {
  const rel = path.relative(norm(parent), norm(child));
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

/** Throws unless the harness marker is set and `home` is strictly under the OS temp dir. */
export function assertHomeIsUnderTemp(home: string = homedir(), temp: string = tmpdir()): void {
  const refuse = (why: string): never => {
    throw new Error(
      `Refusing to touch leads data: ${why}. HOME/USERPROFILE=${home}, tmpdir=${temp}. ` +
        "Run this spec through the isolated-stack harness (node e2e/isolated-stack.mjs ...), never against your real home.",
    );
  };
  if (process.env.SHIPWRIGHT_E2E_ISOLATED !== "1") refuse("SHIPWRIGHT_E2E_ISOLATED is not 1");
  const realTemp = real(temp);
  if (path.parse(realTemp).root === realTemp) refuse("the OS temp dir is a filesystem root");
  if (!isUnder(realTemp, real(home))) refuse("HOME is not under the OS temp dir");
}

/** The leads root for the current HOME; throws (at spec load) unless HOME is an isolated temp home. */
export function guardedLeadsRoot(): string {
  assertHomeIsUnderTemp();
  return path.join(homedir(), ".claude", "leads");
}

/** Guarded replacement for rm/rmSync on a leads path (the root itself or a file inside it). */
export function removeLeadsPath(leadsPath: string): void {
  assertHomeIsUnderTemp();
  const root = real(path.join(homedir(), ".claude", "leads"));
  const target = real(leadsPath);
  if (norm(target) !== norm(root) && !isUnder(root, target)) {
    throw new Error(`Refusing to delete ${leadsPath}: it is not inside ${root}.`);
  }
  rmSync(leadsPath, { recursive: true, force: true });
}
