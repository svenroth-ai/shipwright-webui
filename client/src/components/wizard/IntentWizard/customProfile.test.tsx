/*
 * @covers FR-01.75
 * Own-stack-profile flow in the New door.
 * With profiles of their own the user gets ONE extra question; choosing one
 * decides the stack, so "remember" / "where" are not asked; the launch request
 * carries that profile. Without own profiles nothing changes (four questions).
 */

import { describe, it, expect, afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

import { INITIAL_STATE, planStep, wizardReducer } from "./wizardState";
import { activeQuestions } from "./stubData";
import { buildNewLaunchRequest, resolveStackProfile } from "./contract";
import type { WizardState } from "./types";

afterEach(() => cleanup());

const mine = { name: "my-stack", description: "Mine", valid: true, error: null };
const start = (profiles = [mine]): WizardState =>
  wizardReducer(
    wizardReducer({ ...INITIAL_STATE }, { t: "pickDoor", door: "new" }),
    { t: "setCustomProfiles", profiles },
  );

const keys = (s: WizardState) => activeQuestions(s).map((q) => q.k);

describe("activeQuestions", () => {
  it("is exactly the classic four when the user has no own profiles", () => {
    const s = start([]);
    expect(keys(s)).toEqual(["brief", "who", "remember", "where"]);
    expect(planStep(s)).toBe(5);
  });

  it("inserts the stack question after the brief when own profiles exist", () => {
    const s = start();
    expect(keys(s)).toEqual(["brief", "profile", "who", "remember", "where"]);
    expect(planStep(s)).toBe(6);
  });

  it("drops remember/where once an own profile is chosen, and restores them when unchosen", () => {
    let s = wizardReducer(start(), { t: "setProfile", name: "my-stack" });
    expect(keys(s)).toEqual(["brief", "profile", "who"]);
    expect(planStep(s)).toBe(4);
    s = wizardReducer(s, { t: "setProfile", name: null });
    expect(keys(s)).toEqual(["brief", "profile", "who", "remember", "where"]);
    expect(s.answers.profile).toBeUndefined();
  });
});

describe("reducer", () => {
  it("walks brief → stack → who → plan with an own profile", () => {
    let s = wizardReducer(start(), { t: "setProfile", name: "my-stack" });
    s = { ...s, step: 3 }; // on "who"
    s = wizardReducer(s, { t: "next" });
    expect(s.step).toBe(planStep(s));
  });

  it("ignores a late profile list once the questions have started (step numbers would shift)", () => {
    let s = wizardReducer({ ...INITIAL_STATE }, { t: "pickDoor", door: "new" });
    s = { ...s, step: 3 };
    expect(wizardReducer(s, { t: "setCustomProfiles", profiles: [mine] }).customProfiles).toEqual([]);
  });
});

describe("launch request", () => {
  const answers = { brief: "A yoga tool", who: "Just me", profile: "my-stack" };

  it("resolves to the own profile, no Supabase env note", () => {
    expect(resolveStackProfile({ ...answers, remember: "Yes", where: "On the web" })).toEqual({
      profile: "my-stack",
      note: "your own stack profile",
      envVarsRequired: false,
    });
  });

  it("hands the profile to /shipwright-run and does not claim answers it never asked", () => {
    const req = buildNewLaunchRequest(answers, { name: "yoga", path: "C:\\dev\\yoga" });
    expect(req.profile).toBe("my-stack");
    expect(req.brief).toContain("Stack profile: my-stack");
    expect(req.brief).not.toContain("Saves data");
    expect(req.brief).not.toContain("Runs:");
  });
});

describe("back to the door picker", () => {
  it("keeps the fetched profile list (the fetch effect will not re-fire)", () => {
    let s = start();
    s = wizardReducer(s, { t: "back" }); // step 1 → picker
    expect(s.door).toBeNull();
    expect(s.customProfiles).toEqual([mine]);
    s = wizardReducer(s, { t: "pickDoor", door: "new" });
    expect(keys(s)).toContain("profile");
  });
});

describe("a chosen profile that disappears", () => {
  // @covers FR-01.75
  it("is dropped when a fresh list no longer offers it, even after the questions started", () => {
    let s = wizardReducer(start(), { t: "setProfile", name: "my-stack" });
    s = { ...s, step: 3 };
    const after = wizardReducer(s, { t: "setCustomProfiles", profiles: [] });
    expect(after.answers.profile).toBeUndefined();
    expect(resolveStackProfile(after.answers).profile).not.toBe("my-stack");
  });

  // @covers FR-01.75
  it("is dropped when the same profile turns invalid, and kept while it stays valid", () => {
    let s = { ...wizardReducer(start(), { t: "setProfile", name: "my-stack" }), step: 3 };
    expect(wizardReducer(s, { t: "setCustomProfiles", profiles: [mine] }).answers.profile).toBe("my-stack");
    s = wizardReducer(s, { t: "setCustomProfiles", profiles: [{ ...mine, valid: false, error: "bad" }] });
    expect(s.answers.profile).toBeUndefined();
  });
});

describe("refreshed list keeps the question positions", () => {
  // @covers FR-01.75
  it("marks a vanished profile unusable instead of removing the entry, and refuses re-picking it", () => {
    let s = { ...wizardReducer(start(), { t: "setProfile", name: "my-stack" }), step: 3 };
    s = wizardReducer(s, { t: "setCustomProfiles", profiles: [] });
    expect(s.customProfiles).toHaveLength(1);
    expect(s.customProfiles[0].valid).toBe(false);
    expect(keys(s)).toContain("profile");
    expect(wizardReducer(s, { t: "setProfile", name: "my-stack" }).answers.profile).toBeUndefined();
  });
});
