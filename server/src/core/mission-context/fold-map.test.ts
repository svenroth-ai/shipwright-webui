/*
 * fold-map.test.ts — folded FR id → surviving parent (CONTRACT §3.1 / AC2).
 *
 * The canonical case is pinned against the REAL repo spec.md as well as a
 * fixture: AC2 names `FR-01.44 → FR-01.28` explicitly, and a parser that
 * silently stopped matching the real table would otherwise pass forever.
 *
 * @covers FR-01.66
 */

import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";

import { _clearFoldMapCache, loadFoldMap, parseFoldMap, resolveFr, resolveFrList } from "./fold-map.js";

const FIXTURE = `
## Functional Requirements

| ID | Area | Name | Priority | Description | Origin |
|----|------|------|----------|-------------|--------|
| FR-01.28 | TRM | Embedded terminal | Must | A real terminal … | iterate-x |
| FR-01.66 | TSK | Mission view (live session) | Should | The Mission tab … | iterate-y |

## FR-Fold-Map

| Folded | Parent | Kind | Note |
|---|---|---|---|
| \`FR-01.44\` | \`FR-01.28\` | delta | Embedded terminal appearance |
| \`FR-01.55\` | \`FR-01.66\` | delta | The Record rail |
`;

describe("parseFoldMap", () => {
  it("separates capability rows from alias rows by shape", () => {
    const m = parseFoldMap(FIXTURE);
    expect(m.loaded).toBe(true);
    expect(m.entries.get("FR-01.28")?.name).toBe("Embedded terminal");
    expect(m.entries.get("FR-01.28")?.area).toBe("TRM");
    expect(m.folds.get("FR-01.44")).toBe("FR-01.28");
    // An alias row must NOT be mistaken for a capability row.
    expect(m.entries.has("FR-01.44")).toBe(false);
  });
});

describe("resolveFr", () => {
  const map = parseFoldMap(FIXTURE);

  it("resolves a folded id to its parent and records the provenance (AC2)", () => {
    const row = resolveFr(map, "FR-01.44");
    expect(row.displayFrId).toBe("FR-01.28");
    expect(row.originalFrId).toBe("FR-01.44");
    expect(row.mappedFrom).toBe("FR-01.44");
    expect(row.name).toBe("Embedded terminal");
  });

  it("leaves a surviving id untouched and sets NO mappedFrom", () => {
    const row = resolveFr(map, "FR-01.66");
    expect(row.displayFrId).toBe("FR-01.66");
    expect(row.mappedFrom).toBeNull();
    expect(row.area).toBe("TSK");
  });

  it("echoes an UNKNOWN id raw rather than blanking it (§3.1 honesty rule)", () => {
    const row = resolveFr(map, "FR-09.99");
    expect(row.displayFrId).toBe("FR-09.99");
    expect(row.name).toBeNull();
    expect(row.mappedFrom).toBeNull();
  });

  it("follows a fold CHAIN (a parent that was itself later folded)", () => {
    const chained = parseFoldMap(`
| \`FR-01.10\` | \`FR-01.20\` | delta | first hop |
| \`FR-01.20\` | \`FR-01.30\` | delta | second hop |
| FR-01.30 | TSK | Final capability | Must | … | x |
`);
    const row = resolveFr(chained, "FR-01.10");
    expect(row.displayFrId).toBe("FR-01.30");
    expect(row.name).toBe("Final capability");
  });

  it("terminates on a cyclic map instead of spinning", () => {
    const cyclic = parseFoldMap(`
| \`FR-01.10\` | \`FR-01.20\` | delta | a |
| \`FR-01.20\` | \`FR-01.10\` | delta | b |
`);
    const row = resolveFr(cyclic, "FR-01.10");
    expect(row.displayFrId).toBe("FR-01.20");
  });
});

describe("resolveFrList", () => {
  const map = parseFoldMap(FIXTURE);

  it("drops non-FR junk but keeps valid unknown ids", () => {
    const rows = resolveFrList(map, ["FR-01.44", "not-an-fr", "", "FR-09.99"]);
    expect(rows.map((r) => r.displayFrId)).toEqual(["FR-01.28", "FR-09.99"]);
  });

  it("collapses two folded ids that share one parent (no repeated capability)", () => {
    const rows = resolveFrList(map, ["FR-01.55", "FR-01.66"]);
    expect(rows).toHaveLength(1);
    expect(rows[0].displayFrId).toBe("FR-01.66");
    expect(rows[0].mappedFrom).toBe("FR-01.55");
  });
});

describe("loadFoldMap against the REAL adopted spec", () => {
  const projectRoot = join(import.meta.dirname, "..", "..", "..", "..");
  const hasSpec = existsSync(join(projectRoot, ".shipwright", "planning", "01-adopted", "spec.md"));

  it.runIf(hasSpec)("resolves the AC2 example FR-01.44 → FR-01.28 from the live table", () => {
    _clearFoldMapCache();
    const map = loadFoldMap(projectRoot);
    expect(map.loaded).toBe(true);
    const row = resolveFr(map, "FR-01.44");
    expect(row.displayFrId).toBe("FR-01.28");
    expect(row.mappedFrom).toBe("FR-01.44");
    expect(row.name).toContain("terminal");
  });

  it.runIf(hasSpec)("knows FR-01.66 as a TSK capability (this slice's own FR)", () => {
    _clearFoldMapCache();
    const map = loadFoldMap(projectRoot);
    const row = resolveFr(map, "FR-01.66");
    expect(row.displayFrId).toBe("FR-01.66");
    expect(row.area).toBe("TSK");
  });

  it("returns an unloaded map for a project without a spec (degrades, never throws)", () => {
    _clearFoldMapCache();
    const map = loadFoldMap(join(projectRoot, "does-not-exist-anywhere"));
    expect(map.loaded).toBe(false);
    expect(resolveFr(map, "FR-01.44").displayFrId).toBe("FR-01.44");
  });
});
