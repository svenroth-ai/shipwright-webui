/*
 * traceability.ac-ids.test.ts — the v4 `ac_id` relay (Slice-2, extends AC2's
 * fold-provenance suite in `traceability.test.ts`, split out to keep that
 * file under the 300-LOC rule).
 *
 * `readTraceabilityIndex` computes no AC binding of its own — it only
 * relays whatever `ac_id` the manifest already carries on a test link, the
 * same way it already relays `resolved_from`. `acIds: []` is the DEFAULT,
 * common-case shape (0/33 requirements in this repo's own manifest carry
 * `ac_id` as of iterate-2026-09-09) and must never be mistaken for a fault.
 *
 * @covers FR-01.66
 */

import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { readTraceabilityIndex, TRACEABILITY_REL } from "./traceability.js";

function projectWithManifest(body: string): string {
  const root = mkdtempSync(join(tmpdir(), "mc-trace-ac-"));
  mkdirSync(join(root, ".shipwright", "compliance"), { recursive: true });
  writeFileSync(join(root, ...TRACEABILITY_REL.split("/")), body, "utf-8");
  return root;
}

function manifest(requirements: unknown): string {
  return JSON.stringify({ schema_version: 4, generated_at: "2026-09-09T00:00:00Z", requirements });
}

describe("readTraceabilityIndex — AC ids (v4 `ac_id`, a pure relay)", () => {
  it("reads `ac_id` onto the file's fr link", () => {
    const root = projectWithManifest(
      manifest({
        k: {
          id: "FR-01.11",
          tests: { unit: [{ id: "a.test.ts::covers AC07", layer: "unit", ac_id: "AC07" }] },
        },
      }),
    );
    try {
      const idx = readTraceabilityIndex(root);
      if (idx.status !== "ok") throw new Error("expected ok");
      expect(idx.byFile.get("a.test.ts")?.frs).toEqual([
        { frId: "FR-01.11", mappedFrom: null, acIds: ["AC07"] },
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("unions AC ids across TWO cases on the same file for the same FR", () => {
    const root = projectWithManifest(
      manifest({
        k: {
          id: "FR-01.11",
          tests: {
            unit: [
              { id: "a.test.ts::covers AC07", layer: "unit", ac_id: "AC07" },
              { id: "a.test.ts::covers AC09", layer: "unit", ac_id: "AC09" },
            ],
          },
        },
      }),
    );
    try {
      const idx = readTraceabilityIndex(root);
      if (idx.status !== "ok") throw new Error("expected ok");
      const entry = idx.byFile.get("a.test.ts")!;
      expect(entry.frs).toHaveLength(1);
      expect(entry.frs[0].acIds.sort()).toEqual(["AC07", "AC09"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("does not cross-contaminate AC ids between two DIFFERENT files under the same FR", () => {
    const root = projectWithManifest(
      manifest({
        k: {
          id: "FR-01.11",
          tests: {
            unit: [
              { id: "a.test.ts::covers AC07", layer: "unit", ac_id: "AC07" },
              { id: "b.test.ts::covers AC09", layer: "unit", ac_id: "AC09" },
            ],
          },
        },
      }),
    );
    try {
      const idx = readTraceabilityIndex(root);
      if (idx.status !== "ok") throw new Error("expected ok");
      expect(idx.byFile.get("a.test.ts")?.frs[0].acIds).toEqual(["AC07"]);
      expect(idx.byFile.get("b.test.ts")?.frs[0].acIds).toEqual(["AC09"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("defaults `acIds` to `[]` — the v3-shaped bare-FR-tag case, not an error", () => {
    const root = projectWithManifest(
      manifest({ k: { id: "FR-01.11", tests: { unit: [{ id: "a.test.ts::x", layer: "unit" }] } } }),
    );
    try {
      const idx = readTraceabilityIndex(root);
      if (idx.status !== "ok") throw new Error("expected ok");
      expect(idx.byFile.get("a.test.ts")?.frs[0].acIds).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("ignores an empty-string or whitespace-only `ac_id` rather than tagging with nothing", () => {
    const root = projectWithManifest(
      manifest({
        k: {
          id: "FR-01.11",
          tests: { unit: [{ id: "a.test.ts::x", layer: "unit", ac_id: "   " }] },
        },
      }),
    );
    try {
      const idx = readTraceabilityIndex(root);
      if (idx.status !== "ok") throw new Error("expected ok");
      expect(idx.byFile.get("a.test.ts")?.frs[0].acIds).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
