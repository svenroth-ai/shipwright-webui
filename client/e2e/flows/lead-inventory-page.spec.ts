/*
 * Lead Inventory page — real-browser smoke (iterate-2026-09-08-lead-
 * inventory-page). Same isolated-stack fixture pattern as
 * org-page.register.spec.ts: `~/.claude/leads/` is this file's own fixture
 * root under the harness's isolated HOME — never the operator's real
 * leads. `assertIsolatedLeadsRoot()` below refuses to run without
 * SHIPWRIGHT_E2E_ISOLATED=1 AND a resolved root under the OS temp
 * directory — unconditionally, including when `SHIPWRIGHT_LEADS_ROOT` is
 * set (doubt review, high/reversibility: that override used to skip every
 * check on its own) — per Internal Plan Review finding #10.
 *
 *   AC-1 — a lead with beats+steps renders both, band chips included.
 *   AC-2a — a beat carrying an unclaimed-effect audit entry renders a
 *     visible warning ON the beat.
 *   AC-4 — the authority panel renders per-band prose read from the
 *     charter, in the same order as the vocabulary.
 */
import { test, expect } from "@playwright/test";
import { existsSync, mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import os, { homedir } from "node:os";

import { computeLastNightWindow } from "../../src/lib/auditTimelineMerge";

// `|| undefined` (not `??`) so an accidentally-empty-string override does
// not silently fall through to a relative "" path (mkdirSync("") /
// writeFileSync("") resolve against the process CWD, not an isolated root —
// Stage-2 code review, low/correctness). One predicate, reused below.
const LEADS_ROOT_OVERRIDE = process.env.SHIPWRIGHT_LEADS_ROOT || undefined;
const LEADS_ROOT = LEADS_ROOT_OVERRIDE ?? path.join(homedir(), ".claude", "leads");
const CHART_PATH = path.join(LEADS_ROOT, "org-chart.json");
const LEAD_ID = "acme-lead";
const BEAT_ID = "9f1c9e2a-2b1e-4a1e-9c1e-1a2b3c4d5e6f";

/** Walks up from `target` to the nearest directory that actually exists —
 *  `LEADS_ROOT` itself may not exist yet on a first run. */
function nearestExistingAncestor(target: string): string {
  let dir = path.resolve(target);
  while (!existsSync(dir)) {
    const parent = path.dirname(dir);
    if (parent === dir) break; // reached the filesystem root
    dir = parent;
  }
  return dir;
}

/*
 * This spec writes to and DELETES `LEADS_ROOT` — under the real operator's
 * home that is live lead data (the reason this iterate exists at all), not
 * disposable scaffolding. Mirrors the guard in e2e/live-quarantine.mjs,
 * which requires BOTH SHIPWRIGHT_E2E_ISOLATED=1 AND a temporary profile —
 * no override escapes that AND. This spec ORIGINALLY let an explicit
 * SHIPWRIGHT_LEADS_ROOT win outright with zero further check (doubt review,
 * high/reversibility): SHIPWRIGHT_LEADS_ROOT is not a test-only knob, it is
 * a real server config override (`server/src/config.ts`) a developer could
 * plausibly have set in their normal dev shell for an unrelated reason —
 * pointed at their REAL leads directory — and then run this one spec
 * directly (`npx playwright test lead-inventory-page.spec.ts`, bypassing
 * isolated-stack.mjs entirely, a completely ordinary "iterate on just this
 * spec" workflow). The old guard's `if (LEADS_ROOT_OVERRIDE) return;`
 * skipped every check for exactly that case. SHIPWRIGHT_E2E_ISOLATED=1 is
 * now REQUIRED unconditionally — matching live-quarantine.mjs's AND, not an
 * OR — and the override, when present, additionally still passes through
 * the SAME realpath-under-tmpdir containment check as the default root:
 * the override exists to let a caller point at a DIFFERENT isolated
 * directory (e.g. a CI runner's own temp profile), never to skip isolation
 * proof altogether. The ACTUAL target (not a re-derived HOME/USERPROFILE
 * proxy — Stage-2 code review, high/correctness: checking `HOME ||
 * USERPROFILE` instead of the value `os.homedir()` itself actually used
 * inverts Node's own precedence on Windows and can fail-open) resolves via
 * `realpathSync.native`, which also closes a symlink escape (a symlink
 * under tmpdir pointing at the real home would otherwise pass a naive
 * containment check) and macOS's `/var` vs. `/private/var` alias in the
 * same call — no manual case-normalization needed.
 */
function assertIsolatedLeadsRoot() {
  if (process.env.SHIPWRIGHT_E2E_ISOLATED !== "1") {
    throw new Error(
      `Refusing to run: this spec writes to and deletes ${LEADS_ROOT}. Run it via ` +
        "e2e/isolated-stack.mjs (sets SHIPWRIGHT_E2E_ISOLATED=1 + a temporary HOME).",
    );
  }
  const resolvedTmp = realpathSync.native(os.tmpdir());
  const resolvedTarget = realpathSync.native(nearestExistingAncestor(LEADS_ROOT));
  const relative = path.relative(resolvedTmp, resolvedTarget);
  const withinTmp = relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
  if (!withinTmp) {
    throw new Error(
      `Refusing to run: this spec writes to and deletes ${LEADS_ROOT}, which does not resolve ` +
        "under the OS temp directory even with SHIPWRIGHT_E2E_ISOLATED=1 set. Point " +
        "SHIPWRIGHT_LEADS_ROOT (if set) at a directory under the isolated temp profile.",
    );
  }
}

function removeChart() {
  assertIsolatedLeadsRoot();
  rmSync(LEADS_ROOT, { recursive: true, force: true });
}

function writeChart() {
  assertIsolatedLeadsRoot();
  mkdirSync(LEADS_ROOT, { recursive: true });
  writeFileSync(
    CHART_PATH,
    JSON.stringify({
      version: 1,
      po: "sven",
      leads: {
        [LEAD_ID]: {
          domain: "Acme",
          name: "Acme Lead",
          reports_to: null,
          manages: [],
          charter_path: "charter.md",
        },
      },
    }),
    "utf8",
  );
}

/*
 * A timestamp inside "last night" no matter when the suite runs — the
 * MIDPOINT of the real `computeLastNightWindow(now)` window, exactly as
 * `LeadInventoryPage.test.tsx` derives its own fixture timestamp. External
 * code review (both reviewers independently): the original version
 * hand-rolled its own copy of `computeLastNightWindow`'s anchor-shift
 * logic ("today06, or yesterday06 if `now` is before today's 06:00, minus
 * 3h") instead of importing the real function. Verified by concrete date
 * math (`node -e` against both functions for a 02:00 run) that the
 * hand-rolled version was NOT actually producing an out-of-window
 * timestamp — it mirrored the same conditional shift `computeLastNightWindow`
 * itself applies, so the two were never actually out of sync — but a
 * second, independent hand-rolled copy of branch-sensitive date math is
 * exactly the kind of duplication that invites this false-positive
 * (and would invite a REAL divergence on the next edit to either copy).
 * Importing the real function removes the duplication and the ambiguity
 * both reviewers hit tracing it by hand.
 */
function withinLastNight(): string {
  const { sinceMs, untilMs } = computeLastNightWindow(new Date());
  return new Date((sinceMs + untilMs) / 2).toISOString();
}

test.describe("Lead Inventory page", () => {
  test.afterEach(() => removeChart());

  test("a lead with beats and steps renders both, band chips included, plus its authority panel (AC-1/AC-4)", async ({ page }) => {
    writeChart();
    const leadDir = path.join(LEADS_ROOT, LEAD_ID);
    mkdirSync(path.join(leadDir, "beats", BEAT_ID), { recursive: true });
    const startedAt = withinLastNight();
    writeFileSync(
      path.join(leadDir, "beat-register.json"),
      JSON.stringify({
        version: 1,
        entries: [{ sessionId: "s1", beatId: BEAT_ID, leadId: LEAD_ID, pid: 4242, startedAt, closedAt: startedAt }],
      }),
      "utf8",
    );
    writeFileSync(
      path.join(leadDir, "beats", BEAT_ID, "steps.jsonl"),
      `${JSON.stringify({ at: startedAt, band: "bugfix", summary: "fixed a typo in the README", effect: { kind: "none" } })}\n`,
      "utf8",
    );
    writeFileSync(
      path.join(leadDir, "charter.md"),
      [
        "## Bugfix / bekannter Defekt",
        "Fix small, well-understood defects without asking.",
        "",
        "## Kleine Pflege",
        "Routine upkeep.",
        "",
        "## Neues Feature",
        "Ask first.",
        "",
        "## Architektur / Grundsatz",
        "Ask first.",
      ].join("\n"),
      "utf8",
    );

    await page.goto("/org/inventory");
    const section = page.getByTestId(`lead-inventory-section-${LEAD_ID}`);
    await expect(section).toBeVisible();
    await expect(section.getByTestId("authority-panel-completeness")).toHaveText("4/4 declared");
    await expect(section.getByTestId(`beat-card-${BEAT_ID}`)).toBeVisible();
    await expect(section.getByTestId(`beat-steps-${BEAT_ID}`)).toContainText("fixed a typo in the README");
    await expect(section.getByTestId("band-chip-bugfix").first()).toBeVisible();
  });

  test("a beat carrying an unclaimed-effect audit entry renders a visible warning ON the beat (AC-2a)", async ({ page }) => {
    writeChart();
    const leadDir = path.join(LEADS_ROOT, LEAD_ID);
    mkdirSync(leadDir, { recursive: true });
    const startedAt = withinLastNight();
    writeFileSync(
      path.join(leadDir, "beat-register.json"),
      JSON.stringify({
        version: 1,
        entries: [{ sessionId: "s1", beatId: BEAT_ID, leadId: LEAD_ID, pid: 4242, startedAt, closedAt: startedAt }],
      }),
      "utf8",
    );
    writeFileSync(
      path.join(leadDir, "audit.jsonl"),
      `${JSON.stringify({ ts: startedAt, kind: "beat_effect_not_claimed", lead_id: LEAD_ID, beat_id: BEAT_ID })}\n`,
      "utf8",
    );

    await page.goto("/org/inventory");
    const section = page.getByTestId(`lead-inventory-section-${LEAD_ID}`);
    await expect(section).toBeVisible();
    const warning = section.getByTestId("unclaimed-effect-warning");
    await expect(warning).toBeVisible();
    await expect(warning).toContainText(/effect no step accounts for/i);
  });
});
