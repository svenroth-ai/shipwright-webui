/*
 * core/mission-context/artifacts-tests-ac.ts — the per-AC regrouping of the
 * Tests artifact's file rows (split from artifacts-tests.ts at the 300-LOC
 * rule).
 *
 * A VIEW over `TestRow[].frs[].acIds`, which `traceability.ts` already
 * populates as a pure relay of the v4 manifest's `ac_id`. This module
 * computes NO binding of its own — it only regroups rows that already exist
 * by `(frId, acId)` instead of by file. `tagged: false` (the common case
 * today — 0/33 requirements in this repo's manifest carry `ac_id`) must
 * render as "not yet tagged", never as an empty coverage table.
 */

import type { AcTestGroup, TestRow } from "./types-slice2.js";

export function groupByAc(rows: TestRow[]): { tagged: boolean; groups: AcTestGroup[] } {
  const byKey = new Map<string, AcTestGroup>();
  for (const row of rows) {
    for (const fr of row.frs) {
      for (const acId of fr.acIds) {
        const key = `${fr.frId}::${acId}`;
        let group = byKey.get(key);
        if (!group) {
          group = { frId: fr.frId, acId, files: [] };
          byKey.set(key, group);
        }
        group.files.push({ path: row.path, kind: row.kind });
      }
    }
  }
  const groups = [...byKey.values()].sort(
    (a, b) => a.frId.localeCompare(b.frId) || a.acId.localeCompare(b.acId),
  );
  return { tagged: groups.length > 0, groups };
}
