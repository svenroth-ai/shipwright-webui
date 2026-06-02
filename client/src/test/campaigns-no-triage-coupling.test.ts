/**
 * AC-8 import-boundary guard (FR-01.31): the Campaigns lane must NOT couple
 * into the Triage surface. We assert no triage source file imports anything
 * from a `campaign` module. Triage is the decision queue; a campaign is
 * post-decision execution — they share no code.
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

describe("AC-8: Campaigns lane does not couple into the Triage surface", () => {
  it("collected a non-trivial set of triage files to scan", () => {
    expect(triageFiles.length).toBeGreaterThanOrEqual(5);
  });

  it("no triage source file imports a campaign module", () => {
    const offenders: string[] = [];
    for (const f of triageFiles) {
      for (const line of f.text.split("\n")) {
        const t = line.trim();
        if (!t.startsWith("import")) continue;
        if (/campaign/i.test(t)) offenders.push(`${f.path}: ${t}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
