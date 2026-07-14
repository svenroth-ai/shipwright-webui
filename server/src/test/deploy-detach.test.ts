/**
 * CI-gated regression guard for the production deploy's detach contract
 * (iterate-2026-07-14-deploy-self-kill).
 *
 * THE OUTAGE THIS PINS. `start-server-production.ps1` used to (2) kill the old
 * server and (3) start the new one, both inline. Launched from the Command
 * Center's embedded terminal — the normal case for any Claude session the WebUI
 * starts — the script is a DESCENDANT of the Hono server it kills:
 *
 *     Hono (:PORT) -> node-pty shell -> claude -> the deploy script
 *            ^                                          |
 *            +-------------- step 2 kills it -----------+
 *
 * Killing Hono tears down the ConPTY, which kills the pty shell and everything
 * under it. The script died at step 2; step 3 never ran. Outcome: a current
 * build on disk, NO server, and not one line of diagnostic output — the process
 * that would have reported the failure was the one that died (2026-07-14, ~4 h
 * of downtime; the operator had to start the server by hand).
 *
 * THE CONTRACT. The caller may build (a failed build must leave the running
 * server untouched — the ORDER MATTERS rule), but it must NOT perform the kill.
 * Kill + start + readiness + post-restart heal belong to `deploy-swap.mjs`,
 * which the caller spawns DETACHED *before* any kill happens, so the swapper
 * outlives the cascade that kills the caller.
 *
 * THIS FILE pins the CALLER's half of that contract; the swapper's half lives in
 * deploy-swap-contract.test.ts.
 *
 * WHY HERE and not in scripts/ alongside the other deploy assertions: those run
 * under `node --test`, and CI runs neither — the server vitest `include` matches
 * TypeScript test files only. A guard that never executes is not a guard, and
 * this one protects against a silent, total outage. Text assertions only (the
 * .mjs is never imported) so the scripts stay outside the coverage/diff-cover
 * scope, same as every other file under scripts/.
 */

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../../");
const scripts = path.join(repoRoot, "scripts");

const read = (f: string) => fs.readFileSync(path.join(scripts, f), "utf8");

const ps1 = read("start-server-production.ps1");
const sh = read("start-server-production.sh");
// (the swapper contract itself is pinned in deploy-swap-contract.test.ts)

/** Non-comment code lines (`#` starts a line comment in both PowerShell and sh). */
const codeLines = (src: string) =>
  src.split(/\r?\n/).filter((l) => !l.trimStart().startsWith("#"));

const callers: Array<[string, string]> = [
  ["start-server-production.ps1", ps1],
  ["start-server-production.sh", sh],
];

describe("deploy caller: performs NO server-kill (it would kill itself)", () => {
  // The kill primitives, per platform. If a future edit moves ANY of these back
  // into a caller, that caller can once again die mid-deploy and strand the
  // machine with no server. This is the assertion that fails first.
  const KILL_PRIMITIVES: Array<[string, RegExp]> = [
    ["PowerShell Stop-Process", /Stop-Process/i],
    ["PowerShell taskkill", /taskkill/i],
    ["POSIX kill", /(^|\s)kill\s+(-\w+\s+)?["$]/],
    // `lsof -ti tcp:$PORT | xargs kill -9` is the most idiomatic way this would be
    // re-introduced, and nothing quote-like follows `kill` there.
    ["POSIX xargs kill", /\bxargs\s+kill\b/],
    ["POSIX kill -N", /\bkill\s+-?\d/],
    ["POSIX pkill/pgrep-kill", /pkill/],
  ];

  for (const [name, src] of callers) {
    for (const [primitive, re] of KILL_PRIMITIVES) {
      it(`${name}: no ${primitive}`, () => {
        const offenders = codeLines(src).filter((l) => re.test(l));
        expect(
          offenders,
          `${name} must not kill anything itself — the server-kill takes the ` +
            `caller down with it (ConPTY cascade) and the deploy dies half-done. ` +
            `Delegate to deploy-swap.mjs.`,
        ).toEqual([]);
      });
    }
  }
});

describe("start-server-production.ps1: stays parseable by Windows PowerShell 5.1", () => {
  it("has no non-ASCII character on a CODE line (an em dash there kills the whole script)", () => {
    // The embedded terminal spawns powershell.exe — Windows PowerShell 5.1, not
    // pwsh 7 — and 5.1 reads a BOM-less file as cp1252. An em dash (UTF-8 E2 80 94)
    // then decodes to `â€”`, whose 0x94 byte is a curly closing quote — which 5.1
    // accepts as a STRING TERMINATOR. One em dash inside a double-quoted string
    // therefore breaks the script's syntax, and the deploy silently never starts:
    // no kill, no swapper, no error anyone sees. Cost me a full E2E cycle to find.
    // Comments are safe (they run to end-of-line), which is why the pre-fix script
    // could carry arrows and dashes in its header — but never in code.
    const offenders = ps1
      .split(/\r?\n/)
      .map((l, i) => [l, i + 1] as const)
      .filter(([l]) => !l.trimStart().startsWith("#"))
      .filter(([l]) => [...l].some((c) => c.charCodeAt(0) > 127))
      .map(([l, n]) => `line ${n}: ${l.trim()}`);
    expect(
      offenders,
      "keep executable lines ASCII-only (use '-' not '—'); non-ASCII belongs in comments",
    ).toEqual([]);
  });
});

describe("deploy caller: hands off to the detached swapper AFTER the build", () => {
  for (const [name, src] of callers) {
    it(`${name}: invokes deploy-swap.mjs`, () => {
      expect(codeLines(src).some((l) => /deploy-swap\.mjs/.test(l))).toBe(true);
    });

    it(`${name}: the hand-off runs after the last build (a failed build leaves the old server untouched)`, () => {
      const lines = codeLines(src);
      const lastBuild = lines.map((l) => /npm run build/.test(l)).lastIndexOf(true);
      const handoff = lines.map((l) => /deploy-swap\.mjs/.test(l)).indexOf(true);
      expect(lastBuild, "expected an `npm run build` step").toBeGreaterThanOrEqual(0);
      expect(handoff, "expected a deploy-swap.mjs hand-off").toBeGreaterThanOrEqual(0);
      expect(
        handoff,
        "the swapper must be spawned only after the build succeeded — otherwise a " +
          "failed build would still tear down the running server (ORDER MATTERS).",
      ).toBeGreaterThan(lastBuild);
    });

    it(`${name}: does not start the server itself anymore`, () => {
      const offenders = codeLines(src).filter((l) => /dist[\\/]index\.js/.test(l));
      expect(
        offenders,
        `${name} must not launch dist/index.js — the launch belongs to the swapper, ` +
          `which survives the kill; a launch in the caller is unreachable code the ` +
          `moment the kill lands.`,
      ).toEqual([]);
    });

    it(`${name}: EVERY install/build step aborts on failure (order alone does not protect AC3)`, () => {
      // Ordering assertions ("hand-off comes after the build") stay green even if
      // every abort guard is deleted — and then a FAILED build walks straight into
      // the hand-off, which kills the running server unconditionally. Pin the abort
      // itself: each npm step must be followed by a guard that leaves the script.
      const lines = codeLines(src);
      const isPs1 = name.endsWith(".ps1");
      // The INVOCATION lines only — `& npm install` / `npm run build || …`, not the
      // `Write-Host 'Installing server deps (npm install)...'` progress messages.
      const steps = lines
        .map((l, i) => [l, i] as const)
        .filter(([l]) => /^\s*&?\s*npm\s+(install|run build)\b/.test(l));
      expect(steps.length, "expected npm install + npm run build steps").toBeGreaterThanOrEqual(4);

      for (const [line, i] of steps) {
        const guarded = isPs1
          ? // PowerShell: an exit-code check within the next few lines that exits.
            lines
              .slice(i + 1, i + 4)
              .some((l) => /\$LASTEXITCODE -ne 0/.test(l)) &&
            lines.slice(i + 1, i + 10).some((l) => /\bexit 1\b/.test(l))
          : // sh: the abort is on the step line itself.
            /\|\|\s*fail_untouched/.test(line);
        expect(
          guarded,
          `${name}: "${line.trim()}" has no abort guard. Without it a failed build ` +
            `reaches the hand-off and the swapper kills the running server for a ` +
            `build that never produced anything (AC3).`,
        ).toBe(true);
      }
    });
  }

  it("start-server-production.ps1: spawns the swapper detached (Start-Process survives the pty cascade)", () => {
    const handoff = codeLines(ps1).find((l) => /deploy-swap\.mjs/.test(l)) ?? "";
    expect(handoff).toMatch(/Start-Process/i);
  });

  it("start-server-production.sh: spawns the swapper detached (nohup/setsid ignore the SIGHUP the dying pty sends)", () => {
    const handoff = codeLines(sh)
      .filter((l) => /deploy-swap\.mjs/.test(l))
      .join("\n");
    expect(handoff).toMatch(/nohup|setsid/);
  });
});

describe("deploy caller: takes its verdict from the swapper, never from a bare listener", () => {
  // The caller CANNOT judge the deploy by "is anything listening on $PORT". Its
  // first probe fires long before the swapper can have killed anything, so it would
  // see the PRE-KILL server and print a green OK over a deploy that has not
  // happened — and if the swap then fails, that green OK sits on top of a machine
  // with no server: the original outage, wearing a success message. Only the
  // swapper can tell, because it checks that the listener belongs to the child IT
  // started.
  for (const [name, src] of callers) {
    it(`${name}: reads deploy-status.json`, () => {
      expect(src).toMatch(/deploy-status\.json/);
    });

    it(`${name}: only accepts a FRESH verdict (a previous deploy's file must not count)`, () => {
      const marker = name.endsWith(".ps1") ? /\$startedAt/ : /started_at/;
      expect(
        src,
        "compare the status file's ts against the hand-off time — a stale `ok: true` " +
          "from an earlier deploy is the most misleading thing this script could print",
      ).toMatch(marker);
    });

    it(`${name}: success is NEVER declared on a bare listener check`, () => {
      // The listener probe may still appear as a DIAGNOSTIC in the failure branch
      // ("something is still listening — probably the OLD server"), but it must not
      // be what sets the success flag.
      const lines = codeLines(src);
      const successFlag = name.endsWith(".ps1")
        ? lines.filter((l) => /\$up\s*=|\$verdict\.ok/.test(l))
        : lines.filter((l) => /^\s*(up|verdict)=/.test(l) || /up=true/.test(l));
      const listenerSetsSuccess = successFlag.some((l) =>
        /Get-NetTCPConnection|lsof/.test(l),
      );
      expect(
        listenerSetsSuccess,
        `${name}: a listener check must not set the success flag — it answers "yes" ` +
          `for the OLD server that is still running before (or despite) the swap.`,
      ).toBe(false);
    });
  }
});
