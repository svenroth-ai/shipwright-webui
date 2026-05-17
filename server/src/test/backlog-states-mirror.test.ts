/*
 * Drift-guard: the In-Progress state tuple is mirrored across the two
 * independent npm workspaces (CLAUDE.md DO-NOT guard #7 — server and
 * client never import each other). `BACKLOG_SOURCE_STATES` (server,
 * `core/sdk-sessions-store.ts`) and `IN_PROGRESS_STATES` (client,
 * `lib/taskLifecycle.ts`) MUST stay identical — the server `/backlog`
 * route's allowlist and the client menu's visibility gate disagree
 * silently if they drift. iterate-2026-05-17-move-to-backlog (FR-01.32).
 *
 * Companion to action-schema-sync.test.ts (type-content parity) and
 * no-cross-package-imports.test.ts (import-direction guard). Reads the
 * client file as TEXT — not an import — so it does not itself violate
 * the cross-package rule.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
// server/src/test/ → server/src → repo root
const SERVER_SRC = resolve(__dirname, "..");
const REPO_ROOT = resolve(SERVER_SRC, "../..");

/** Extract the quoted string members of a `const NAME = [ ... ]` literal. */
function extractTuple(source: string, constName: string): string[] {
  const m = new RegExp(`${constName}\\s*=\\s*\\[([\\s\\S]*?)\\]`).exec(source);
  if (!m) throw new Error(`could not find ${constName} array literal`);
  return [...m[1].matchAll(/["']([^"']+)["']/g)].map((x) => x[1]);
}

describe("In-Progress state tuple — server/client mirror parity", () => {
  it("BACKLOG_SOURCE_STATES (server) equals IN_PROGRESS_STATES (client)", () => {
    const serverSrc = readFileSync(
      resolve(SERVER_SRC, "core/sdk-sessions-store.ts"),
      "utf8",
    );
    const clientSrc = readFileSync(
      resolve(REPO_ROOT, "client/src/lib/taskLifecycle.ts"),
      "utf8",
    );
    const server = extractTuple(serverSrc, "BACKLOG_SOURCE_STATES");
    const client = extractTuple(clientSrc, "IN_PROGRESS_STATES");

    expect(server.length).toBe(5);
    expect([...client].sort()).toEqual([...server].sort());
  });
});
