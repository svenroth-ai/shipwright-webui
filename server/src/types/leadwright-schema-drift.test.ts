/*
 * leadwright-schema-drift.test.ts — catches leadwright regenerating a
 * vendored schema (server/src/vendor/leadwright/*.json) out from under
 * webui without either repo going red (iterate-2026-09-09-leadwright-
 * schema-drift). Both repos stay green today because nothing ever compares
 * the vendored copies to their originals — this is that comparison.
 *
 * HOW TO RUN THE REAL CHECK: set SHIPWRIGHT_LEADWRIGHT_CHECKOUT to the
 * absolute path of a local `leadwright` clone before `npm run test` (or
 * `npx vitest run leadwright-schema-drift`) in `server/`, e.g. on this
 * machine:
 *   SHIPWRIGHT_LEADWRIGHT_CHECKOUT=C:\01_Development\leadwright npm run test
 * Unset (the CI default), the per-file checks below skip — visibly, by
 * name, in the reporter — rather than silently reporting nothing.
 *
 * This file also unit-tests the comparison/enumeration primitives against
 * disposable fixture directories, so the mismatch- and directory-driven-
 * enumeration guarantees are proven independent of any real checkout being
 * present on the machine running the suite.
 */
import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { compareVendoredFile, findFirstJsonDiff, listVendorFiles } from "./leadwright-schema-drift.js";

const VENDOR_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "vendor", "leadwright");
const checkoutRoot = process.env.SHIPWRIGHT_LEADWRIGHT_CHECKOUT;
const checkoutSchemasDir = checkoutRoot ? path.join(checkoutRoot, "schemas") : undefined;

function withTempDirs(run: (vendorDir: string, sourceDir: string, root: string) => void): void {
  const root = mkdtempSync(path.join(tmpdir(), "schema-drift-fixture-"));
  const vendorDir = path.join(root, "vendor");
  const sourceDir = path.join(root, "source");
  mkdirSync(vendorDir);
  mkdirSync(sourceDir);
  try {
    run(vendorDir, sourceDir, root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe("leadwright schema vendor directory — enumeration is directory-driven", () => {
  it("the vendor directory is non-empty (an empty glob must never read as 'all files match')", () => {
    const files = listVendorFiles(VENDOR_DIR).filter((f) => f.endsWith(".json"));
    expect(files.length).toBeGreaterThan(0);
  });

  it("listVendorFiles returns exactly what's on disk, including a file added after this test was written", () => {
    withTempDirs((vendorDir) => {
      writeFileSync(path.join(vendorDir, "a.schema.json"), "{}");
      writeFileSync(path.join(vendorDir, "b.schema.json"), "{}");
      // Simulates "someone vendors a sixth file" — no hardcoded filename list here.
      writeFileSync(path.join(vendorDir, "future-sixth-file.schema.json"), "{}");
      expect(listVendorFiles(vendorDir)).toEqual(["a.schema.json", "b.schema.json", "future-sixth-file.schema.json"]);
    });
  });
});

describe("compareVendoredFile — mismatch detection (fixture-based, always runs)", () => {
  it("reports matches=false, naming the file and the first differing JSON path, when the source differs", () => {
    withTempDirs((vendorDir, sourceDir) => {
      writeFileSync(path.join(vendorDir, "example.schema.json"), JSON.stringify({ a: 1, b: { c: 2 } }));
      writeFileSync(path.join(sourceDir, "example.schema.json"), JSON.stringify({ a: 1, b: { c: 3 } }));

      const result = compareVendoredFile({ vendorDir, sourceDir, file: "example.schema.json" });

      expect(result.file).toBe("example.schema.json");
      expect(result.matches).toBe(false);
      expect(result.diffPath).toBe("/b/c");
    });
  });

  it("reports matches=true when both sides parse to the same JSON", () => {
    withTempDirs((vendorDir, sourceDir) => {
      writeFileSync(path.join(vendorDir, "example.schema.json"), JSON.stringify({ a: 1, b: [1, 2, 3] }));
      writeFileSync(path.join(sourceDir, "example.schema.json"), JSON.stringify({ b: [1, 2, 3], a: 1 }));

      const result = compareVendoredFile({ vendorDir, sourceDir, file: "example.schema.json" });

      expect(result.matches).toBe(true);
      expect(result.diffPath).toBeUndefined();
    });
  });

  it("a CRLF-only difference in the source file is NOT drift (parsed JSON, never bytes)", () => {
    withTempDirs((vendorDir, sourceDir) => {
      const json = JSON.stringify({ a: 1, b: { c: 2 } }, null, 2);
      writeFileSync(path.join(vendorDir, "example.schema.json"), json); // LF
      writeFileSync(path.join(sourceDir, "example.schema.json"), json.replace(/\n/g, "\r\n")); // CRLF-dirty

      const result = compareVendoredFile({ vendorDir, sourceDir, file: "example.schema.json" });

      expect(result.matches).toBe(true);
    });
  });

  it("throws naming which side (checkout) is missing the file, not a bare ENOENT", () => {
    withTempDirs((vendorDir, sourceDir) => {
      writeFileSync(path.join(vendorDir, "example.schema.json"), "{}");
      // sourceDir has no counterpart — simulates a newly-vendored file the
      // checkout doesn't have yet.
      expect(() => compareVendoredFile({ vendorDir, sourceDir, file: "example.schema.json" })).toThrow(
        /checkout file not found/,
      );
    });
  });
});

describe("findFirstJsonDiff — pointer to the first divergence", () => {
  it("returns undefined for deeply equal values regardless of key order", () => {
    expect(findFirstJsonDiff({ a: 1, b: 2 }, { b: 2, a: 1 })).toBeUndefined();
  });

  it("finds an array-index divergence", () => {
    expect(findFirstJsonDiff({ list: [1, 2, 3] }, { list: [1, 9, 3] })).toBe("/list/1");
  });

  it("finds a missing key on either side", () => {
    expect(findFirstJsonDiff({ a: 1 }, { a: 1, b: 2 })).toBe("/b");
  });

  it("finds a length divergence when one array has extra trailing elements", () => {
    expect(findFirstJsonDiff({ a: [1, 2] }, { a: [1, 2, 3] })).toBe("/a/2");
  });

  it("treats null and a missing key as different (undefined !== null)", () => {
    expect(findFirstJsonDiff({ a: null }, {})).toBe("/a");
  });

  it("finds a nested type mismatch (object vs. array at a non-root path)", () => {
    expect(findFirstJsonDiff({ a: { b: { c: 1 } } }, { a: { b: [1] } })).toBe("/a/b");
  });
});

describe("leadwright schema vendor drift — against a real checkout", () => {
  const vendorFiles = listVendorFiles(VENDOR_DIR).filter((f) => f.endsWith(".json"));

  for (const file of vendorFiles) {
    it.skipIf(!checkoutSchemasDir)(
      `${file} matches <SHIPWRIGHT_LEADWRIGHT_CHECKOUT>/schemas/${file} (parsed JSON, not bytes)`,
      () => {
        const result = compareVendoredFile({ vendorDir: VENDOR_DIR, sourceDir: checkoutSchemasDir!, file });
        expect(result.matches, `${result.file} differs from the checkout at JSON path ${result.diffPath}`).toBe(true);
      },
    );
  }
});
