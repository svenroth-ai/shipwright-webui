/*
 * Regression guard: the four remediated sites must never go back to `shell: true`.
 *
 * Run-ID: iterate-2026-07-31-win32-shell-spawn-remediation.
 *
 * WHY THIS EXISTS. That iterate DELETED four inline `// nosemgrep` suppressions
 * rather than registering them in `shipwright_accepted_risks.yaml`, on the
 * grounds that a root remediation existed. Deleting them also deleted the only
 * in-code record that the decision was ever made — and nothing else would stop
 * the subject coming back:
 *
 *   - CI's Semgrep gate only fails the build at `security-severity >= 9.0`
 *     (see DO-NOT #25), so a re-added `shell: true` lands in the SARIF and
 *     merges green.
 *   - `.github/workflows/ci.yml` ran vitest for `client` and `server` ONLY.
 *     There was no bootstrapper job, so the bootstrapper's own suite — every
 *     test for three of the four sites — never ran in CI at all.
 *
 * AMENDED 2026-08-01 (iterate-2026-08-01-bootstrapper-ci-contract). The second
 * bullet is now HISTORY: `ci.yml` has a `Bootstrapper (type + lint + test)` job
 * and that suite does run. It is left standing because it records why this file
 * was written, and because the gap it describes is only PARTLY closed — the new
 * job is ADVISORY until someone arms it in the `main-protection` ruleset, so
 * today it still cannot block a merge. This file can: it runs inside
 * `Server (type + lint + test)`, which is required. Both bullets must be false
 * before retiring it, and the first one still is not.
 *
 * And even then it belongs HERE: two of the six scanned sites below
 * (`server/src/core/cli-compat.ts`, `server/src/core/preview-win32-spawn.ts`)
 * are server-only, so no bootstrapper-side suite could ever cover them. The
 * arming state changes what a MOVE would cost; it never makes one correct.
 *
 * This file is therefore the durable, CI-enforced replacement for the four
 * suppressions. It is a source scan (the `ci-action-pinning-posture.test.ts`
 * pattern) precisely so it can reach across into `bootstrapper/` in ONE place,
 * covering all four sites with one blocking check. Reading a sibling package's
 * file is not an import, so DO-NOT #7 is untouched.
 *
 * If a future change genuinely needs a platform shell on one of these paths,
 * that is a decision to RECORD — add the register entry — not to make quietly.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
// server/src/test → repo root
const REPO = resolve(__dirname, "..", "..", "..");

/** The exact sites iterate-2026-07-31 remediated. */
const REMEDIATED = [
  "server/src/core/cli-compat.ts",
  "bootstrapper/lib/claude-cli.mjs",
  "bootstrapper/lib/preflight.mjs",
  "bootstrapper/lib/server.mjs",
  // The shared resolvers both of the above depend on.
  // `win32-spawn.ts` is where the resolution actually lives since
  // iterate-2026-08-01-win32-spawn-followups; `preview-win32-spawn.ts` stays on
  // the list as the preview-facing wrapper, because dropping a file from this
  // list is exactly how the guard would quietly stop covering it.
  "server/src/core/win32-spawn.ts",
  "server/src/core/preview-win32-spawn.ts",
  "bootstrapper/lib/win32-spawn.mjs",
];

/** Strip block + line comments, preserving line structure for `^` anchors. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|[^:])\/\/[^\n]*/g, (_m, lead) => lead);
}

describe("no `shell: true` on the remediated command-invocation paths", () => {
  it.each(REMEDIATED)("%s never asks child_process for a shell", (rel) => {
    const code = stripComments(readFileSync(resolve(REPO, rel), "utf-8"));
    // `shell: true`, `shell: isWin`, `shell: plat === "win32"` — any truthy or
    // computed shell option. Only a literal `shell: false` is allowed.
    const shellOptions = code.match(/\bshell\s*:\s*[^,}\n]+/g) ?? [];
    const offenders = shellOptions.filter((s) => !/shell\s*:\s*false/.test(s));
    expect(offenders).toEqual([]);
  });

  it.each(REMEDIATED)("%s carries no spawn-shell-true suppression", (rel) => {
    // A returning `nosemgrep` for this rule would mean the finding came back and
    // was silenced in place rather than recorded in the accepted-risk register.
    const raw = readFileSync(resolve(REPO, rel), "utf-8");
    expect(raw).not.toMatch(/nosemgrep:[^\n]*spawn-shell-true/);
  });

  it("the three pty-API sites keep theirs — they are genuine false positives", () => {
    /*
     * ptyManager.spawn()'s `shell` option is a whitelisted binary NAME (ADR-067
     * allowlist), not a child_process flag. Those suppressions were deliberately
     * left in place, and this asserts the iterate did not over-reach. If the pty
     * API is ever renamed or reworked, THAT is the moment to revisit them.
     */
    const ptySites = [
      "server/src/terminal/routes.ts",
      "server/src/terminal/ws-upgrade-handler.ts",
    ];
    const total = ptySites.reduce((n, rel) => {
      const raw = readFileSync(resolve(REPO, rel), "utf-8");
      return n + (raw.match(/nosemgrep:[^\n]*spawn-shell-true/g) ?? []).length;
    }, 0);
    expect(total).toBe(3);
  });
});
