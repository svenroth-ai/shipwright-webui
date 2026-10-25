/**
 * @covers FR-01.75
 * Drift guard (DO-NOT #7): the client's `AdoptScanFindings` is a verbatim mirror of
 * the server's; both interface bodies are read from source and must be identical.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url)); // client/src/test
const read = (...parts: string[]) => readFileSync(path.join(here, ...parts), "utf-8");

function body(source: string): string {
  const start = source.indexOf("export interface AdoptScanFindings {");
  expect(start).toBeGreaterThanOrEqual(0);
  const text = source.slice(start, source.indexOf("}", start)).replace(/\s+/g, " ").trim();
  expect(text).toContain("commands"); // a truncated read must fail loudly
  return text;
}

describe("AdoptScanFindings: client mirror equals the server", () => {
  it("// @covers FR-01.75 the interface bodies are identical", () => {
    const client = body(read("..", "lib", "adoptScanApi.ts"));
    const server = body(read("..", "..", "..", "server", "src", "core", "adopt-scan-findings.ts"));
    expect(client).toBe(server);
  });
});
