/*
 * org-schema-sync.test.ts — drift guard between `server/src/types/org.ts`
 * (canonical) and `client/src/lib/orgApi.ts` (mirror).
 *
 * Purpose-built, NOT a copy of `triage-schema-sync.test.ts` (iterate spec
 * Design Notes, "Type mirror"): `UsageResponse` / `LeadNowState` /
 * `LeadRoleView` / `LeadCadenceView` are `type X = A | B` discriminated
 * unions, and `triage-schema-sync.test.ts`'s textual `interface` body
 * scanner has no `interface` body to find for those — even adapted, a flat
 * field-name set can't tell which union ARM a field belongs to (a field
 * present only on one arm could silently vanish from the client's OTHER
 * arm and still "pass" a flat-set comparison).
 *
 * For plain interfaces (`OrgChartLeadView`, `OrgChartView`,
 * `LeadRosterEntry`, `LeadsRosterResponse`) this reuses the existing
 * textual-brace-body approach. For each union type it splits the type body
 * on TOP-LEVEL `|` arm boundaries (depth-aware — a nested object type
 * inside one arm, e.g. `LeadNowState`'s `resting` arm's `lastRun` field,
 * must not be mistaken for a sibling arm), keys each arm by its literal
 * discriminant (`measured: false` / `measured: true` / `status: "clear"`),
 * and compares per-arm field sets against the client mirror.
 *
 * Falsified locally before being declared done (iterate spec Design Notes):
 * drop a field from the client mirror, confirm this test goes red, then
 * restore — not committed as a scratch state, just verified.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SERVER_PATH = resolve(__dirname, "org.ts");
const CLIENT_PATH = resolve(__dirname, "..", "..", "..", "client", "src", "lib", "orgApi.ts");

// ---------------------------------------------------------------------------
// Shared depth-aware helpers.
// ---------------------------------------------------------------------------

/** Splits `text` on top-level occurrences of `sep` — never inside {}, (), []. */
function splitTopLevel(text: string, sep: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "{" || ch === "(" || ch === "[") depth++;
    else if (ch === "}" || ch === ")" || ch === "]") depth--;
    else if (depth === 0 && text.startsWith(sep, i)) {
      parts.push(text.slice(start, i));
      start = i + sep.length;
    }
  }
  parts.push(text.slice(start));
  return parts.map((p) => p.trim()).filter((p) => p.length > 0);
}

/** Extracts the `{ ... }` body of `interface Name { ... }`. */
function interfaceFields(filePath: string, interfaceName: string): Set<string> {
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
  for (const def of splitTopLevel(body, ";")) {
    const m = /^([A-Za-z_][A-Za-z0-9_]*)\??\s*:/.exec(def.trim());
    if (m) names.add(m[1]);
  }
  return names;
}

/** Extracts the RHS body of `type Name = <body>;` (up to the top-level `;`). */
function unionTypeBody(filePath: string, typeName: string): string {
  const raw = readFileSync(filePath, "utf-8");
  const marker = `type ${typeName} =`;
  const idx = raw.indexOf(marker);
  if (idx === -1) {
    throw new Error(`type ${typeName} not found in ${filePath}`);
  }
  let i = idx + marker.length;
  let depth = 0;
  const start = i;
  for (; i < raw.length; i++) {
    const ch = raw[i];
    if (ch === "{" || ch === "(" || ch === "[") depth++;
    else if (ch === "}" || ch === ")" || ch === "]") depth--;
    else if (ch === ";" && depth === 0) break;
  }
  return raw.slice(start, i).trim();
}

interface Arm {
  discriminant: string;
  fields: Set<string>;
}

/** Field names + discriminant tag for ONE arm's top-level `{ ... }` body. */
function armInfo(armText: string): Arm {
  const open = armText.indexOf("{");
  const close = armText.lastIndexOf("}");
  const body = armText.slice(open + 1, close);

  const fields = new Set<string>();
  let discriminant: string | null = null;
  for (const def of splitTopLevel(body, ";")) {
    const m = /^([A-Za-z_][A-Za-z0-9_]*)\??\s*:\s*([\s\S]+)$/.exec(def.trim());
    if (!m) continue;
    const [, name, valueText] = m;
    fields.add(name);
    const trimmedValue = valueText.trim();
    if (!discriminant && /^(true|false|"[^"]*")$/.test(trimmedValue)) {
      discriminant = `${name}=${trimmedValue.replace(/"/g, "")}`;
    }
  }
  if (!discriminant) {
    throw new Error(`arm has no literal discriminant field: ${armText.slice(0, 80)}`);
  }
  return { discriminant, fields };
}

/** Maps each union arm's discriminant tag -> its field-name set. */
function unionArms(filePath: string, typeName: string): Map<string, Set<string>> {
  const body = unionTypeBody(filePath, typeName);
  const armTexts = splitTopLevel(body, "|");
  const map = new Map<string, Set<string>>();
  for (const armText of armTexts) {
    const { discriminant, fields } = armInfo(armText);
    map.set(discriminant, fields);
  }
  return map;
}

function assertFieldSetsMatch(
  label: string,
  serverFields: Set<string>,
  clientFields: Set<string>,
): void {
  const missingOnClient = [...serverFields].filter((f) => !clientFields.has(f));
  const missingOnServer = [...clientFields].filter((f) => !serverFields.has(f));
  expect(missingOnClient, `${label}: client mirror missing server fields`).toEqual([]);
  expect(missingOnServer, `${label}: server canonical missing client fields`).toEqual([]);
}

// ---------------------------------------------------------------------------
// Flat interfaces.
// ---------------------------------------------------------------------------

describe("org-schema sync — flat interfaces", () => {
  it.each([
    "OrgChartLeadView",
    "OrgChartView",
    "LeadRosterEntry",
    "LeadsRosterResponse",
    "AuditLogEntry",
    "AuditLogPage",
    "BeatRegisterEntryView",
    "OrgThreadRoundView",
    "OrgThreadCardView",
  ])(
    "%s: server canonical and client mirror declare the same field set",
    (name) => {
      assertFieldSetsMatch(
        name,
        interfaceFields(SERVER_PATH, name),
        interfaceFields(CLIENT_PATH, name),
      );
    },
  );
});

// ---------------------------------------------------------------------------
// Discriminated unions — per-arm comparison.
// ---------------------------------------------------------------------------

describe("org-schema sync — discriminated unions (per-arm)", () => {
  it.each([
    "UsageResponse",
    "LeadNowState",
    "LeadRoleView",
    "LeadCadenceView",
    "LastRunResponse",
    "BeatRegisterHealthResponse",
  ])(
    "%s: every arm's discriminant AND field set matches between server and client",
    (name) => {
      const serverArms = unionArms(SERVER_PATH, name);
      const clientArms = unionArms(CLIENT_PATH, name);

      const serverTags = [...serverArms.keys()].sort();
      const clientTags = [...clientArms.keys()].sort();
      expect(clientTags, `${name}: arm discriminant sets differ`).toEqual(serverTags);

      for (const tag of serverTags) {
        assertFieldSetsMatch(
          `${name} arm ${tag}`,
          serverArms.get(tag)!,
          clientArms.get(tag)!,
        );
      }
    },
  );
});
