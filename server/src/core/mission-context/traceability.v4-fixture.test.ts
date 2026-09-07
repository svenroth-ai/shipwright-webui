/*
 * traceability.v4-fixture.test.ts — FROZEN FIXTURE pinning the manifest v4
 * shape (campaign req3-06-mechanics-webui, sub-iterate w3; upstream:
 * shipwright monorepo req3-04c-ac-identity-wave2 P3.2, "AC-scoped `@covers`
 * tag grammar + test-traceability manifest v4").
 *
 * Two fixtures, both declaring `schema_version: 4`, copied field-for-field
 * from the shipped `traceability_schema.json` `$defs.testLink` /
 * `$defs.requirement` / `$defs.acNode` shapes (not reduced to "what the
 * reader happens to read" — the whole point of a frozen fixture is that it
 * still looks like the real producer's output, so a future reader change
 * that starts depending on a field this suite never sets would show up as a
 * new failure here, not as silent behaviour drift):
 *
 *   - WITH_AC_TAG   — a requirement carrying the v4-only `acs` breakdown and
 *     a test link carrying `ac_id` (AC-scoped @covers).
 *   - BARE_FR_TAG   — a requirement with NO `acs` and a test link with NO
 *     `ac_id` — the "v3-shaped bare FR tag" case AC2 of this unit requires:
 *     a v4 manifest need not use any AC tag at all.
 *
 * This reader never validates `additionalProperties` or requires `acs`/
 * `ac_id` — it only reads `.id`/`.tests[<layer>][*].id/.layer/.resolved_from`,
 * unchanged across v3 → v4 (contract-version.ts). So both fixtures must
 * invert identically on the fields this reader actually consumes, and the
 * v4-only fields must be tolerated (present but unread) rather than
 * mistaken for corruption. Bumping `TRACEABILITY_SCHEMA_VERSION` is a
 * COMPATIBILITY check (does the reader still invert this shape), never a
 * schema-validation upgrade — this reader has never enforced the full v3/v4
 * JSON Schema and still doesn't; `readTraceabilityIndex`'s single caller
 * (`slice2-sources.ts`) takes its `TraceabilityIndex` return value directly,
 * with no intervening typed/zod validator that could reject an unknown v4
 * field either (verified: `grep -rn readTraceabilityIndex server/src`
 * finds exactly one call site).
 *
 * The v3 → v4 delta was verified MECHANICALLY, not by trusting the schema's
 * own doc comment (external plan review, medium finding): `git diff
 * 227a525e4..c0d1b38be2 -- plugins/shipwright-compliance/scripts/lib/traceability_schema.json`
 * in the shipwright monorepo shows the only changes are the `$id`/title/
 * description strings, `schema_version.const` 3→4, and the two additive
 * blocks these fixtures exercise (`requirement.acs` + the new `acNode` def,
 * `testLink.ac_id`) — no required field, enum, or pattern changed.
 * `source_commit` below is pinned to that verified monorepo tip
 * (`c0d1b38be27730dca4c9f00afc4538dd10f76e56`, PR #686) for exactly this
 * auditability reason (external plan review, low finding).
 *
 * @covers FR-01.66
 */

import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { readTraceabilityIndex, TRACEABILITY_REL } from "./traceability.js";
import { TRACEABILITY_SCHEMA_VERSION, _resetWarnMemo } from "../contract-version.js";

function projectWithManifest(body: unknown): string {
  const root = mkdtempSync(join(tmpdir(), "mc-trace-v4-"));
  mkdirSync(join(root, ".shipwright", "compliance"), { recursive: true });
  writeFileSync(join(root, ...TRACEABILITY_REL.split("/")), JSON.stringify(body), "utf-8");
  return root;
}

/**
 * Full v4 manifest envelope (every field the shipped schema REQUIRES at the
 * root), holding exactly one requirement — supplied by each fixture below.
 */
function v4Envelope(requirement: unknown) {
  return {
    schema_version: 4,
    collector_version: "test_links/1.1.0",
    generated_at: "2026-09-07T00:00:00Z",
    source_commit: "c0d1b38be27730dca4c9f00afc4538dd10f76e56",
    spec_hash: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
    requirements: { "01::FR-01.11": requirement },
    orphans: [],
    invalid_tags: [],
    untagged_tests: [],
  };
}

/**
 * A requirement with an AC-scoped test link + the v4-only `acs` breakdown.
 * The link ALSO carries `resolved_from` (fold provenance, present since v2/v3
 * — external code review, medium finding): the schema's own `testLink.ac_id`
 * description says `ac_id` is "present on this link REGARDLESS of whether it
 * is filed under the requirement's top-level `tests` or under one of its
 * `acs[ac_id].tests`" — i.e. `ac_id` and `resolved_from` are independent,
 * both-optional fields that can co-occur on the SAME link. Omitting
 * `resolved_from` from every v4 fixture would leave the fold-provenance path
 * (`mappedFrom`) unexercised against the new v4 shape, silently narrowing
 * what "frozen fixture pins the shape" (AC3) actually pins.
 */
const WITH_AC_TAG = v4Envelope({
  id: "FR-01.11",
  spec_path: "docs/spec.md",
  title: "Example AC-scoped requirement",
  priority: "Must",
  status: "active",
  required_layers: ["unit"],
  required_layers_source: "explicit",
  tests: {
    unit: [
      {
        id: "server/src/example.test.ts::covers AC07",
        path: "server/src/example.test.ts::covers AC07",
        layer: "unit",
        status: "enabled",
        executed: "pass",
        tag_source: "covers_comment",
        ac_id: "AC07",
        resolved_from: "FR-01.99",
      },
    ],
  },
  coverage: { unit: "ok" },
  acs: {
    AC07: {
      tests: {
        unit: [
          {
            id: "server/src/example.test.ts::covers AC07",
            path: "server/src/example.test.ts::covers AC07",
            layer: "unit",
            status: "enabled",
            executed: "pass",
            tag_source: "covers_comment",
            ac_id: "AC07",
            resolved_from: "FR-01.99",
          },
        ],
      },
      coverage: { unit: "ok" },
    },
  },
});

/**
 * A requirement carrying NO AC tag anywhere (no `acs`, no `ac_id` on its test
 * link) — a v4 manifest that is, by the schema's own description, "byte-
 * identical to a v3-shaped body" apart from the `schema_version` const.
 */
const BARE_FR_TAG = v4Envelope({
  id: "FR-01.11",
  spec_path: "docs/spec.md",
  title: "Example bare-tag requirement",
  priority: "Should",
  status: "active",
  required_layers: ["unit"],
  required_layers_source: "inferred_legacy",
  tests: {
    unit: [
      {
        id: "server/src/other.test.ts::plain",
        path: "server/src/other.test.ts::plain",
        layer: "unit",
        status: "enabled",
        executed: "pass",
        tag_source: "native_tag",
      },
    ],
  },
  coverage: { unit: "ok" },
});

/**
 * ONE manifest holding BOTH an AC-scoped requirement and a bare-tag
 * requirement side by side (external plan review, edge-case finding) — a
 * real collector can emit exactly this: one FR's tests all name an AC,
 * another FR's tests name none. Confirms the reader's per-requirement
 * handling doesn't leak state across requirements (e.g. a "some case saw
 * `ac_id`" flag wrongly applied file-wide).
 */
const MIXED_MANIFEST = {
  schema_version: 4,
  collector_version: "test_links/1.1.0",
  generated_at: "2026-09-07T00:00:00Z",
  source_commit: "c0d1b38be27730dca4c9f00afc4538dd10f76e56",
  spec_hash: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
  requirements: {
    "01::FR-01.11": WITH_AC_TAG.requirements["01::FR-01.11"],
    "01::FR-01.12": {
      ...(BARE_FR_TAG.requirements["01::FR-01.11"] as Record<string, unknown>),
      id: "FR-01.12",
    },
  },
  orphans: [],
  invalid_tags: [],
  untagged_tests: [],
};

describe("readTraceabilityIndex — manifest v4 frozen fixture (w3, AC1/AC2)", () => {
  beforeEach(() => {
    _resetWarnMemo();
  });

  it("accepts a v4 manifest carrying an AC-scoped tag (`ac_id` + `acs`) without warning or corruption", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const root = projectWithManifest(WITH_AC_TAG);
    try {
      // schema_version 4 is now the known max — no "ahead" warning.
      expect(TRACEABILITY_SCHEMA_VERSION).toBe(4);
      const idx = readTraceabilityIndex(root);
      expect(idx.status).toBe("ok");
      if (idx.status !== "ok") return;
      expect(warnSpy).not.toHaveBeenCalled();

      // The v4-only fields (`ac_id`, `acs`) are present but unread — the
      // index still inverts on the fields this reader has always consumed,
      // INCLUDING fold provenance (`resolved_from` → `mappedFrom`) on the
      // very same AC-scoped link (external code review, medium finding).
      const entry = idx.byFile.get("server/src/example.test.ts");
      expect(entry).toBeDefined();
      expect(entry?.frs).toEqual([{ frId: "FR-01.11", mappedFrom: "FR-01.99" }]);
      expect(entry?.layers).toEqual(["unit"]);
      expect(entry?.caseCount).toBe(1);
    } finally {
      warnSpy.mockRestore();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("accepts a v4 manifest with NO AC tag anywhere — the v3-shaped bare FR tag case (AC2)", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const root = projectWithManifest(BARE_FR_TAG);
    try {
      const idx = readTraceabilityIndex(root);
      expect(idx.status).toBe("ok");
      if (idx.status !== "ok") return;
      expect(warnSpy).not.toHaveBeenCalled();

      const entry = idx.byFile.get("server/src/other.test.ts");
      expect(entry).toBeDefined();
      expect(entry?.frs).toEqual([{ frId: "FR-01.11", mappedFrom: null }]);
      expect(entry?.layers).toEqual(["unit"]);
    } finally {
      warnSpy.mockRestore();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("handles an AC-scoped requirement and a bare-tag requirement in the SAME manifest without cross-contamination", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const root = projectWithManifest(MIXED_MANIFEST);
    try {
      const idx = readTraceabilityIndex(root);
      expect(idx.status).toBe("ok");
      if (idx.status !== "ok") return;
      expect(warnSpy).not.toHaveBeenCalled();

      const acScoped = idx.byFile.get("server/src/example.test.ts");
      expect(acScoped?.frs).toEqual([{ frId: "FR-01.11", mappedFrom: "FR-01.99" }]);

      const bare = idx.byFile.get("server/src/other.test.ts");
      expect(bare?.frs).toEqual([{ frId: "FR-01.12", mappedFrom: null }]);
    } finally {
      warnSpy.mockRestore();
      rmSync(root, { recursive: true, force: true });
    }
  });

  afterEach(() => {
    _resetWarnMemo();
  });
});
