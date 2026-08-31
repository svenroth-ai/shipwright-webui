/*
 * Drift-guard between the SERVER's shipslog-docs wire types and the
 * CLIENT's verbatim mirror (iterate-2026-08-31-shipslog-documents-panel).
 *
 *   server  core/shipslog-docs-types.ts       (SoT)
 *   client  lib/shipsLogDocsApi.ts            (mirror)
 *
 * Same approach as run-tests-mirror-sync.test.ts / mission-context-types-sync
 * — text, not types (ADR-080 forbids a cross-package import, so nothing
 * else catches a hand-mirrored shape drifting).
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { interfaceBody, memberMap, resolveType, stripComments } from "./mission-context-types-parser.test.js";

// server/src/test/ → repo root
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

const SERVER_FILES = ["server/src/core/shipslog-docs-types.ts"];
const CLIENT_FILES = ["client/src/lib/shipsLogDocsApi.ts"];

function readAll(rel: string[]): string {
  return rel.map((r) => readFileSync(resolve(ROOT, r), "utf-8")).join("\n");
}

const SHARED_INTERFACES = ["ShipsLogDocRow", "ShipsLogDocsBundle"];

describe("shipslog-docs wire types — server SoT vs client verbatim mirror", () => {
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
});
