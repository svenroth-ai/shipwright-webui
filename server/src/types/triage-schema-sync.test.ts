/*
 * triage-schema-sync.test.ts — drift-guard for the TriageItem TS type
 * between `server/src/types/triage.ts` (canonical) and
 * `client/src/lib/triageApi.ts` (mirror).
 *
 * Two workspaces share the wire shape because the WebUI's TS-side
 * resolver (`triage-store.ts`) copies every field on the JSONL `append`
 * event verbatim into the resolved item, then the API surfaces the
 * resolved item to the client. If one side adds a field and the other
 * doesn't, the rendered UI silently loses access to it.
 *
 * Triggered by iterate-2026-05-20-triage-launch-surface-webui external
 * review MED #2 — `launchPayload` is the second wire field after
 * `action-schema.ts` to need this cross-workspace guard; doing the
 * generic content-parity check now means future drift (e.g. when
 * shipwright adds yet another wire field) fails loud, not silent.
 *
 * Pattern mirrors action-schema-sync.test.ts (same fileNames() helper).
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

function fileNames(filePath: string, interfaceName: string): Set<string> {
  const raw = readFileSync(filePath, "utf-8");
  const idx = raw.indexOf(`interface ${interfaceName}`);
  if (idx === -1) {
    throw new Error(`interface ${interfaceName} not found in ${filePath}`);
  }
  const open = raw.indexOf("{", idx);
  let depth = 0;
  let end = open;
  for (let i = open; i < raw.length; i++) {
    if (raw[i] === "{") depth++;
    else if (raw[i] === "}") {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  const body = raw.slice(open + 1, end);

  const names = new Set<string>();
  for (const line of body.split(/\n/)) {
    const stripped = line.trim();
    if (
      !stripped ||
      stripped.startsWith("//") ||
      stripped.startsWith("/*") ||
      stripped.startsWith("*")
    ) {
      continue;
    }
    const m = /^([A-Za-z_][A-Za-z0-9_]*)\??\s*:/.exec(stripped);
    if (m) names.add(m[1]);
  }
  return names;
}

describe("triage-schema sync — server canonical vs client mirror", () => {
  // @covers FR-01.30
  it("server TriageItem and client TriageItem declare the same field set", () => {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    const serverPath = resolve(__dirname, "triage.ts");
    const clientPath = resolve(
      __dirname,
      "..",
      "..",
      "..",
      "client",
      "src",
      "lib",
      "triageApi.ts",
    );
    const serverFields = fileNames(serverPath, "TriageItem");
    const clientFields = fileNames(clientPath, "TriageItem");

    const missingOnClient: string[] = [];
    for (const f of serverFields) {
      if (!clientFields.has(f)) missingOnClient.push(f);
    }
    const missingOnServer: string[] = [];
    for (const f of clientFields) {
      if (!serverFields.has(f)) missingOnServer.push(f);
    }
    expect(
      missingOnClient,
      `client mirror missing server fields: ${missingOnClient.join(", ")}`,
    ).toEqual([]);
    expect(
      missingOnServer,
      `server canonical missing client fields: ${missingOnServer.join(", ")}`,
    ).toEqual([]);
  });

  // @covers FR-01.30
  it("launchPayload is declared on both halves (regression fence for iterate-2026-05-20)", () => {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    const serverPath = resolve(__dirname, "triage.ts");
    const clientPath = resolve(
      __dirname,
      "..",
      "..",
      "..",
      "client",
      "src",
      "lib",
      "triageApi.ts",
    );
    expect(fileNames(serverPath, "TriageItem").has("launchPayload")).toBe(true);
    expect(fileNames(clientPath, "TriageItem").has("launchPayload")).toBe(true);
  });
});
