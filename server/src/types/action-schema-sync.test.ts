/*
 * Drift-guard between client/src/types/action-schema.ts (subset) and
 * server/src/types/action-schema.ts (canonical). Every field the client
 * declares must exist on the server type — otherwise a future server
 * rename would silently break the modal.
 *
 * Lives in `server/` because node:fs / node:path / node:url are natural
 * here (client tsconfig has no @types/node). Tests the file's *content*
 * across the workspace boundary, not the type imports.
 *
 * Plan: iterate/launch-cli-parameters § 1 + Test #22.
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
  // Find the matching block — naive brace counting starting at the next `{`.
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
    // Skip comments and blank lines.
    if (
      !stripped ||
      stripped.startsWith("//") ||
      stripped.startsWith("/*") ||
      stripped.startsWith("*")
    ) {
      continue;
    }
    // Match `<name>?: ...` or `<name>: ...`.
    const m = /^([A-Za-z_][A-Za-z0-9_]*)\??\s*:/.exec(stripped);
    if (m) names.add(m[1]);
  }
  return names;
}

describe("action-schema sync — client subset vs server canonical", () => {
  it("every RenderableParamSchema field also exists on the server ParamSchema", () => {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    // server/src/types/ → ../../../client/src/types/action-schema.ts
    const clientPath = resolve(
      __dirname,
      "..",
      "..",
      "..",
      "client",
      "src",
      "types",
      "action-schema.ts",
    );
    const serverPath = resolve(__dirname, "action-schema.ts");
    const clientFields = fileNames(clientPath, "RenderableParamSchema");
    const serverFields = fileNames(serverPath, "ParamSchema");

    const missing: string[] = [];
    for (const f of clientFields) {
      if (!serverFields.has(f)) missing.push(f);
    }
    expect(missing, `client fields missing in server type: ${missing.join(", ")}`).toEqual([]);
  });
});
