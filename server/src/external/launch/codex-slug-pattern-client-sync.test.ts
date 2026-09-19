/*
 * Drift-guard between the server's canonical `CODEX_MODEL_SLUG_PATTERN`
 * (parse-body.ts) and its manual mirror in
 * client/src/components/external/NewIssueModal/ModelTierOverrideFields.tsx
 * (DO-NOT #7 forbids importing the server constant directly, so the client
 * keeps its own copy for its inline "best-effort hint" only — the server
 * remains the real gate either way). Lives in `server/` for the same reason
 * `action-schema-sync.test.ts` does: node:fs / node:path / node:url read the
 * client file's *content* across the workspace boundary, not its types.
 *
 * (doubt-review fix, 2026-09-19: a future change to either pattern without
 * updating its mirror would let the shared catalog `<datalist>` suggest a
 * slug the client's own inline hint then paints as invalid.)
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { CODEX_MODEL_SLUG_PATTERN } from "./parse-body.js";

const here = dirname(fileURLToPath(import.meta.url));
const clientFile = resolve(
  here,
  "../../../../client/src/components/external/NewIssueModal/ModelTierOverrideFields.tsx",
);

describe("CODEX_MODEL_SLUG_PATTERN sync — server canonical vs client mirror", () => {
  it("client's mirrored regex literal matches the server's byte-for-byte", () => {
    const raw = readFileSync(clientFile, "utf-8");
    // Captures the literal's body and its trailing flags separately — parsed
    // as text, never evaluated, so an untrusted/malformed literal can only
    // fail this assertion, not execute.
    const m = /const CODEX_MODEL_SLUG_PATTERN = \/(.*)\/([a-z]*);/.exec(raw);
    if (!m) {
      throw new Error(`CODEX_MODEL_SLUG_PATTERN literal not found in ${clientFile}`);
    }
    const [, clientSource, clientFlags] = m;
    expect(clientSource).toBe(CODEX_MODEL_SLUG_PATTERN.source);
    expect(clientFlags).toBe(CODEX_MODEL_SLUG_PATTERN.flags);
  });
});
