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
 *   - `.github/workflows/ci.yml` runs vitest for `client` and `server` ONLY.
 *     There is no bootstrapper job, so the bootstrapper's own suite — every
 *     test for three of the four sites — never runs in CI at all.
 *
 * This file is therefore the durable, CI-enforced replacement for the four
 * suppressions. It is a source scan (the `ci-action-pinning-posture.test.ts`
 * pattern) precisely so it can reach across into `bootstrapper/`, which vitest
 * would otherwise never look at. Reading a sibling package's file is not an
 * import, so DO-NOT #7 is untouched.
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
