/*
 * terminal-ws-contract-sync.test.ts — drift guard for the terminal WS envelope
 * contract mirrored across the two workspaces (iterate-2026-07-30, DO-NOT #7).
 *
 * `client/src/hooks/terminalWsContract.ts` is a verbatim mirror of two server shapes:
 * `BackpressureNotice` (backpressure-telemetry.ts) and the inbound `WSInbound` union
 * (ws-upgrade-handler.ts). DO-NOT #7 forbids a cross-package import, so the mirror is
 * the sanctioned pattern — and the precedent it sets (`action-schema-sync.test.ts`)
 * is that a mirror without a drift guard is only a mirror until someone edits one
 * side. This iterate already paid for that: the server stripped every cumulative
 * field on the way out and nothing failed, because the two sides were never compared.
 *
 * Deliberately a SOURCE scan, not a type import: importing client code here is the
 * very thing DO-NOT #7 prohibits, and the drift being guarded is textual.
 */

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const SERVER_SRC = path.resolve(import.meta.dirname, "..");
const CLIENT_CONTRACT = path.resolve(
  SERVER_SRC,
  "../../client/src/hooks/terminalWsContract.ts",
);

const read = (p: string): string => fs.readFileSync(p, "utf8");

/** Field names of the first `interface <name> { … }` block in `src`. */
function interfaceFields(src: string, name: string): string[] {
  const m = new RegExp(`interface\\s+${name}\\s*\\{([\\s\\S]*?)\\n\\}`).exec(src);
  if (!m) throw new Error(`interface ${name} not found`);
  return [...m[1].matchAll(/^\s*(\w+)\s*[?:]/gm)].map((x) => x[1]).sort();
}

/** `type: "…"` discriminators present in `src`. */
function discriminators(src: string): string[] {
  return [...new Set([...src.matchAll(/type:\s*"([a-z_]+)"/g)].map((m) => m[1]))].sort();
}

describe("terminal WS contract — client mirror matches the server", () => {
  it("client contract file exists where the mirror is documented to live", () => {
    expect(fs.existsSync(CLIENT_CONTRACT), CLIENT_CONTRACT).toBe(true);
  });

  it("BackpressureInfo mirrors BackpressureNotice field-for-field", () => {
    const serverFields = interfaceFields(
      read(path.join(SERVER_SRC, "terminal/backpressure-telemetry.ts")),
      "BackpressureNotice",
    );
    const clientFields = interfaceFields(read(CLIENT_CONTRACT), "BackpressureInfo");
    // Both directions: a field added server-side that the client never reads is just
    // as much drift as a client field the server never sends.
    expect(clientFields).toEqual(serverFields);
    // Guard the fields the countability fix depends on by name, so a rename that
    // happens to keep the arity equal still fails.
    expect(serverFields).toContain("droppedBytes");
    expect(serverFields).toContain("episodeEnded");
    expect(serverFields).toContain("totalDroppedBytes");
  });

  it("TerminalOutbound covers every inbound type the server accepts", () => {
    const serverSrc = read(path.join(SERVER_SRC, "terminal/ws-upgrade-handler.ts"));
    // The server's accepted set = the isWSInbound branches plus the pre-gate frames
    // (`ping`, `resync`) that are answered before the writer check.
    const guard = /export function isWSInbound[\s\S]*?\n\}/.exec(serverSrc)?.[0] ?? "";
    const accepted = [...new Set([...guard.matchAll(/o\.type === "(\w+)"/g)].map((m) => m[1]))];
    expect(accepted.length, "isWSInbound branches not found").toBeGreaterThan(0);

    const clientOutbound = discriminators(read(CLIENT_CONTRACT));
    for (const t of accepted) {
      expect(clientOutbound, `server accepts "${t}" but the client contract omits it`).toContain(t);
    }
  });
});
