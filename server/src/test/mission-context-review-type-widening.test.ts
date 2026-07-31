/*
 * The one thing the mirror drift-guard structurally CANNOT see.
 *
 * `mission-context-types-sync.test.ts` compares `ReviewType` on both sides via
 * `unionMembers`, which collects `/"([^"]+)"/g` — quoted literals and nothing
 * else. So `ReviewType` compares EQUAL whether or not either declaration still
 * carries the `(string & {})` arm: revert the client mirror to the closed union
 * and every existing test stays green, while the server happily sends a review
 * type the client's type system says cannot exist.
 *
 * That arm is the whole of `iterate-2026-07-31-review-record-tolerant-reader`
 * on the wire, so it gets a guard of its own. Its own FILE because the sync test
 * is already past the 300-line rule and may not grow (external code review,
 * MEDIUM 3).
 *
 * @covers FR-01.66
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// server/src/test/ → repo root
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

const DECLARATIONS: [side: string, file: string][] = [
  ["server (source of truth)", "server/src/core/mission-context/types-slice2.ts"],
  ["client (verbatim mirror)", "client/src/lib/missionContextApi.ts"],
];

function reviewTypeDeclaration(rel: string): string {
  const src = readFileSync(resolve(ROOT, rel), "utf-8");
  const m = /type\s+ReviewType\s*=([\s\S]*?);/.exec(src);
  expect(m, `no ReviewType declaration in ${rel}`).not.toBeNull();
  return m![1];
}

describe("ReviewType stays open on BOTH sides", () => {
  it.each(DECLARATIONS)(
    "%s admits a review type it has never heard of",
    (_side, file) => {
      expect(
        reviewTypeDeclaration(file).replace(/\s+/g, ""),
        `${file}: ReviewType lost its \`(string & {})\` arm. The server can send a review ` +
          `pass outside the pinned five — that is what the tolerant reader exists for — so ` +
          `closing this union again would make the type system deny data the wire really carries.`,
      ).toContain("(string&{})");
    },
  );

  it("still pins the five by name, so the contract order cannot quietly shrink", () => {
    for (const [, file] of DECLARATIONS) {
      const declaration = reviewTypeDeclaration(file);
      for (const pinned of ["self", "plan", "code", "doubt", "external_code"]) {
        expect(declaration, `${file}: ReviewType no longer names ${pinned}`).toContain(
          `"${pinned}"`,
        );
      }
    }
  });
});
