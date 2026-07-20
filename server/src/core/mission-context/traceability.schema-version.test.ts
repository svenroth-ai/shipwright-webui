/*
 * traceability.schema-version.test.ts — the CROSS-REPO CONTRACT-VERSION guard on
 * the test-traceability manifest reader.
 *
 * The manifest (`.shipwright/compliance/test-traceability.json`) is produced by a
 * DIFFERENT repo — the shipwright plugins. When that side bumps `schema_version`,
 * this observer must SAY SO rather than read an unknown-newer shape in silence:
 * a silent read is the exact drift this guard exists to surface. The guard is
 * deliberately non-fatal — an older observer must never lock a user out of a
 * newer project (the documented `contract-version.ts` fail-soft policy).
 *
 * Split out of `traceability.test.ts` to keep both files under the 300-LOC
 * guideline; this is the schema-regression coverage the reader previously lacked.
 *
 * @covers FR-01.66
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { readTraceabilityIndex, TRACEABILITY_REL } from "./traceability.js";
import { TRACEABILITY_SCHEMA_VERSION, _resetWarnMemo } from "../contract-version.js";

function projectWithManifest(body: string): string {
  const root = mkdtempSync(join(tmpdir(), "mc-trace-ver-"));
  mkdirSync(join(root, ".shipwright", "compliance"), { recursive: true });
  writeFileSync(join(root, ...TRACEABILITY_REL.split("/")), body, "utf-8");
  return root;
}

/**
 * The real schema shape reduced to what the index reads, with an explicit (or
 * omitted) `schema_version`. Passing `undefined` writes NO `schema_version`
 * field, modelling an older manifest from before the field existed.
 */
function manifestVersioned(schemaVersion: number | undefined, requirements: unknown): string {
  const obj: Record<string, unknown> = { generated_at: "2026-07-18T00:00:00Z", requirements };
  if (schemaVersion !== undefined) obj.schema_version = schemaVersion;
  return JSON.stringify(obj);
}

/** A minimal-but-valid requirements block that yields exactly one file entry. */
const ONE_GOOD_REQUIREMENT = {
  a: { id: "FR-01.01", tests: { unit: [{ id: "x.test.ts::a", layer: "unit" }] } },
};

describe("readTraceabilityIndex — schema-version contract check (fail-soft)", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    _resetWarnMemo(); // the "warn once" memo is module-global; isolate each case
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("WARNS (once) when schema_version is ahead of what this build knows — and still reads it", () => {
    const root = projectWithManifest(
      manifestVersioned(TRACEABILITY_SCHEMA_VERSION + 1, ONE_GOOD_REQUIREMENT),
    );
    try {
      const idx = readTraceabilityIndex(root);
      // Fail-soft: an ahead-of-us manifest is still inverted into a real index.
      expect(idx.status).toBe("ok");
      if (idx.status !== "ok") return;
      expect(idx.byFile.get("x.test.ts")?.frs).toEqual([{ frId: "FR-01.01", mappedFrom: null }]);

      // …but the drift is now on the record, tagged to the manifest + field.
      expect(warnSpy).toHaveBeenCalledTimes(1);
      const payload = JSON.parse(String(warnSpy.mock.calls[0][0]));
      expect(payload.event).toBe("contract_version_ahead");
      expect(payload.field).toBe("schema_version");
      expect(payload.declared).toBe(TRACEABILITY_SCHEMA_VERSION + 1);
      expect(payload.knownMax).toBe(TRACEABILITY_SCHEMA_VERSION);
      expect(String(payload.artefact)).toContain("test-traceability");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("does NOT warn when schema_version equals the known max", () => {
    const root = projectWithManifest(
      manifestVersioned(TRACEABILITY_SCHEMA_VERSION, ONE_GOOD_REQUIREMENT),
    );
    try {
      expect(readTraceabilityIndex(root).status).toBe("ok");
      expect(warnSpy).not.toHaveBeenCalled();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("does NOT warn when schema_version is ABSENT — an older manifest still reads clean", () => {
    // contract-version.ts treats missing/undefined as fine on purpose: the field
    // only landed later, and refusing older files would defeat fail-soft.
    const root = projectWithManifest(manifestVersioned(undefined, ONE_GOOD_REQUIREMENT));
    try {
      expect(readTraceabilityIndex(root).status).toBe("ok");
      expect(warnSpy).not.toHaveBeenCalled();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("warns but does NOT lose the index when a version-ahead manifest carries fold provenance", () => {
    // The one behaviour that must survive an ahead-of-us read: the requirement
    // links (incl. `mappedFrom`) the whole Tests artifact depends on.
    const root = projectWithManifest(
      manifestVersioned(TRACEABILITY_SCHEMA_VERSION + 5, {
        k: {
          id: "FR-01.28",
          tests: { unit: [{ id: "t.test.ts::x", layer: "unit", resolved_from: "FR-01.44" }] },
        },
      }),
    );
    try {
      const idx = readTraceabilityIndex(root);
      expect(idx.status).toBe("ok");
      if (idx.status !== "ok") return;
      expect(idx.byFile.get("t.test.ts")?.frs).toEqual([{ frId: "FR-01.28", mappedFrom: "FR-01.44" }]);
      expect(warnSpy).toHaveBeenCalledTimes(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
