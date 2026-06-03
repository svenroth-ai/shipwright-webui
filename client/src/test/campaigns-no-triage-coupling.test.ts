/**
 * AC-8 import-boundary guard (FR-01.31, amended FR-01.33): the Campaigns lane
 * must NOT couple into the Triage surface. Originally this forbade ANY
 * campaign import from a triage source file. FR-01.33
 * (iterate-2026-06-03-start-campaign-action) introduces ONE deliberate,
 * narrow cross-surface action — the Triage "Start Campaign" button — so the
 * guard now permits exactly that single sanctioned import
 * (`useStartCampaign` from `hooks/useStartCampaign`) while STILL forbidding
 * any coupling to the campaign LANE / rendering / API modules (CampaignLaneCard,
 * useCampaigns, selectActiveCampaigns, campaignsApi, campaign-store, …). The
 * hook itself lives outside the triage surface and owns the campaign-API call,
 * so the lane internals stay invisible to triage code.
 *
 * Uses dynamic node imports (like doc-sync.test.ts) so the client tsc run
 * stays free of @types/node.
 */

import { describe, it, expect, beforeAll } from "vitest";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let triageFiles: Array<{ path: string; text: string }> = [];

beforeAll(async () => {
  const fs = await import("node:fs" as string);
  const path = await import("node:path" as string);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const url = (await import("node:url" as string)) as any;
  const here = path.dirname(url.fileURLToPath((import.meta as any).url));
  // client/src/test → ../../../ = repo (worktree) root
  const repoRoot = path.resolve(here, "../../../");

  const explicit = [
    "client/src/pages/TriagePage.tsx",
    "client/src/hooks/useTriage.ts",
    "client/src/lib/triageApi.ts",
    "server/src/routes/triage.ts",
    "server/src/core/triage-store.ts",
    "server/src/core/triage-paths.ts",
    "server/src/core/triage-write.ts",
    "server/src/core/triage-lock.ts",
    "server/src/types/triage.ts",
  ];

  const triageComponentsDir = path.join(repoRoot, "client/src/components/triage");
  const componentFiles: string[] = [];
  try {
    for (const name of fs.readdirSync(triageComponentsDir)) {
      if (/\.(ts|tsx)$/.test(name)) {
        componentFiles.push(path.join("client/src/components/triage", name));
      }
    }
  } catch {
    /* dir absent in some checkouts — explicit list still covers the surface */
  }

  const all = [...explicit, ...componentFiles];
  triageFiles = [];
  for (const rel of all) {
    const abs = path.join(repoRoot, rel);
    if (!fs.existsSync(abs)) continue;
    triageFiles.push({ path: rel, text: fs.readFileSync(abs, "utf8") });
  }
});

// The ONE sanctioned cross-surface import (FR-01.33): the Start Campaign
// action hook. Strict on the symbol (only `useStartCampaign`) so a stray
// `CampaignLaneCard` / `useCampaigns` / bundled-symbol import still trips.
const SANCTIONED_CAMPAIGN_IMPORT =
  /^import\s*\{\s*useStartCampaign\s*\}\s*from\s*["'][^"']*useStartCampaign(\.js)?["'];?$/;

// A triage file importing a SIBLING triage-surface module (relative "./…")
// stays inside the triage surface — the campaign LANE lives in
// components/external (CampaignLaneCard), never in "./". So a campaign-named
// SIBLING component (e.g. ./CampaignStartCta, the triage-owned Start Campaign
// CTA view) is intra-surface and allowed. The FORBIDDEN-modules check below
// still hard-blocks any lane/API import regardless of path.
const SIBLING_TRIAGE_IMPORT = /from\s+["']\.\/[^"']*["']/;

// Lane / rendering / API modules that triage code must NEVER import, even
// after the FR-01.33 relaxation. Substring match against the import line.
const FORBIDDEN_CAMPAIGN_MODULES = [
  "campaignsApi",
  "useCampaigns",
  "CampaignLaneCard",
  "selectActiveCampaigns",
  "campaign-store",
];

describe("AC-8: Campaigns lane does not couple into the Triage surface", () => {
  it("collected a non-trivial set of triage files to scan", () => {
    expect(triageFiles.length).toBeGreaterThanOrEqual(5);
  });

  it("no triage source file imports a campaign module (except the sanctioned Start Campaign action)", () => {
    const offenders: string[] = [];
    for (const f of triageFiles) {
      for (const line of f.text.split("\n")) {
        const t = line.trim();
        if (!t.startsWith("import")) continue;
        if (!/campaign/i.test(t)) continue;
        if (SANCTIONED_CAMPAIGN_IMPORT.test(t)) continue;
        if (SIBLING_TRIAGE_IMPORT.test(t)) continue;
        offenders.push(`${f.path}: ${t}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("no triage source file imports a campaign LANE / API module (relaxation stays narrow)", () => {
    const offenders: string[] = [];
    for (const f of triageFiles) {
      for (const line of f.text.split("\n")) {
        const t = line.trim();
        if (!t.startsWith("import")) continue;
        for (const mod of FORBIDDEN_CAMPAIGN_MODULES) {
          if (t.includes(mod)) offenders.push(`${f.path}: ${t}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
