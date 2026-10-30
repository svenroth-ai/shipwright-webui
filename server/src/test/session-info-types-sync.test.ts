/*
 * Drift-guard: session-info wire types — server SoT vs client verbatim mirror
 * (DO-NOT #7 / ADR-080). Same text-parsing approach as
 * `mission-context-types-sync.test.ts`; field NAMES and TYPES, both directions.
 *
 *   server  core/session-info/types.ts
 *   client  lib/sessionInfoApi.ts
 * @covers FR-01.66
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  interfaceBody,
  memberMap,
  resolveType,
  stripComments,
  unionMembers,
} from "./mission-context-types-parser.test.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const server = stripComments(readFileSync(resolve(ROOT, "server/src/core/session-info/types.ts"), "utf-8"));
const client = stripComments(readFileSync(resolve(ROOT, "client/src/lib/sessionInfoApi.ts"), "utf-8"));

const INTERFACES = [
  "SessionContextInfo",
  "SessionCompactionInfo",
  "SessionOutputFile",
  "SessionRemoteControl",
  "SessionSubagent",
  "SessionInfoScan",
  "SessionInfo",
];

// @covers FR-01.66
describe("session-info types — server SoT vs client mirror", () => {
  it.each(INTERFACES)("interface %s has identical fields and types", (name) => {
    const s = interfaceBody(server, name);
    const c = interfaceBody(client, name);
    expect(s, `${name} missing on the server`).not.toBeNull();
    expect(c, `${name} missing in the client mirror`).not.toBeNull();
    const sm = memberMap(s!);
    const cm = memberMap(c!);
    expect([...sm.keys()].sort(), `${name}: field names drifted`).toEqual([...cm.keys()].sort());
    for (const f of sm.keys()) {
      expect(resolveType(cm.get(f)!, client), `${name}.${f} type drifted`).toBe(resolveType(sm.get(f)!, server));
    }
  });

  it("SubagentState union has identical members", () => {
    const s = unionMembers(server, "SubagentState");
    const c = unionMembers(client, "SubagentState");
    expect(s).not.toBeNull();
    expect([...(c ?? [])].sort()).toEqual([...(s ?? [])].sort());
  });

  it("neither side declares a context percentage or window size", () => {
    for (const text of [server, client]) {
      expect(text).not.toMatch(/percent|windowSize|contextWindow/i);
    }
  });
});
