/*
 * The TYPE-TEXT SCANNER behind `mission-context-types-sync.test.ts`, plus its
 * own direct tests.
 *
 * Split out at the 300-LOC rule. It lives in a `.test.ts` file ON PURPOSE:
 * `server/tsconfig.json` excludes every `.test.ts` from the build, so a test-only
 * helper module named this way cannot leak into `dist/` the way
 * `slice2-test-fixtures.ts` and `test-harness.ts` already do (noted as an
 * accidental convention in ADR-134 I6). Vitest imports it happily.
 *
 * The scanner earned direct tests: the mirror guard is only as good as this
 * code, and TWO historical misses were failures OF THE SCANNER rather than of
 * the assertions — it skipped nested members, then it discarded type text
 * entirely. Testing it only through the mirror comparison means it is exercised
 * exclusively on inputs that currently agree, which is the weakest possible
 * place to look for a parsing bug.
 *
 * @covers FR-01.66
 */

import { describe, expect, it } from "vitest";

/** Strip block + line comments so a doc-comment can never look like a member. */
export function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/** Body of `interface <name> { … }`, by brace matching. Null when absent. */
export function interfaceBody(src: string, name: string): string | null {
  const m = new RegExp(`interface\\s+${name}\\b`).exec(src);
  if (!m) return null;
  const open = src.indexOf("{", m.index);
  if (open === -1) return null;
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) return src.slice(open + 1, i);
    }
  }
  return null;
}

/**
 * One member of an object type: its dotted path (with `?` folded in) and the
 * TEXT of its type, nested object bodies elided to `{…}`.
 */
interface MemberInfo {
  name: string;
  type: string;
  nested: string | null;
}

export function normalizeType(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Top-level members of an object body, character-driven.
 *
 * Character-driven rather than line-driven because the server writes its detail
 * shapes across lines while the client writes the SAME shape inline
 * (`detail: { type: "reviews"; rows: ReviewRow[] } | null;`). A per-line parser
 * sees only the first key of each line and reports the rest as drift.
 */
export function topLevelMembers(body: string): MemberInfo[] {
  const out: MemberInfo[] = [];
  let i = 0;
  let atMemberStart = true;

  const skipString = (pos: number): number => {
    const quote = body[pos];
    let j = pos + 1;
    while (j < body.length && body[j] !== quote) j += body[j] === "\\" ? 2 : 1;
    return j + 1;
  };

  while (i < body.length) {
    const ch = body[i];
    if (ch === '"' || ch === "'" || ch === "`") {
      i = skipString(i);
      atMemberStart = false;
      continue;
    }
    if (ch === ";" || ch === "," || ch === "\n") {
      atMemberStart = true;
      i++;
      continue;
    }
    if (/\s/.test(ch)) {
      i++;
      continue;
    }

    if (atMemberStart) {
      const m = /^([A-Za-z_][A-Za-z0-9_]*)(\??)\s*:/.exec(body.slice(i));
      if (m) {
        i += m[0].length;
        // Read the type text up to this member's terminator, eliding any nested
        // object body (which is compared separately, by dotted path).
        let depth = 0;
        let nested: string | null = null;
        let nestedStart = -1;
        const chars: string[] = [];
        while (i < body.length) {
          const c = body[i];
          if (c === '"' || c === "'" || c === "`") {
            const next = skipString(i);
            if (depth === 0) chars.push(body.slice(i, next));
            i = next;
            continue;
          }
          if (c === "{") {
            if (depth === 0) {
              nestedStart = i + 1;
              chars.push("{…}");
            }
            depth++;
            i++;
            continue;
          }
          if (c === "}") {
            if (depth === 0) break; // closes the ENCLOSING object: member ends
            depth--;
            if (depth === 0 && nestedStart !== -1) nested = body.slice(nestedStart, i);
            i++;
            continue;
          }
          if (depth === 0 && (c === ";" || c === ",")) break;
          if (depth === 0) chars.push(c);
          i++;
        }
        out.push({ name: m[1] + m[2], type: normalizeType(chars.join("")), nested });
        atMemberStart = true;
        continue;
      }
    }
    atMemberStart = false;
    i++;
  }
  return out;
}

/**
 * EVERY member of an interface, nested ones included, as `dotted.path` → type.
 *
 * Two failures this map exists to catch, and the second is why the earlier
 * name-only Set was not enough:
 *
 *   1. TOPOLOGY — a field present on one side and not the other. The artifact
 *      descriptors are all `{ kind, label, …, detail: { … } | null }`, so a
 *      collector that walked only the top level would compare `kind` and
 *      `detail` and call two structurally different detail shapes identical.
 *   2. SHAPE — a field present on both sides with a DIFFERENT type. `string` →
 *      `string | null`, `note?` → `note`, two sibling `| null` fields swapped.
 *      Nearly every field on this wire is `X | null`, and a client that drops
 *      `| null` is precisely the "quiet and data-shaped" misread this guard
 *      claims to prevent — yet a name-only comparison cannot see any of it
 *      (adversarial review of the guard, GAP 1).
 *
 * Optionality is folded into the KEY (`note?`), so flipping it reads as a
 * topology change rather than needing its own comparison.
 */
export function memberMap(body: string, prefix = ""): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of topLevelMembers(body)) {
    const key = prefix ? `${prefix}.${m.name}` : m.name;
    out.set(key, m.type);
    if (m.nested !== null) {
      const base = key.replace(/\?$/, "");
      for (const [k, v] of memberMap(m.nested, base)) out.set(k, v);
    }
  }
  return out;
}

/**
 * Resolve a type text to a comparable form.
 *
 * A NAMED union on one side and its INLINED literals on the other describe the
 * same wire shape, and both spellings are live in-tree: `Slice3ArtifactBase`
 * inlines the five `ArtifactState` literals while the server references the
 * named type. Comparing the raw text would flag that benign difference — but
 * simply exempting it would leave the genuine hazard the reviewer named: add a
 * SIXTH `ArtifactState` and the inlined copy goes stale, unflagged.
 *
 * Resolving both sides to a sorted literal set catches exactly that, because
 * the server's expanded set would then differ from the client's stale one.
 */
export function resolveType(text: string, src: string): string {
  const named = /^([A-Za-z_][A-Za-z0-9_]*)$/.exec(text);
  if (named) {
    const members = unionMembers(src, named[1]);
    if (members) return [...members].sort().join(" | ");
  }
  if (/^"[^"]*"(\s*\|\s*"[^"]*")*$/.test(text)) {
    return [...text.matchAll(/"([^"]+)"/g)].map((m) => m[1]).sort().join(" | ");
  }
  return text;
}

/** String-literal members of `type <name> = "a" | "b" …`, up to the `;`. */
export function unionMembers(src: string, name: string): Set<string> | null {
  const m = new RegExp(`type\\s+${name}\\s*=`).exec(src);
  if (!m) return null;
  const start = m.index + m[0].length;
  const end = src.indexOf(";", start);
  const body = src.slice(start, end === -1 ? undefined : end);
  const members = new Set<string>();
  for (const lit of body.matchAll(/"([^"]+)"/g)) members.add(lit[1]);
  return members.size > 0 ? members : null;
}

// ---------------------------------------------------------------------------
// Direct tests of the scanner itself
// ---------------------------------------------------------------------------

describe("topLevelMembers / memberMap — the scanner the mirror guard rests on", () => {
  it("reads a MULTI-LINE shape and its INLINE twin identically", () => {
    const multi = `
      kind: "tests";
      detail: {
        type: "tests";
        rows: TestRow[];
      } | null;
    `;
    const inline = `kind: "tests"; detail: { type: "tests"; rows: TestRow[] } | null;`;
    expect([...memberMap(multi).entries()].sort()).toEqual([...memberMap(inline).entries()].sort());
  });

  it("captures the TYPE text, with nested bodies elided", () => {
    const m = memberMap(`detail: { a: string } | null; plain: string | null;`);
    expect(m.get("detail")).toBe("{…} | null");
    expect(m.get("plain")).toBe("string | null");
    expect(m.get("detail.a")).toBe("string");
  });

  it("distinguishes `string` from `string | null` — the whole point of GAP 1", () => {
    expect(memberMap("x: string;").get("x")).toBe("string");
    expect(memberMap("x: string | null;").get("x")).toBe("string | null");
  });

  it("folds optionality into the KEY so a flip reads as topology", () => {
    expect([...memberMap("note?: string;").keys()]).toEqual(["note?"]);
    expect([...memberMap("note: string;").keys()]).toEqual(["note"]);
  });

  it("does not mistake braces or semicolons INSIDE a string literal for syntax", () => {
    const m = memberMap(`label: "a { b ; c }"; after: string;`);
    expect(m.get("after")).toBe("string");
    expect([...m.keys()].sort()).toEqual(["after", "label"]);
  });

  it("walks TWO levels of nesting into dotted paths", () => {
    const m = memberMap(`a: { b: { c: string } };`);
    expect(m.get("a.b.c")).toBe("string");
  });

  it("normalises whitespace so formatting is never reported as drift", () => {
    expect(memberMap("x:   string   |    null;").get("x")).toBe("string | null");
  });
});

describe("resolveType — a named union and its inlined literals are the same shape", () => {
  const src = `export type ArtifactState = "available" | "error";`;

  it("expands a named union to its sorted members", () => {
    expect(resolveType("ArtifactState", src)).toBe("available | error");
  });

  it("sorts an inlined literal union to the same form", () => {
    expect(resolveType('"error" | "available"', src)).toBe("available | error");
  });

  it("still separates a union that genuinely lost a member", () => {
    expect(resolveType('"available"', src)).not.toBe(resolveType("ArtifactState", src));
  });

  it("leaves an ordinary type untouched", () => {
    expect(resolveType("string | null", src)).toBe("string | null");
  });
});
