/*
 * Meta-test - the e2e "never wipe the real ~/.claude/leads" RATCHET.
 *
 * @covers FR-01.71 (test infrastructure only; no product behaviour)
 *
 * Org/Lead Playwright specs reset the Leads tree in beforeEach/afterEach. Run
 * against a real home (no isolated-stack harness) a bare `rmSync(LEADS_ROOT)`
 * deletes the operator's real Lead data. Every such removal must go through
 * `client/e2e/helpers/leads-home-guard.ts` (`removeLeadsPath`), which throws
 * unless the isolated-stack marker is set and HOME is under the OS temp dir. This source scan fails when any e2e
 * spec calls rm/rmSync on a leads path directly. Same shape as
 * modal-scroll-body-invariant.test.ts.
 *
 * Documented limit: a lexical scan. It also flags aliased rm imports and shell
 * `rm -rf`, and scans .ts/.mjs/.js/.cjs, but a removal routed through a wrapper
 * function parameter is not traced - the runtime guard is the real protection.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync, mkdtempSync, mkdirSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const E2E = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "e2e");
const HELPER = path.join(E2E, "helpers", "leads-home-guard.ts");

// Loaded by computed path (not a static import): src/ and e2e/ are separate tsconfig roots.
interface Guard {
  assertHomeIsUnderTemp(home?: string, temp?: string): void;
  guardedLeadsRoot(): string;
  removeLeadsPath(leadsPath: string): void;
}
const loadGuard = (): Promise<Guard> => import(/* @vite-ignore */ HELPER) as Promise<Guard>;

/** Run `fn` with env vars set (undefined = unset), restoring them afterwards. */
function withEnv(vars: Record<string, string | undefined>, fn: () => void): void {
  const prev: Record<string, string | undefined> = {};
  for (const k of Object.keys(vars)) prev[k] = process.env[k];
  try {
    for (const [k, v] of Object.entries(vars)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
    fn();
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : /\.(?:ts|mjs|js|cjs)$/.test(p) ? [p] : [];
  });
}

const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

/** rm/rmSync/rmdirSync call (also `fs.rm`, `fs.promises.rm`) whose argument list mentions a leads path. */
const RM_CALL = /\b(?:rmSync|rmdirSync|rm|rmdir|unlinkSync|unlink)\s*\(([^;]*)/g;
const LEADS_ARG = /LEADS_ROOT|CHART_PATH|["'`]leads["'`]|\.claude[\\/]leads/;

/** Identifiers assigned (transitively) from an expression that mentions a leads path. */
function leadsDerivedNames(code: string): string[] {
  const names = new Set<string>();
  for (let pass = 0; pass < 3; pass++) {
    for (const m of code.matchAll(/\b(?:const|let|var)\s+(\w+)\s*(?::[^=]+)?=([^;]*);/g)) {
      const rhs = m[2];
      if (LEADS_ARG.test(rhs) || [...names].some((n) => new RegExp(`\\b${n}\\b`).test(rhs))) names.add(m[1]);
    }
  }
  return [...names];
}

export function offenders(src: string): string[] {
  const code = stripComments(src);
  const out: string[] = [];
  // An aliased removal import hides the call from RM_CALL; a shell-out never matches it.
  if (/\b(?:rmSync|rmdirSync|unlinkSync|rm|rmdir|unlink)\s+as\s/.test(code)) out.push("aliased rm import");
  if (/\brm\s+-rf?\b/.test(code) && /LEADS_ROOT|leads/.test(code)) out.push("shell rm on a leads file");
  const derived = leadsDerivedNames(code).map((n) => new RegExp(`\\b${n}\\b`));
  for (const m of code.matchAll(RM_CALL)) {
    if (LEADS_ARG.test(m[1]) || derived.some((r) => r.test(m[1]))) out.push(m[0].trim().slice(0, 80));
  }
  return out;
}

describe("e2e leads removal guard", () => {
  // @covers FR-01.71
  it("no e2e spec removes a leads path without the guard helper", () => {
    const bad = walk(E2E)
      .filter((f) => f !== HELPER)
      .flatMap((f) => offenders(readFileSync(f, "utf8")).map((o) => `${path.relative(E2E, f)}: ${o}`));
    expect(bad).toEqual([]);
  });

  // @covers FR-01.71
  it("the scan catches a bare rmSync on a leads path (self-check)", () => {
    expect(offenders('rmSync(LEADS_ROOT, { recursive: true, force: true });')).toHaveLength(1);
    expect(offenders('await fs.rm(CHART_PATH, { force: true })')).toHaveLength(1);
    expect(offenders("removeLeadsPath(LEADS_ROOT);")).toEqual([]);
    // a path DERIVED from a leads root is still a leads path
    expect(offenders('const t = path.join(LEADS_ROOT, "x.json");\nrmSync(t, { force: true });')).toHaveLength(1);
    expect(offenders('import { rmSync as del } from "node:fs"; del(LEADS_ROOT);')).not.toEqual([]);
    expect(offenders("execSync(`rm -rf ${LEADS_ROOT}`)")).not.toEqual([]);
    // an unrelated temp dir is not
    expect(offenders('const tmp = mkdtempSync("x");\nrmSync(tmp, { recursive: true });')).toEqual([]);
  });

  // @covers FR-01.71
  it("the guard refuses a HOME outside the OS temp dir, a missing harness marker and a root temp dir", async () => {
    const { assertHomeIsUnderTemp } = await loadGuard();
    const root = path.parse(tmpdir()).root;
    withEnv({ SHIPWRIGHT_E2E_ISOLATED: "1" }, () => {
      expect(() => assertHomeIsUnderTemp(root)).toThrow(/not under the OS temp dir/);
      expect(() => assertHomeIsUnderTemp(path.join(root, "Users", "someone"))).toThrow();
      expect(() => assertHomeIsUnderTemp(path.join(root, "Users", "someone"), root)).toThrow(/filesystem root/);
    });
    const home = mkdtempSync(path.join(tmpdir(), "leads-guard-"));
    try {
      withEnv({ SHIPWRIGHT_E2E_ISOLATED: undefined }, () => {
        expect(() => assertHomeIsUnderTemp(home)).toThrow(/SHIPWRIGHT_E2E_ISOLATED/);
      });
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  // @covers FR-01.71
  it("the guard accepts an isolated temp HOME and removes only inside its leads tree", async () => {
    const { assertHomeIsUnderTemp, guardedLeadsRoot, removeLeadsPath } = await loadGuard();
    const home = mkdtempSync(path.join(tmpdir(), "leads-guard-"));
    const leads = path.join(home, ".claude", "leads");
    mkdirSync(leads, { recursive: true });
    try {
      withEnv({ SHIPWRIGHT_E2E_ISOLATED: "1", HOME: home, USERPROFILE: home }, () => {
        expect(() => assertHomeIsUnderTemp(home)).not.toThrow();
        expect(guardedLeadsRoot()).toBe(leads);
        removeLeadsPath(leads);
        expect(existsSync(leads)).toBe(false);
        expect(() => removeLeadsPath(path.join(home, "elsewhere"))).toThrow(/not inside/);
        expect(() => removeLeadsPath(path.join(tmpdir(), "elsewhere"))).toThrow(/not inside/);
      });
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
