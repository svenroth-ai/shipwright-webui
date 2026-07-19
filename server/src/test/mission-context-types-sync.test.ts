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
 * Both directions are checked: a field only the SERVER has means the mirror is
 * STALE (the client drops data already being sent); a field only the CLIENT has
 * means it is FABRICATED (a property nothing populates, rendering as absence).
 * Field TYPES are compared too, not only names — see `memberMap`.
 *
 * Same approach as `action-schema-sync.test.ts`: parse the file TEXT, not the
 * types — node:fs is natural in `server/`, the client tsconfig has no
 * @types/node, and text is what catches a mirror that compiles fine alone while
 * describing a different shape.
 *
 * @covers FR-01.66
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// The scanner + its own direct tests live next door (300-LOC rule).
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

/**
 * Every shared shape, listed explicitly.
 *
 * Explicit listing catches "listed but missing on one side". It does NOT catch
 * "never listed" — that is what the completeness test below is for, because a
 * hand-written list rots silently otherwise (adversarial review, GAP 2).
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

/**
 * Server exports the client deliberately does NOT mirror — each with its reason.
 *
 * This is an ALLOWLIST, not a skip list: the completeness test below fails on
 * any exported type that is in neither this nor the two lists above, so
 * "forgot to register a new shape" is loud instead of silent.
 */
const NOT_MIRRORED: Record<string, string> = {
  // A PERSISTENCE type (the guarded `task.missionContext` association write).
  // It never crosses the wire, so the client has nothing to mirror.
  MissionContextAssociation: "server-side persistence shape; never sent to the client",
};

/**
 * Mirrored, but verified by a DEDICATED test rather than field-by-field — so
 * still accounted for, and named here so the completeness check stays exact
 * instead of being loosened.
 */
const CHECKED_SEPARATELY: Record<string, string> = {
  ArtifactDescriptor: "a union of the artifact interfaces; membership is compared by its own test below",
};

/**
 * Type differences that are correct rather than drift, each with its reason.
 *
 * Kept deliberately tiny and keyed by `interface.field`: a broad exemption would
 * re-open the hole this comparison exists to close.
 */
const ALLOWED_TYPE_DIFFERENCES: Record<string, string> = {
  // The server pins the literal so a mismatched build cannot typecheck against
  // it; the client only needs to READ a number and must stay forward-compatible
  // with a server that bumps it.
  "MissionContext.schemaVersion": "server pins `typeof MISSION_CONTEXT_SCHEMA_VERSION`; the client reads a plain number",
};

function isAllowedTypeDifference(iface: string, field: string): boolean {
  return `${iface}.${field}` in ALLOWED_TYPE_DIFFERENCES;
}

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

    // …and the SHAPE, not only the topology. A field that exists on both sides
    // with a different type is the quiet, data-shaped misread this guard is for.
    const shapeDrift = sf
      .filter((f) => cm.has(f))
      .map((f) => ({
        field: f,
        server: resolveType(sm.get(f)!, server),
        client: resolveType(cm.get(f)!, client),
      }))
      .filter((d) => d.server !== d.client && !isAllowedTypeDifference(name, d.field))
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

    const sm = memberMap(s!);
    const cm = memberMap(c!);
    const expected = [...sm.keys()].filter((f) => f !== "kind").sort();
    expect([...cm.keys()].sort()).toEqual(expected);

    // Types too — this base is where `state` is INLINED client-side, so it is
    // the one most likely to go stale when a literal is added server-side.
    const drift = expected
      .filter((f) => cm.has(f))
      .filter((f) => resolveType(sm.get(f)!, server) !== resolveType(cm.get(f)!, client));
    expect(drift, `Slice3ArtifactBase field types drifted: ${drift.join(", ")}`).toEqual([]);
  });

  it("the ArtifactDescriptor union names the same members on both sides", () => {
    const s = new RegExp("type\\s+ArtifactDescriptor\\s*=([\\s\\S]*?);").exec(server);
    const c = new RegExp("type\\s+ArtifactDescriptor\\s*=([\\s\\S]*?);").exec(client);
    expect(s).not.toBeNull();
    expect(c).not.toBeNull();
    // Any capitalised member, not only names ending in `Artifact` — the suffix
    // is a convention, and a guard that only sees conventional names goes blind
    // the moment one is broken (adversarial review, LOWER).
    const names = (body: string) =>
      [...body.matchAll(/\b([A-Z][A-Za-z0-9_]*)\b/g)].map((m) => m[1]).sort();
    const sNames = names(s![1]);
    // Non-empty guard: `[] === []` would pass vacuously if the union were ever
    // reduced to nothing on both sides. `unionMembers` already guards this way.
    expect(sNames.length, "ArtifactDescriptor names no members").toBeGreaterThan(0);
    expect(names(c![1])).toEqual(sNames);
  });

  it("every exported server wire type is REGISTERED — the lists cannot rot silently", () => {
    // The lists above are hand-written, and explicit listing only catches
    // "listed but missing on one side". It does nothing for "never listed":
    // a seventh detail shape added server-side and forgotten is invisible to
    // every other test in this file. That is a rot that grows quietly, which is
    // the one failure mode this whole iterate is about (adversarial review,
    // GAP 2). So: enumerate the source and require each export to be accounted
    // for — mirrored, or explicitly and reasonedly not.
    const exported = [
      ...readAll(SERVER_FILES).matchAll(/^export\s+(?:interface|type)\s+([A-Za-z0-9_]+)/gm),
    ].map((m) => m[1]);

    expect(exported.length, "no exported types found — did SERVER_FILES move?").toBeGreaterThan(20);

    const registered = new Set([
      ...SHARED_INTERFACES,
      ...SHARED_UNIONS,
      ...Object.keys(NOT_MIRRORED),
      ...Object.keys(CHECKED_SEPARATELY),
    ]);
    const unregistered = [...new Set(exported)].filter((n) => !registered.has(n)).sort();

    expect(
      unregistered,
      `unregistered server wire type(s): ${unregistered.join(", ")}. Add each to SHARED_INTERFACES / SHARED_UNIONS, or to NOT_MIRRORED with the reason it is not mirrored.`,
    ).toEqual([]);
  });

  it("each artifact interface extends the SAME base on both sides", () => {
    // A client artifact that dropped `extends ArtifactBase`, or extended the
    // wrong base, is invisible to a body-only comparison: the inherited fields
    // simply stop being part of the shape without any body changing.
    const baseOf = (src: string, name: string): string | null => {
      const m = new RegExp(`interface\\s+${name}\\s+extends\\s+([A-Za-z0-9_]+)`).exec(src);
      return m ? m[1] : null;
    };
    // The client mirrors the shared base under a second name in Slice 3; that
    // rename is intentional and is verified field-by-field by the test above.
    const equivalent = (a: string | null, b: string | null): boolean =>
      a === b || (a === "ArtifactBase" && b === "Slice3ArtifactBase");

    const drift = SHARED_INTERFACES.filter((n) => n !== "ArtifactBase").filter(
      (n) => !equivalent(baseOf(server, n), baseOf(client, n)),
    );
    expect(
      drift,
      `these interfaces extend a different base on each side: ${drift.join(", ")}`,
    ).toEqual([]);
  });
});
