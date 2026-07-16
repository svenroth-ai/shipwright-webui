/*
 * IntentWizard data-contract tests (A09a, FR-01.52 — AC3/AC4/AC6).
 *
 * RED on pre-A09a main (contract.ts does not exist → the import fails), green
 * after. Everything imports the TYPED contract rather than re-declaring shapes
 * inline (AC4). The load-bearing assertion is AC3: every New/Adopt launch
 * payload carries BOTH an `actionId` AND the brief — the single thing whose
 * absence drops the flow onto the legacy empty-prompt path.
 */

import { describe, it, expect } from "vitest";

import {
  PROFILE_LOCAL,
  PROFILE_PERSISTENT,
  PROFILE_ADOPT,
  resolveStackProfile,
  buildNewLaunchRequest,
  buildAdoptLaunchRequest,
  deriveNewProjectName,
  deriveAdoptProjectName,
  toCreateProjectPayload,
  toCreateTaskPayload,
  toLaunchPayload,
  isTerminalLaunchState,
  type GradeRequest,
  type WizardLaunchState,
  type WizardCreateResponse,
} from "./contract";
import type { NewAnswers } from "./types";

describe("StackProfile / EnvVars mapping (AC1)", () => {
  it("remember=Yes → supabase-nextjs with the free-account note", () => {
    const r = resolveStackProfile({ remember: "Yes" });
    expect(r.profile).toBe(PROFILE_PERSISTENT);
    expect(r.note).toMatch(/supabase account/i);
  });

  it.each(["No", "Not sure yet", undefined])(
    "remember=%s → vite-hono (the zero-signup local default)",
    (remember) => {
      const r = resolveStackProfile({ remember: remember as string | undefined });
      expect(r.profile).toBe(PROFILE_LOCAL);
    },
  );

  it("EnvVars are required ONLY for web + remember", () => {
    expect(resolveStackProfile({ remember: "Yes", where: "On the web" }).envVarsRequired).toBe(true);
    // web but no persistence → nothing to configure
    expect(resolveStackProfile({ remember: "No", where: "On the web" }).envVarsRequired).toBe(false);
    // persistence but local → no deploy secrets yet
    expect(resolveStackProfile({ remember: "Yes", where: "Just on my machine" }).envVarsRequired).toBe(false);
    // neither
    expect(resolveStackProfile({ remember: "No", where: "Just on my machine" }).envVarsRequired).toBe(false);
  });
});

describe("New door request → payloads (AC3)", () => {
  const answers: NewAnswers = {
    brief: "A booking tool for my yoga studio",
    who: "Customers / public",
    remember: "No",
    where: "On the web",
  };

  it("builds a new-pipeline request carrying the brief", () => {
    const req = buildNewLaunchRequest(answers, { name: "yoga", path: "C:\\dev\\yoga" });
    expect(req.door).toBe("new");
    expect(req.actionId).toBe("new-pipeline");
    expect(req.brief).toContain("A booking tool for my yoga studio");
    expect(req.profile).toBe(PROFILE_LOCAL);
    expect(req.path).toBe("C:\\dev\\yoga");
  });

  it("the launch brief carries the FULL intake so the terminal doesn't re-ask (AC1)", () => {
    const req = buildNewLaunchRequest(answers, { name: "yoga", path: "C:\\dev\\yoga" });
    // idea + every answered question + the derived stack profile all reach
    // /shipwright-run as one brief (no wizard question asked twice).
    expect(req.brief).toContain("A booking tool for my yoga studio");
    expect(req.brief).toContain("Customers / public");
    expect(req.brief).toContain("On the web");
    expect(req.brief).toContain(PROFILE_LOCAL);
  });

  it("the task AND launch payloads BOTH carry actionId AND the brief (AC3)", () => {
    const req = buildNewLaunchRequest(answers, { name: "yoga", path: "C:\\dev\\yoga" });
    const task = toCreateTaskPayload(req, "proj-1", "C:\\dev\\yoga");
    const launch = toLaunchPayload(req);

    expect(task.actionId).toBe("new-pipeline");
    expect(task.description).toContain("A booking tool for my yoga studio");
    expect(task.phase).toBeUndefined(); // new-pipeline has no phase

    expect(launch.actionId).toBe("new-pipeline");
    expect(launch.description).toContain("A booking tool for my yoga studio");
    // The exact break AC3 guards: neither field may be empty/absent.
    expect(launch.actionId).toBeTruthy();
    expect(launch.description.length).toBeGreaterThan(0);
  });

  it("an empty brief is hardened to a non-empty prompt (never an empty /shipwright-run)", () => {
    const req = buildNewLaunchRequest({ brief: "   " }, { name: "", path: "C:\\x" });
    expect(req.brief.length).toBeGreaterThan(0);
    expect(req.name.length).toBeGreaterThan(0); // derived from the (defaulted) brief
    expect(toLaunchPayload(req).description.length).toBeGreaterThan(0);
  });

  it("remember=Yes flows supabase-nextjs into the project profile", () => {
    const req = buildNewLaunchRequest({ ...answers, remember: "Yes" }, { name: "y", path: "C:\\y" });
    expect(req.profile).toBe(PROFILE_PERSISTENT);
    expect(toCreateProjectPayload(req).profile).toBe(PROFILE_PERSISTENT);
  });
});

describe("Adopt door request → payloads (AC2/AC3)", () => {
  it("builds a new-task + adopt-phase request → /shipwright-adopt, brief present", () => {
    const req = buildAdoptLaunchRequest("C:\\work\\api-server");
    expect(req.door).toBe("adopt");
    expect(req.actionId).toBe("new-task");
    expect(req.phase).toBe("adopt");
    expect(req.phaseLabel).toBe("Adopt");
    expect(req.name).toBe("api-server");
    expect(req.profile).toBe(PROFILE_ADOPT);

    const task = toCreateTaskPayload(req, "proj-2", "C:\\work\\api-server");
    const launch = toLaunchPayload(req);
    // AC3 — actionId + brief on BOTH, plus the phase that routes to /shipwright-adopt.
    expect(task.actionId).toBe("new-task");
    expect(task.phase).toBe("adopt");
    expect(task.description.length).toBeGreaterThan(0);
    expect(launch.actionId).toBe("new-task");
    expect(launch.phase).toBe("adopt");
    expect(launch.phaseLabel).toBe("Adopt");
    expect(launch.description.length).toBeGreaterThan(0);
  });

  it("derives a name from a github-url target (grade → adopt handoff path)", () => {
    expect(deriveAdoptProjectName("github.com/acme/checkout")).toBe("checkout");
    expect(deriveAdoptProjectName("C:\\work\\api-server\\")).toBe("api-server");
  });
});

describe("name derivation", () => {
  it("slugs a free-text brief", () => {
    expect(deriveNewProjectName("A link shortener with stats")).toBe("a-link-shortener-with-stats");
    expect(deriveNewProjectName("!!!")).toBe("new-project");
  });
});

describe("launch state contract (A17 / A09b consumers)", () => {
  it("classifies terminal vs recoverable states", () => {
    expect(isTerminalLaunchState("launch-failed")).toBe(true);
    expect(isTerminalLaunchState("jsonl-missing")).toBe(true);
    expect(isTerminalLaunchState("permission-denied")).toBe(true);
    expect(isTerminalLaunchState("launching")).toBe(false);
    expect(isTerminalLaunchState("running")).toBe(false);
  });

  it("the create response + grade request shapes are exported for A09b to consume", () => {
    // Compile-time contract, exercised at runtime so the shape can't silently drift.
    const created: WizardCreateResponse = { projectId: "p", taskId: "t", sessionUuid: "u" };
    expect(created.taskId).toBe("t");
    const grade: GradeRequest = { door: "grade", target: "github.com/acme/x", isRemote: true, actionId: null };
    // Grade never carries an actionId — it is not a task launch (A09b server route).
    expect(grade.actionId).toBeNull();
    const s: WizardLaunchState = "idle";
    expect(s).toBe("idle");
  });
});
