/*
 * org-inventory-schema-sync.test.ts — drift guard between the Lead
 * Inventory page's server-canonical types, split across
 * `server/src/types/leadwright-beat-step.ts`,
 * `server/src/external/org/charter-authority-read.ts`, and
 * `server/src/types/org-inventory.ts`, and their VERBATIM client mirror in
 * `client/src/lib/leadInventoryApi.ts` (CLAUDE.md rule 7). Added in Stage-2
 * code review (medium/architecture): the mirror shipped with no drift
 * guard despite its own header asserting the discipline, unlike every
 * other cross-package mirror pair in this repo
 * (`org-schema-sync.test.ts`, `triage-schema-sync.test.ts`,
 * `action-schema-sync.test.ts`).
 *
 * Reuses `org-schema-sync.test.ts`'s depth-aware comment-stripper and
 * top-level `|`-splitter rather than re-deriving them. Two shapes appear
 * here that file's helpers don't directly cover:
 *   - a `type X = { field: "a" | "b" }` single-object alias with a
 *     string-literal-union field but NO second object arm (`StepsView`'s
 *     sibling `UnclaimedEffectView`/`RegisterView`) — `flatTypeFields`
 *     below handles both `interface X {}` and this shape.
 *   - `StepsView`/`CharterAuthorityResult`/`BeatStepEffect` ARE real
 *     multi-arm discriminated unions and reuse the arm-by-arm comparison.
 *
 * Falsified locally before being declared done: drop `unreadableLines`
 * from the client's `StepsView` "ok" arm, confirm this test goes red, then
 * restore.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const BEAT_STEP_PATH = resolve(__dirname, "leadwright-beat-step.ts");
const CHARTER_AUTHORITY_PATH = resolve(__dirname, "..", "external", "org", "charter-authority-read.ts");
const ORG_INVENTORY_PATH = resolve(__dirname, "org-inventory.ts");
const CLIENT_PATH = resolve(__dirname, "..", "..", "..", "client", "src", "lib", "leadInventoryApi.ts");

function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

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

function braceBody(raw: string, openIdx: number): string {
  let depth = 0;
  let end = openIdx;
  for (let i = openIdx; i < raw.length; i++) {
    if (raw[i] === "{") depth++;
    else if (raw[i] === "}") {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  return stripComments(raw.slice(openIdx + 1, end));
}

function fieldNamesFromBody(body: string): Set<string> {
  const names = new Set<string>();
  for (const def of splitTopLevel(body, ";")) {
    const m = /^([A-Za-z_][A-Za-z0-9_]*)\??\s*:/.exec(def.trim());
    if (m) names.add(m[1]);
  }
  return names;
}

/** `interface Name { ... }` OR `type Name = { ... }` (single object, no
 *  top-level `|`) — either shape, same field-set extraction. */
function flatTypeFields(filePath: string, typeName: string): Set<string> {
  const raw = readFileSync(filePath, "utf-8");
  const asInterface = raw.indexOf(`interface ${typeName}`);
  if (asInterface !== -1) {
    const open = raw.indexOf("{", asInterface);
    return fieldNamesFromBody(braceBody(raw, open));
  }
  const marker = `type ${typeName} =`;
  const asType = raw.indexOf(marker);
  if (asType === -1) {
    throw new Error(`neither "interface ${typeName}" nor "${marker}" found in ${filePath}`);
  }
  const open = raw.indexOf("{", asType);
  return fieldNamesFromBody(braceBody(raw, open));
}

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

function armInfo(armText: string): { discriminant: string; fields: Set<string> } {
  const open = armText.indexOf("{");
  const close = armText.lastIndexOf("}");
  const body = stripComments(armText.slice(open + 1, close));
  const fields = fieldNamesFromBody(body);
  let discriminant: string | null = null;
  for (const def of splitTopLevel(body, ";")) {
    const m = /^([A-Za-z_][A-Za-z0-9_]*)\??\s*:\s*([\s\S]+)$/.exec(def.trim());
    if (!m) continue;
    const [, name, valueText] = m;
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

function assertFieldSetsMatch(label: string, serverFields: Set<string>, clientFields: Set<string>): void {
  const missingOnClient = [...serverFields].filter((f) => !clientFields.has(f));
  const missingOnServer = [...clientFields].filter((f) => !serverFields.has(f));
  expect(missingOnClient, `${label}: client mirror missing server fields`).toEqual([]);
  expect(missingOnServer, `${label}: server canonical missing client fields`).toEqual([]);
}

describe("lead-inventory schema sync — flat types", () => {
  it.each([
    ["BeatStep", BEAT_STEP_PATH],
    ["AuthorityBandView", CHARTER_AUTHORITY_PATH],
    ["BeatInventoryView", ORG_INVENTORY_PATH],
    ["LeadInventoryEntry", ORG_INVENTORY_PATH],
    ["UnclaimedEffectView", ORG_INVENTORY_PATH],
    ["RegisterView", ORG_INVENTORY_PATH],
  ] as const)("%s: server canonical and client mirror declare the same field set", (name, serverPath) => {
    assertFieldSetsMatch(name, flatTypeFields(serverPath, name), flatTypeFields(CLIENT_PATH, name));
  });
});

describe("lead-inventory schema sync — discriminated unions (per-arm)", () => {
  it.each([
    ["StepsView", ORG_INVENTORY_PATH],
    ["CharterAuthorityResult", CHARTER_AUTHORITY_PATH],
    ["BeatStepEffect", BEAT_STEP_PATH],
  ] as const)("%s: every arm's discriminant AND field set matches between server and client", (name, serverPath) => {
    const serverArms = unionArms(serverPath, name);
    const clientArms = unionArms(CLIENT_PATH, name);

    const serverTags = [...serverArms.keys()].sort();
    const clientTags = [...clientArms.keys()].sort();
    expect(clientTags, `${name}: arm discriminant sets differ`).toEqual(serverTags);

    for (const tag of serverTags) {
      assertFieldSetsMatch(`${name} arm ${tag}`, serverArms.get(tag)!, clientArms.get(tag)!);
    }
  });
});
