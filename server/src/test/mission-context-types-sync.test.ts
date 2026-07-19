/*
 * Drift-guard between the SERVER's Mission wire types and the CLIENT's verbatim
 * mirror (triage `trg-2228d368` B2).
 *
 *   server  core/mission-context/{types,types-slice2,types-slice3}.ts   (SoT)
 *   client  lib/{missionContextApi,missionSlice3Types}.ts               (mirror)
 *
 * DO-NOT #7 / ADR-080 forbid cross-package imports, so these two are kept in
 * sync BY HAND. The repo already enforces exactly this elsewhere
 * (`types/action-schema-sync.test.ts`, `types/triage-schema-sync.test.ts`) — the
 * Mission surface was the one that had no guard, and the campaign then added
 * four artifact kinds and five detail shapes to it.
 *
 * Both directions are checked, because the two failures are different:
 *   - a field only the SERVER has  → the mirror is STALE; the client silently
 *     drops data the server is already sending.
 *   - a field only the CLIENT has  → the mirror is FABRICATED; components read
 *     a property nothing ever populates, and `undefined` renders as absence.
 *
 * Same approach as `action-schema-sync.test.ts`: parse the file TEXT rather than
 * the types, because node:fs is natural in `server/` and the client tsconfig has
 * no @types/node. Comparing text is also what catches a mirror that compiles
 * fine on its own while describing a different shape.
 *
 * @covers FR-01.66
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
// server/src/test/ → repo root
const ROOT = resolve(HERE, "..", "..", "..");

const SERVER_FILES = [
  "server/src/core/mission-context/types.ts",
  "server/src/core/mission-context/types-slice2.ts",
  "server/src/core/mission-context/types-slice3.ts",
];
const CLIENT_FILES = [
  "client/src/lib/missionContextApi.ts",
  "client/src/lib/missionSlice3Types.ts",
];

function readAll(rel: string[]): string {
  return rel.map((r) => readFileSync(resolve(ROOT, r), "utf-8")).join("\n");
}

/** Strip block + line comments so a doc-comment can never look like a member. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/** Body of `interface <name> { … }`, by brace matching. Null when absent. */
function interfaceBody(src: string, name: string): string | null {
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
 * EVERY property name in an interface body, including nested ones, as dotted
 * paths (`detail.malformedCount`).
 *
 * Nesting is not an implementation detail here — it is where the risk lives.
 * The artifact descriptors are all `{ kind, label, …, detail: { … } | null }`,
 * so a version of this collector that only walked the top level would compare
 * `kind` and `detail` and call two structurally different `detail` shapes
 * identical. That version was written first, and the falsification pass caught
 * it: deleting `malformedCount` from the client mirror left the guard green.
 * The five detail shapes this campaign added are exactly the surface it missed.
 */
function fieldNames(body: string): Set<string> {
  const names = new Set<string>();
  const stack: string[] = [];
  let lastKey: string | null = null;
  // A member may begin after `{`, `;`, `,` or a newline — the scan must be
  // character-driven, not line-driven: the client writes its detail shapes
  // inline (`detail: { type: "reviews"; rows: ReviewRow[] } | null;`) while the
  // server writes them across lines. A per-line parser sees only the first key
  // of each line and silently reports the rest as drift.
  let atMemberStart = true;
  let i = 0;

  while (i < body.length) {
    const ch = body[i];

    // Skip string literals whole — a brace or semicolon inside one is text.
    if (ch === '"' || ch === "'" || ch === "`") {
      const quote = ch;
      i++;
      while (i < body.length && body[i] !== quote) i += body[i] === "\\" ? 2 : 1;
      i++;
      atMemberStart = false;
      continue;
    }

    if (ch === "{") {
      stack.push(lastKey ?? "");
      lastKey = null;
      atMemberStart = true;
      i++;
      continue;
    }
    if (ch === "}") {
      stack.pop();
      lastKey = null;
      atMemberStart = true;
      i++;
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
      const m = /^([A-Za-z_][A-Za-z0-9_]*)\??\s*:/.exec(body.slice(i));
      if (m) {
        names.add([...stack, m[1]].join("."));
        lastKey = m[1];
        i += m[0].length;
        atMemberStart = false;
        continue;
      }
    }
    atMemberStart = false;
    i++;
  }
  return names;
}

/** String-literal members of `type <name> = "a" | "b" …`, up to the `;`. */
function unionMembers(src: string, name: string): Set<string> | null {
  const m = new RegExp(`type\\s+${name}\\s*=`).exec(src);
  if (!m) return null;
  const start = m.index + m[0].length;
  const end = src.indexOf(";", start);
  const body = src.slice(start, end === -1 ? undefined : end);
  const members = new Set<string>();
  for (const lit of body.matchAll(/"([^"]+)"/g)) members.add(lit[1]);
  return members.size > 0 ? members : null;
}

/**
 * Every shared shape. Listing them EXPLICITLY rather than discovering them is
 * the point: a new type added to one side and forgotten on the other would be
 * invisible to a "compare what both happen to declare" scan — which is exactly
 * the drift this test exists to catch.
 */
const SHARED_INTERFACES = [
  // EVERY artifact interface `extends` this, so a drift in `label` / `state` /
  // `summary` / `receipt` / `note` would slip past a per-interface comparison
  // that never resolves inheritance — a guard that looks total and is not
  // (external code review, openai #6). The client declares it un-exported and
  // Slice-3 names its copy `Slice3ArtifactBase`; both are checked below.
  "ArtifactBase",
  "FrRow",
  "SpecArtifact",
  "RequirementArtifact",
  "CommitArtifact",
  "TestFrRef",
  "TestRow",
  "TestsArtifact",
  "ReviewFinding",
  "ReviewRow",
  "ReviewArtifact",
  "DecisionEntryView",
  "DecisionsArtifact",
  "PhaseDetail",
  "PhaseArtifact",
  "CampaignRunbookArtifact",
  "CampaignSubIterateRow",
  "CampaignProgressDetail",
  "CampaignProgressArtifact",
  "SubIterateDetail",
  "SubIterateArtifact",
  "MissionTests",
  "MissionContext",
];

const SHARED_UNIONS = [
  "MissionScenario",
  "ArtifactState",
  "ArtifactKind",
  "RequirementConfidence",
  "MergeState",
  "TestChangeKind",
  "ReviewType",
  "ReviewStatus",
  "DecisionSource",
  "SubIterateSelection",
];

describe("mission-context types — server SoT vs client verbatim mirror", () => {
  const server = stripComments(readAll(SERVER_FILES));
  const client = stripComments(readAll(CLIENT_FILES));

  it.each(SHARED_INTERFACES)("interface %s has identical fields on both sides", (name) => {
    const s = interfaceBody(server, name);
    const c = interfaceBody(client, name);

    expect(s, `interface ${name} not found in the SERVER types`).not.toBeNull();
    expect(c, `interface ${name} not found in the CLIENT mirror`).not.toBeNull();

    const sf = [...fieldNames(s!)].sort();
    const cf = [...fieldNames(c!)].sort();

    const missingInClient = sf.filter((f) => !cf.includes(f));
    const extraInClient = cf.filter((f) => !sf.includes(f));

    expect(
      missingInClient,
      `${name}: the client mirror is STALE — it is missing ${missingInClient.join(", ")}, so the server sends data the UI drops`,
    ).toEqual([]);
    expect(
      extraInClient,
      `${name}: the client mirror is FABRICATED — it declares ${extraInClient.join(", ")}, which no server type populates`,
    ).toEqual([]);
  });

  it.each(SHARED_UNIONS)("union %s has identical members on both sides", (name) => {
    const s = unionMembers(server, name);
    const c = unionMembers(client, name);

    expect(s, `type ${name} not found in the SERVER types`).not.toBeNull();
    expect(c, `type ${name} not found in the CLIENT mirror`).not.toBeNull();

    expect(
      [...c!].sort(),
      `${name}: union members drifted — a kind the server can emit but the client cannot name falls through every switch`,
    ).toEqual([...s!].sort());
  });

  it("the Slice-3 client base mirrors ArtifactBase apart from the intentional `kind`", () => {
    // The client mirrors the shared base TWICE under two names, and the second
    // copy is just as load-bearing and just as easy to let drift.
    //
    // ONE difference is deliberate and must stay allowed: `Slice3ArtifactBase`
    // omits `kind` because every concrete Slice-3 artifact re-declares it as its
    // own string literal (`kind: "phase"`). Encoding that exception explicitly is
    // the point — a blanket "these must be equal" would have been wrong, and a
    // blanket "client ⊆ server" would let `note` or `receipt` silently vanish.
    const s = interfaceBody(server, "ArtifactBase");
    const c = interfaceBody(client, "Slice3ArtifactBase");
    expect(s).not.toBeNull();
    expect(c, "Slice3ArtifactBase not found in the CLIENT mirror").not.toBeNull();

    const expected = [...fieldNames(s!)].filter((f) => f !== "kind").sort();
    expect([...fieldNames(c!)].sort()).toEqual(expected);
  });

  it("the ArtifactDescriptor union names the same members on both sides", () => {
    const s = new RegExp("type\\s+ArtifactDescriptor\\s*=([\\s\\S]*?);").exec(server);
    const c = new RegExp("type\\s+ArtifactDescriptor\\s*=([\\s\\S]*?);").exec(client);
    expect(s).not.toBeNull();
    expect(c).not.toBeNull();
    const names = (body: string) =>
      [...body.matchAll(/\b([A-Z][A-Za-z0-9_]*Artifact)\b/g)].map((m) => m[1]).sort();
    expect(names(c![1])).toEqual(names(s![1]));
  });
});
