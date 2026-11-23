import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

import { sha256Hex, blockDigest } from "./orgBlockDigest";
import { parseProposedDecisions } from "./orgDecisionsApi";

const SAMPLE = readFileSync(
  path.resolve(__dirname, "../../../server/src/external/org/__tests__/fixtures/decisions-proposed-daemon-sample.md"),
  "utf8",
).replace(/\r\n/g, "\n");

describe("orgBlockDigest", () => {
  // @covers FR-01.71
  it("sha256Hex equals node's SHA-256 across padding boundaries and multi-byte text", () => {
    const enc = new TextEncoder();
    for (const text of ["", "abc", "a".repeat(55), "a".repeat(56), "a".repeat(63), "a".repeat(64), "a".repeat(65), "a".repeat(1000), "Prüfung 日本 🚀\nzeile"]) {
      expect(sha256Hex(enc.encode(text)), text.slice(0, 10)).toBe(createHash("sha256").update(text, "utf8").digest("hex"));
    }
  });

  // @covers FR-01.71
  it("the digest of the shared sample entries matches the server's pinned values", () => {
    expect(parseProposedDecisions(SAMPLE).map((e) => blockDigest(e.block))).toEqual(["0ed68ceb67d8b4c0c7f34a1ba18b9928", "d2c3b4dbd2b5e6ec1d68ca497e8fa34f"]);
  });

  // @covers FR-01.71
  it("ignores CR, a BOM and trailing blank lines", () => {
    const block = parseProposedDecisions(SAMPLE)[0].block;
    expect(blockDigest("\uFEFF" + block.replace(/\n/g, "\r\n") + "\r\n\r\n")).toBe(blockDigest(block));
  });
});
