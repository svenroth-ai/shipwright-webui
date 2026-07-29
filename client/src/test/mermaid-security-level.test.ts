/*
 * META-TEST — the real-browser mermaid harness must render under the SAME
 * securityLevel the app does.
 * iterate-2026-07-29-mermaid-real-render-e2e.
 *
 * `client/e2e/flows/mermaid-real-render.spec.ts` renders a real diagram with
 * the real mermaid + DOMPurify, to catch a rendering or sanitization
 * regression that `MermaidRenderer.test.tsx` (which stubs mermaid via
 * `vi.mock`) structurally cannot see. That harness is only worth anything while
 * it renders under the app's OWN configuration — a synthetic harness that
 * drifts from the component it stands in for tests nothing.
 *
 * Both drift directions are covered, per the registry-driven SSoT rule: change
 * the component and this fails; change the spec's constant and this fails.
 *
 * It lives here rather than inside the Playwright spec (where it started)
 * because it is a pure source scan with no browser in it, and because the
 * vitest meta-test family is this repo's documented home for exactly this
 * shape — see `doc-sync.test.ts`, `create-cta-standard.test.ts`,
 * `modal-scroll-body-invariant.test.ts`, `shell-scroll-invariant.test.ts`
 * (CLAUDE.md rules 11, 24, 26, 27). Filing it here also means it runs in the
 * fast `Client (type + lint + test)` PR gate, not only behind the container job
 * that boots an isolated stack.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLIENT_ROOT = path.resolve(HERE, "..", "..");

const RENDERER_SRC = path.join(
  CLIENT_ROOT,
  "src/components/external/SmartViewer/MermaidRenderer.tsx",
);
const HARNESS_SRC = path.join(
  CLIENT_ROOT,
  "e2e/flows/mermaid-real-render.spec.ts",
);

/**
 * Anchored on the `.initialize(` CALL, not on the bare word.
 *
 * A bare /securityLevel:\s*"([a-z]+)"/ took the first match ANYWHERE in the
 * file, comments included. Today the component's only occurrence is the real
 * call, but the day it reads the level from config or props and a doc comment
 * still says `securityLevel: "strict"`, that guard would read the comment and
 * pass while the app ran something else — a meta-test asserting its own
 * documentation. (Stage-3 doubt review, 2026-07-29.)
 */
const COMPONENT_RE = /\.initialize\(\s*\{[^}]*securityLevel:\s*["']([a-z]+)["']/;
/** `const APP_SECURITY_LEVEL = "strict";` as the harness declares it. */
const HARNESS_RE = /const APP_SECURITY_LEVEL\s*=\s*["']([a-z]+)["']/;

/** Block and line comments, so neither regex can match prose about the code. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

function extract(file: string, re: RegExp, what: string): string {
  const match = re.exec(stripComments(readFileSync(file, "utf8")));
  expect(match, `${what} not found in ${file}`).not.toBeNull();
  return match![1];
}

describe("mermaid securityLevel — component vs real-browser harness", () => {
  it("MermaidRenderer declares a securityLevel at all", () => {
    // A render with no securityLevel is mermaid's permissive default, which
    // would be a security regression in its own right — worth failing on
    // separately from the agreement check below.
    expect(
      extract(RENDERER_SRC, COMPONENT_RE, "securityLevel"),
    ).toBeTruthy();
  });

  it("the e2e harness renders under the component's securityLevel", () => {
    const component = extract(RENDERER_SRC, COMPONENT_RE, "securityLevel");
    const harness = extract(HARNESS_SRC, HARNESS_RE, "APP_SECURITY_LEVEL");

    expect(
      harness,
      `client/e2e/flows/mermaid-real-render.spec.ts renders under "${harness}" ` +
        `but MermaidRenderer.tsx initializes mermaid with "${component}". ` +
        "The real-browser guard is only meaningful under the app's own config — " +
        "update whichever of the two is wrong.",
    ).toBe(component);
  });
});
