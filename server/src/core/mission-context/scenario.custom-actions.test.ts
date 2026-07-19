/*
 * scenario.custom-actions.test.ts — S3 AC2: the ONE decision in this campaign
 * that removes a whole surface.
 *
 * Scenario 6 hides the entire Mission tab. The two failure directions are NOT
 * symmetric:
 *   - too permissive → an empty Mission tab. Ugly, self-evident, recoverable.
 *   - too aggressive → a working feature VANISHES for a project that needed it,
 *     with no error, no message and no discoverable cause.
 * So every AMBIGUOUS input must resolve to SHOWING, and the fallback cases are
 * pinned here at least as thoroughly as the hide case.
 *
 * The second describe block is the load-bearing one: it drives the REAL loader
 * over REAL files on disk, because the bug this file was written for lived in
 * the gap between the declared type and what the JSON boundary actually yields.
 * A pure-unit test could not have found it — `actionIds: readonly string[]` is
 * exactly the claim that turned out to be false.
 *
 * @covers FR-01.66
 */

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { clearActionsCache, loadActionsForProject } from "../project-actions-loader.js";
import { detectScenario, isValidatedCustomActions, type ScenarioInputs } from "./scenario.js";

function inputs(over: Partial<ScenarioInputs> = {}): ScenarioInputs {
  return {
    pointer: { status: "absent" },
    actions: { fromUser: true, hasDiagnostics: false, actionIds: ["publish-post"] },
    hasValidRunConfig: false,
    phaseTaskId: null,
    taskRunId: null,
    campaignSlug: null,
    hasCampaignRecord: false,
    ...over,
  };
}

// The type says `readonly string[]`; the JSON boundary does not enforce it.
// Casting here is the POINT of the test, not a shortcut around it.
function ids(v: unknown[]): readonly string[] {
  return v as readonly string[];
}

describe("scenario 6 — every ambiguous actions catalog falls back to SHOWING", () => {
  it("hides ONLY for a well-formed, purely-custom catalog with no run-config", () => {
    expect(isValidatedCustomActions(inputs())).toBe(true);
  });

  // --- the S3 regression: valid JSON, wrong shape --------------------------
  it("SHOWS when an action entry carries no id at all (`[{foo:'bar'}]`)", () => {
    expect(
      isValidatedCustomActions(inputs({ actions: { fromUser: true, hasDiagnostics: false, actionIds: ids([undefined]) } })),
    ).toBe(false);
  });

  it("SHOWS when an action id is null", () => {
    expect(
      isValidatedCustomActions(inputs({ actions: { fromUser: true, hasDiagnostics: false, actionIds: ids([null]) } })),
    ).toBe(false);
  });

  it("SHOWS when an action id is a number rather than a string", () => {
    expect(
      isValidatedCustomActions(inputs({ actions: { fromUser: true, hasDiagnostics: false, actionIds: ids([7]) } })),
    ).toBe(false);
  });

  it("SHOWS when an action id is the empty string", () => {
    expect(
      isValidatedCustomActions(inputs({ actions: { fromUser: true, hasDiagnostics: false, actionIds: [""] } })),
    ).toBe(false);
  });

  it("SHOWS when ONE id among several is unusable (partial shape is still wrong)", () => {
    expect(
      isValidatedCustomActions(
        inputs({ actions: { fromUser: true, hasDiagnostics: false, actionIds: ids(["publish-post", undefined]) } }),
      ),
    ).toBe(false);
  });

  it("SHOWS when the id list is not a list at all", () => {
    const notAList = "publish-post" as unknown as readonly string[];
    expect(
      isValidatedCustomActions(
        inputs({ actions: { fromUser: true, hasDiagnostics: false, actionIds: notAList } }),
      ),
    ).toBe(false);
  });

  // --- the cases that were already right, pinned so they stay right --------
  it("SHOWS when the catalog is unreadable (facts degraded to null)", () => {
    expect(isValidatedCustomActions(inputs({ actions: null }))).toBe(false);
  });

  it("SHOWS when the loader raised a diagnostic (malformed / truncated file)", () => {
    expect(
      isValidatedCustomActions(inputs({ actions: { fromUser: true, hasDiagnostics: true, actionIds: ["publish-post"] } })),
    ).toBe(false);
  });

  it("SHOWS for an empty actions array (a file that declares nothing)", () => {
    expect(
      isValidatedCustomActions(inputs({ actions: { fromUser: true, hasDiagnostics: false, actionIds: [] } })),
    ).toBe(false);
  });

  it("SHOWS in DUAL mode — custom actions AND a valid SDLC run-config", () => {
    expect(isValidatedCustomActions(inputs({ hasValidRunConfig: true }))).toBe(false);
  });

  it("SHOWS in DUAL mode — a builtin action id survives alongside the customs", () => {
    expect(
      isValidatedCustomActions(
        inputs({ actions: { fromUser: true, hasDiagnostics: false, actionIds: ["publish-post", "new-iterate"] } }),
      ),
    ).toBe(false);
  });

  it("SHOWS when the file is merely PRESENT but resolved to the bundled default", () => {
    expect(
      isValidatedCustomActions(inputs({ actions: { fromUser: false, hasDiagnostics: false, actionIds: ["publish-post"] } })),
    ).toBe(false);
  });

  // --- precedence: the hide must beat a leftover pointer, but only validly --
  it("a stale iterate pointer does NOT resurrect Mission under a VALID custom-actions project", () => {
    const d = detectScenario(
      inputs({ pointer: { status: "invalid", reason: "session_id_mismatch" } }),
    );
    expect(d.scenario).toBe("custom_actions");
    expect(d.missionTabVisible).toBe(false);
  });

  it("but a stale pointer under a WRONG-SHAPE actions file keeps the tab (mode never validated)", () => {
    const d = detectScenario(
      inputs({
        pointer: { status: "invalid", reason: "session_id_mismatch" },
        actions: { fromUser: true, hasDiagnostics: false, actionIds: ids([undefined]) },
      }),
    );
    expect(d.missionTabVisible).toBe(true);
    expect(d.scenario).not.toBe("custom_actions");
  });
});

// ---------------------------------------------------------------------------
// The real chain: a file on disk → the production loader → facts → the gate.
// ---------------------------------------------------------------------------

const roots: string[] = [];

afterEach(() => {
  clearActionsCache();
});

function projectWith(actionsJson: string): string {
  const root = mkdtempSync(path.join(tmpdir(), "s3-actions-"));
  roots.push(root);
  mkdirSync(path.join(root, ".shipwright-webui"), { recursive: true });
  writeFileSync(path.join(root, ".shipwright-webui", "actions.json"), actionsJson, "utf-8");
  clearActionsCache();
  return root;
}

/** VERBATIM mirror of `external/mission-context/facts.ts` — same mapping, same try/catch. */
function factsFor(projectRoot: string): ScenarioInputs["actions"] {
  try {
    const loaded = loadActionsForProject(projectRoot);
    return {
      fromUser: loaded.fromUser,
      hasDiagnostics: loaded.diagnostics.length > 0,
      actionIds: loaded.actions.actions.map((a) => a.id),
    };
  } catch {
    return null;
  }
}

function tabHiddenFor(actionsJson: string): boolean {
  return !detectScenario(inputs({ actions: factsFor(projectWith(actionsJson)) })).missionTabVisible;
}

describe("scenario 6 — round-trip over REAL files through the REAL loader", () => {
  it("hides for a genuine custom-actions catalog", () => {
    expect(
      tabHiddenFor('{"schemaVersion":1,"actions":[{"id":"publish-post"}],"phases":[]}'),
    ).toBe(true);
  });

  it("SHOWS for malformed JSON", () => {
    expect(tabHiddenFor('{"schemaVersion": 1, "actions": [')).toBe(false);
  });

  it("SHOWS for a truncated file", () => {
    expect(tabHiddenFor('{"schemaVersion": 1, "act')).toBe(false);
  });

  it("SHOWS for an empty file", () => {
    expect(tabHiddenFor("")).toBe(false);
  });

  /*
   * The regression. MEASURED before the fix: both of these HID the tab. The
   * loader reports `fromUser: true` with zero diagnostics — `JSON.parse`
   * succeeded and `checkContractVersion` only warns — so the wrong shape looked
   * exactly like a valid catalog to every gate downstream.
   */
  it("SHOWS for valid JSON whose actions carry no id", () => {
    expect(
      tabHiddenFor('{"schemaVersion":1,"actions":[{"foo":"bar"}],"phases":[]}'),
    ).toBe(false);
  });

  it("SHOWS for valid JSON whose action id is null", () => {
    expect(
      tabHiddenFor('{"schemaVersion":1,"actions":[{"id":null}],"phases":[]}'),
    ).toBe(false);
  });

  it("SHOWS for a JSON array at the top level (right syntax, wrong document)", () => {
    expect(tabHiddenFor('[{"id":"publish-post"}]')).toBe(false);
  });

  it("SHOWS for a JSON scalar", () => {
    expect(tabHiddenFor('"actions"')).toBe(false);
  });

  it("SHOWS for an empty actions array", () => {
    expect(tabHiddenFor('{"schemaVersion":1,"actions":[],"phases":[]}')).toBe(false);
  });

  it("SHOWS when a builtin id sits alongside a custom one (dual mode)", () => {
    expect(
      tabHiddenFor(
        '{"schemaVersion":1,"actions":[{"id":"publish-post"},{"id":"new-iterate"}],"phases":[]}',
      ),
    ).toBe(false);
  });

  it("SHOWS when the project ALSO has a valid SDLC run-config (dual mode)", () => {
    const root = projectWith('{"schemaVersion":1,"actions":[{"id":"publish-post"}],"phases":[]}');
    const d = detectScenario(inputs({ actions: factsFor(root), hasValidRunConfig: true }));
    expect(d.missionTabVisible).toBe(true);
  });

  it("SHOWS when the actions file is a DIRECTORY (unreadable, not absent)", () => {
    const root = mkdtempSync(path.join(tmpdir(), "s3-actions-"));
    roots.push(root);
    mkdirSync(path.join(root, ".shipwright-webui", "actions.json"), { recursive: true });
    clearActionsCache();
    expect(detectScenario(inputs({ actions: factsFor(root) })).missionTabVisible).toBe(true);
  });
});
