/*
 * traceability.test.ts — the manifest index + FOLD PROVENANCE (Slice-2 AC2).
 *
 * Two kinds of case here on purpose:
 *   - FIXTURES pin the contract (`resolved_from` → "mapped from", the bounding
 *     behaviour on a corrupt/oversized file);
 *   - a REAL-FILE probe against this repo's own 917 KB manifest pins that the
 *     inversion actually works on the producer's real output. A fixture-only
 *     suite would happily agree with a wrong reading of the real schema.
 *
 * @covers FR-01.66
 */

import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { readTraceabilityIndex, testIdToFile, TRACEABILITY_REL } from "./traceability.js";

function projectWithManifest(body: string): string {
  const root = mkdtempSync(join(tmpdir(), "mc-trace-"));
  mkdirSync(join(root, ".shipwright", "compliance"), { recursive: true });
  writeFileSync(join(root, ...TRACEABILITY_REL.split("/")), body, "utf-8");
  return root;
}

/** The real schema-v2 shape, reduced to what the index reads. */
function manifest(requirements: unknown): string {
  return JSON.stringify({ schema_version: 2, generated_at: "2026-07-18T00:00:00Z", requirements });
}

describe("testIdToFile", () => {
  it("splits `<file>::<test name>` on the FIRST separator", () => {
    expect(testIdToFile("client/src/a.test.ts::renders :: nested")).toBe("client/src/a.test.ts");
    expect(testIdToFile("client/src/a.test.ts")).toBe("client/src/a.test.ts");
  });

  it("normalises Windows separators so it can join against a git path", () => {
    expect(testIdToFile("client\\src\\a.test.ts::x")).toBe("client/src/a.test.ts");
    expect(testIdToFile("./client/src/a.test.ts::x")).toBe("client/src/a.test.ts");
  });

  it("returns null for an empty or non-string id", () => {
    expect(testIdToFile("")).toBeNull();
    expect(testIdToFile("   ")).toBeNull();
  });
});

describe("readTraceabilityIndex — fold provenance (AC2)", () => {
  it("carries `resolved_from` as `mappedFrom` when the fold MOVED the id", () => {
    const root = projectWithManifest(
      manifest({
        "01-adopted::FR-01.28": {
          id: "FR-01.28",
          tests: {
            unit: [
              {
                id: "client/src/terminal/x.test.ts::replays",
                layer: "unit",
                // Source tag said FR-01.44; the manifest filed it under the
                // surviving parent FR-01.28 and recorded where it came from.
                resolved_from: "FR-01.44",
              },
            ],
          },
        },
      }),
    );
    try {
      const idx = readTraceabilityIndex(root);
      expect(idx.status).toBe("ok");
      if (idx.status !== "ok") return;
      expect(idx.byFile.get("client/src/terminal/x.test.ts")?.frs).toEqual([
        { frId: "FR-01.28", mappedFrom: "FR-01.44" },
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("leaves `mappedFrom` null when no fold applied — no phantom badge", () => {
    const root = projectWithManifest(
      manifest({
        k: {
          id: "FR-01.28",
          tests: {
            unit: [
              { id: "a.test.ts::x", layer: "unit" },
              // A `resolved_from` equal to the id is not a fold; it must not
              // render "mapped from FR-01.28" on a row filed under FR-01.28.
              { id: "b.test.ts::x", layer: "unit", resolved_from: "FR-01.28" },
            ],
          },
        },
      }),
    );
    try {
      const idx = readTraceabilityIndex(root);
      if (idx.status !== "ok") throw new Error("expected ok");
      expect(idx.byFile.get("a.test.ts")?.frs[0].mappedFrom).toBeNull();
      expect(idx.byFile.get("b.test.ts")?.frs[0].mappedFrom).toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("keeps the fold provenance when only a LATER case on the same file carries it", () => {
    const root = projectWithManifest(
      manifest({
        k: {
          id: "FR-01.28",
          tests: {
            unit: [
              { id: "a.test.ts::first", layer: "unit" },
              { id: "a.test.ts::second", layer: "unit", resolved_from: "FR-01.44" },
            ],
          },
        },
      }),
    );
    try {
      const idx = readTraceabilityIndex(root);
      if (idx.status !== "ok") throw new Error("expected ok");
      const entry = idx.byFile.get("a.test.ts")!;
      expect(entry.frs).toEqual([{ frId: "FR-01.28", mappedFrom: "FR-01.44" }]);
      expect(entry.caseCount).toBe(2);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("merges layers and requirements across entries for one file", () => {
    const root = projectWithManifest(
      manifest({
        a: { id: "FR-01.01", tests: { unit: [{ id: "x.test.ts::a", layer: "unit" }] } },
        b: { id: "FR-01.02", tests: { e2e: [{ id: "x.test.ts::b", layer: "e2e" }] } },
      }),
    );
    try {
      const idx = readTraceabilityIndex(root);
      if (idx.status !== "ok") throw new Error("expected ok");
      const entry = idx.byFile.get("x.test.ts")!;
      expect(entry.layers.sort()).toEqual(["e2e", "unit"]);
      expect(entry.frs.map((f) => f.frId).sort()).toEqual(["FR-01.01", "FR-01.02"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("readTraceabilityIndex — bounded degradation", () => {
  it("reports `corrupt` for invalid JSON rather than throwing", () => {
    const root = projectWithManifest("{ this is not json");
    try {
      expect(readTraceabilityIndex(root)).toEqual({ status: "unavailable", reason: "corrupt" });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("reports `corrupt` for valid JSON of the WRONG SHAPE", () => {
    for (const body of ["[]", '"a string"', "{}", '{"requirements":[]}', "null"]) {
      const root = projectWithManifest(body);
      try {
        expect(readTraceabilityIndex(root), body).toEqual({
          status: "unavailable",
          reason: "corrupt",
        });
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }
  });

  it("reports `missing` when the manifest does not exist", () => {
    const root = mkdtempSync(join(tmpdir(), "mc-trace-none-"));
    try {
      expect(readTraceabilityIndex(root)).toEqual({ status: "unavailable", reason: "missing" });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("skips malformed entries without abandoning the good ones", () => {
    const root = projectWithManifest(
      manifest({
        a: { id: "FR-01.01", tests: { unit: [null, 42, {}, { id: "" }, { id: "ok.test.ts::x" }] } },
        b: "not an object",
        c: { id: "FR-01.02", tests: "not an object" },
      }),
    );
    try {
      const idx = readTraceabilityIndex(root);
      if (idx.status !== "ok") throw new Error("expected ok");
      expect([...idx.byFile.keys()]).toEqual(["ok.test.ts"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("readTraceabilityIndex — REAL repo manifest (calibration probe)", () => {
  it("inverts this repo's own generated manifest into a non-empty file index", () => {
    // Not a fixture: the actual producer output, git-tracked at a known path.
    const idx = readTraceabilityIndex(resolve(process.cwd(), ".."));
    expect(idx.status).toBe("ok");
    if (idx.status !== "ok") return;
    expect(idx.byFile.size).toBeGreaterThan(50);
    // Every key must look like a file path, never a `file::test name` id —
    // a wrong split here would make every git-diff join silently miss.
    for (const key of idx.byFile.keys()) expect(key).not.toContain("::");
    expect(idx.generatedAt).toBeTruthy();
  });
});
