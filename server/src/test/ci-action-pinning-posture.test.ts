/**
 * CI-gated regression guard for the action-pinning POSTURE
 * (iterate-2026-07-18-unpin-actions-no-dependabot, ADR — see decision_log.md).
 *
 * The posture is deliberately ASYMMETRIC, and that asymmetry is the whole point:
 *
 *   - GitHub's OWN actions (`actions/*`, `github/*`) use MUTABLE version tags, by
 *     choice. Pinning them to a SHA is only coherent alongside an updater that
 *     keeps the pins patched; without one a pin rots silently, which is worse
 *     than the mutable tag. We already trust this vendor to execute the entire
 *     CI run. (Since 2026-10-08 this repo DOES run Dependabot for the
 *     `github-actions` ecosystem, so the tags are kept by choice, no longer out
 *     of necessity — the adopter-facing posture is unchanged: the published
 *     package and the shipwright templates ship no updater config.)
 *   - THIRD-PARTY actions stay SHA-PINNED. That is where the real supply-chain
 *     risk sits: a compromised account can silently re-point a tag. The Semgrep
 *     tailoring webui opted into (#208) is owner-scoped for exactly this reason —
 *     `actions/*` + `github/*` are accepted, everything else stays flagged.
 *
 * PR #285 collapsed that asymmetry (pinned everything + added Dependabot for
 * every ecosystem) and was reverted. The updater is now allowed for
 * `github-actions` ONLY (iterate-2026-10-08-webui-dependabot-actions-only);
 * this file still fails loudly if a "harden the CI" sweep re-pins the
 * GitHub-owned actions, un-pins the third-party ones, or widens the updater to
 * application dependencies. Both pinning directions are asserted.
 *
 * Text assertions only — no YAML parser is a dependency of either workspace, and
 * one is not worth adding: GitHub refuses to run an invalid workflow, so the
 * PR's own green CI run is the authoritative proof of YAML validity.
 */

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../../");
const workflowDir = path.join(repoRoot, ".github", "workflows");

/**
 * Pull every `uses:` value out of one workflow body.
 *
 * Quotes are STRIPPED, and that is load-bearing rather than cosmetic: with the
 * quote left attached, `uses: 'actions/checkout@<sha>'` fails BOTH the
 * github-owned prefix check and the trailing-SHA check, so a quoted pin would
 * sail through every assertion below while looking guarded. A guard that can
 * silently pass is worse than no guard, so this is exercised directly against a
 * synthetic fixture rather than only against whatever the real files happen to
 * contain today. (Found in review of this file's first version.)
 */
function parseUses(body: string): string[] {
  return [...body.matchAll(/^\s*(?:-\s*)?uses:\s*(\S+)/gm)].map((m) =>
    m[1].replace(/^["']|["']$/g, ""),
  );
}

const workflows = fs.existsSync(workflowDir)
  ? fs.readdirSync(workflowDir).filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"))
  : [];

/** Every `uses:` reference across all workflows, as `{ file, ref }`. */
const allUses = workflows.flatMap((file) => {
  const body = fs.readFileSync(path.join(workflowDir, file), "utf8");
  return parseUses(body).map((ref) => ({ file, ref }));
});

const isGitHubOwned = (ref: string) =>
  ref.startsWith("actions/") || ref.startsWith("github/");

const pinnedSha = /@[0-9a-f]{40}$/;

describe("parseUses strips what would otherwise dodge every guard", () => {
  // Fixture, not the real files: the point is to prove the extraction survives
  // syntax the workflows do not use TODAY but legally could tomorrow.
  const fixture = [
    "jobs:",
    "  a:",
    "    steps:",
    "      - uses: actions/checkout@v4",
    "      - uses: 'actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020'",
    '      - uses: "github/codeql-action/init@v3"',
    "      # uses: actions/stale@v9",
    "      - name: quoted third-party",
    "        uses: 'peter-evans/create-or-update-comment@71345be0265236311c031f5c7866368bd1eff043'",
  ].join("\n");

  it("returns refs without surrounding quotes, and skips commented lines", () => {
    // The commented `# uses: actions/stale@v9` is absent below on purpose: `^\s*`
    // is followed by a REQUIRED `uses:`, so a leading `#` breaks the match. Review
    // raised this as a suspected hole; it is pinned here so it stays closed and
    // nobody has to re-derive the answer from the regex.
    expect(parseUses(fixture)).toEqual([
      "actions/checkout@v4",
      "actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020",
      "github/codeql-action/init@v3",
      "peter-evans/create-or-update-comment@71345be0265236311c031f5c7866368bd1eff043",
    ]);
  });

  it("classifies a QUOTED SHA-pinned github-owned ref as a violation", () => {
    // The regression this file shipped with: quote attached => neither
    // github-owned NOR SHA-shaped => invisible to both guards below.
    const refs = parseUses(fixture);
    const offenders = refs.filter((r) => isGitHubOwned(r) && pinnedSha.test(r));
    expect(offenders).toEqual([
      "actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020",
    ]);
  });
});

describe("GitHub-owned actions use mutable tags (no rot-prone pins)", () => {
  it("finds the workflows at all (guards a silent empty-set pass)", () => {
    // Without this, a moved/renamed directory would make every assertion below
    // vacuously true — the failure mode that hides a posture regression. These
    // are FLOORS, not expected values: workflows and steps get added over time,
    // so an exact count here would just be a chore. They only need to be high
    // enough that an empty or truncated read cannot slip past.
    expect(workflows.length).toBeGreaterThanOrEqual(6);
    expect(allUses.length).toBeGreaterThanOrEqual(10);
  });

  it("pins no actions/* or github/* reference to a commit SHA", () => {
    const pinned = allUses
      .filter((u) => isGitHubOwned(u.ref) && pinnedSha.test(u.ref))
      .map((u) => `${u.file}: ${u.ref}`);
    expect(pinned).toEqual([]);
  });
});

describe("third-party actions stay SHA-pinned (the real supply-chain risk)", () => {
  const thirdParty = allUses.filter((u) => !isGitHubOwned(u.ref));

  it("still has third-party actions to guard", () => {
    // If this ever legitimately drops to zero the assertions below go vacuous,
    // so fail here instead and make the author re-read this file.
    expect(thirdParty.length).toBeGreaterThan(0);
  });

  it("pins EVERY third-party reference to a full 40-char commit SHA", () => {
    const unpinned = thirdParty
      .filter((u) => !pinnedSha.test(u.ref))
      .map((u) => `${u.file}: ${u.ref}`);
    // A `@v1`-style tag is still mutable and does NOT satisfy this.
    expect(unpinned).toEqual([]);
  });
});

describe("the dependency updater is scoped to github-actions only", () => {
  // Both spellings are valid to GitHub; a stray `.yaml` would escape a one-file check.
  const body = ["dependabot.yml", "dependabot.yaml"]
    .map((n) => path.join(repoRoot, ".github", n))
    .filter((f) => fs.existsSync(f))
    .map((f) => fs.readFileSync(f, "utf8"))
    .join("\n");
  // Text assertions, no YAML parser (see header). Comment lines are dropped so a
  // sentence in a comment cannot satisfy or break a check.
  const code = body
    .split(/\r?\n/)
    .filter((l) => !/^\s*#/.test(l))
    .join("\n");
  const ecosystems = [...code.matchAll(/["']?package-ecosystem["']?:\s*["']?([\w-]+)/g)].map((m) => m[1]);

  it("has a dependabot.yml with at least one entry (empty-set pass guard)", () => {
    expect(ecosystems.length).toBeGreaterThan(0);
  });

  it("updates github-actions only — never npm or another application ecosystem", () => {
    // PR #285 added Dependabot for everything and was reverted: application
    // dependencies are covered by Trivy / npm audit, not by version-update PRs.
    expect(ecosystems.filter((e) => e !== "github-actions")).toEqual([]);
  });

  it("keeps the hand-pinned sibling-repo action out of the updater", () => {
    expect(code).toMatch(/dependency-name:\s*["']?svenroth-ai\/shipwright\/\*["']?\s*$/m);
  });

  it("gives every entry a cooldown (keeps the Semgrep dependabot-missing-cooldown rule satisfied)", () => {
    const cooldowns = [...code.matchAll(/^\s*["']?cooldown["']?:/gm)].length;
    expect(cooldowns).toBe(ecosystems.length);
  });
});

describe("github/codeql-action stays on the current major version", () => {
  // CodeQL Action v3 is deprecated December 2026 and drops Node.js 20 runner
  // support in fall 2026; v4 is the GA, Node-24-based replacement. This repo's
  // posture above keeps GitHub-owned actions on a MUTABLE tag rather than a SHA
  // (see the describe block above) — but "mutable" still means the tag itself
  // must be bumped by hand when GitHub deprecates the old one. This guards that
  // the bump actually happened, not just that some tag is present.
  const codeqlUses = allUses.filter((u) => u.ref.startsWith("github/codeql-action/"));

  it("has codeql-action steps to guard (empty-set pass guard)", () => {
    expect(codeqlUses.length).toBeGreaterThan(0);
  });

  it("keeps every github/codeql-action/* step on v4 or newer, none left on @v3", () => {
    // v4 OR NEWER: Dependabot bumps the major; only a fall back below v4 is a regression.
    const major = (ref: string) => Number(/@v(\d+)/.exec(ref)?.[1] ?? 0);
    const stale = codeqlUses
      .filter((u) => major(u.ref) < 4)
      .map((u) => `${u.file}: ${u.ref}`);
    expect(stale).toEqual([]);
  });
});

describe("the Semgrep owner-scoped acceptance stays wired", () => {
  it("keeps SHIPWRIGHT_SEMGREP_ACCEPT_GH_OWNED_ACTION_TAGS enabled", () => {
    // Chesterton-Fence: this flag is what keeps the mutable-tag findings on
    // GitHub-owned actions from re-appearing as triage noise. It is load-bearing
    // for the posture above, NOT dead configuration — removing it makes the
    // accepted risk look unaccepted again, which is how #285 started.
    const settings = fs.readFileSync(
      path.join(repoRoot, ".claude", "settings.json"),
      "utf8",
    );
    expect(JSON.parse(settings).env?.SHIPWRIGHT_SEMGREP_ACCEPT_GH_OWNED_ACTION_TAGS).toBe("1");
  });
});
