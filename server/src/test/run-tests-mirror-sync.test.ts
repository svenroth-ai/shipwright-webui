/*
 * Drift-guard between the SERVER's A02 run-data-join wire types and the
 * CLIENT's verbatim mirror (iterate-2026-08-08-tests-total-skip-contract).
 *
 *   server  core/event-log-types.ts (RunTests) + core/run-data-types.ts (rest)  (SoT)
 *   client  lib/runDataApi.ts                                                  (mirror)
 *
 * This pair had NO drift guard before this run — `RunTests` gaining a required
 * `skipped` field (the epoch-gated tests-total-skip contract) is exactly the
 * kind of change that silently desyncs a hand-mirrored shape (ADR-080 forbids
 * a cross-package import, so nothing else catches it). Same parser, same
 * approach as `mission-context-types-sync.test.ts`: text, not types.
 *
 * Deliberately NOT a full-file completeness scan (unlike the Mission guard):
 * `event-log-types.ts` also exports server-internal shapes with no client
 * counterpart at all (`RunProjection`, `EventLogProjection`, …) that never
 * cross this wire boundary — an unregistered-export check there would just be
 * noise. This file checks exactly the shapes the three A02 endpoints send.
 *
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

// server/src/test/ → repo root
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

const SERVER_FILES = [
  "server/src/core/event-log-types.ts",
  "server/src/core/run-data-types.ts",
];
const CLIENT_FILES = ["client/src/lib/runDataApi.ts"];

function readAll(rel: string[]): string {
  return rel.map((r) => readFileSync(resolve(ROOT, r), "utf-8")).join("\n");
}

const SHARED_INTERFACES = [
  "RunTests",
  "RunGates",
  "PhaseDuration",
  "PhaseSplitDuration",
  "AggregatedPhase",
  "GradeSnapshot",
  "RunDataJoin",
];

const SHARED_UNIONS = ["GateState"];

describe("run-data-join wire types — server SoT vs client verbatim mirror", () => {
  const server = stripComments(readAll(SERVER_FILES));
  const client = stripComments(readAll(CLIENT_FILES));

  it.each(SHARED_INTERFACES)("interface %s has identical fields on both sides", (name) => {
    const s = interfaceBody(server, name);
    const c = interfaceBody(client, name);

    expect(s, `interface ${name} not found in the SERVER types`).not.toBeNull();
    expect(c, `interface ${name} not found in the CLIENT mirror`).not.toBeNull();

    const sm = memberMap(s!);
    const cm = memberMap(c!);
    const sf = [...sm.keys()].sort();
    const cf = [...cm.keys()].sort();

    const missingInClient = sf.filter((f) => !cm.has(f));
    const extraInClient = cf.filter((f) => !sm.has(f));

    expect(
      missingInClient,
      `${name}: the client mirror is STALE — it is missing ${missingInClient.join(", ")}, so the server sends data the UI drops`,
    ).toEqual([]);
    expect(
      extraInClient,
      `${name}: the client mirror is FABRICATED — it declares ${extraInClient.join(", ")}, which no server type populates`,
    ).toEqual([]);

    const shapeDrift = sf
      .filter((f) => cm.has(f))
      .map((f) => ({
        field: f,
        server: resolveType(sm.get(f)!, server),
        client: resolveType(cm.get(f)!, client),
      }))
      .filter((d) => d.server !== d.client)
      .map((d) => `${d.field}: server \`${d.server}\` vs client \`${d.client}\``);

    expect(
      shapeDrift,
      `${name}: field TYPES drifted — ${shapeDrift.join("; ")}. A client that drops \`| null\` (or widens a literal) misreads server data silently.`,
    ).toEqual([]);
  });

  it.each(SHARED_UNIONS)("union %s has identical members on both sides", (name) => {
    const s = unionMembers(server, name);
    const c = unionMembers(client, name);

    expect(s, `type ${name} not found in the SERVER types`).not.toBeNull();
    expect(c, `type ${name} not found in the CLIENT mirror`).not.toBeNull();

    expect(
      [...c!].sort(),
      `${name}: union members drifted — a state the server can emit but the client cannot name falls through every switch`,
    ).toEqual([...s!].sort());
  });
});
