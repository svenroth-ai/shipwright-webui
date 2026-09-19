/*
 * parse-body.codex-model.test.ts —
 * iterate-2026-09-17-codex-model-tier-parameterization, revised 2026-09-18
 * after shipwright#771: the closed-enum catalog check was withdrawn in
 * favor of the same syntactic-allowlist posture #771 established for
 * `codex_review`/`codex_plan_review` (no live-catalog dependency).
 *
 * parseLaunchBody had no dedicated unit test file (only exercised
 * indirectly via routes.launch-resume-autonomy.test.ts); a small standalone
 * file is cleaner than growing that route-level harness for one new field.
 */
import { describe, expect, it } from "vitest";

import { parseLaunchBody } from "./parse-body.js";
import type { ExternalTask } from "../../core/sdk-sessions-store.js";

function makeTask(over: Partial<ExternalTask> = {}): ExternalTask {
  return {
    taskId: "t1",
    sessionUuid: "uuid-1",
    cwd: "/tmp/proj",
    pluginDirs: [],
    state: "draft",
    title: "T",
    projectId: "proj-1",
    runtime: "codex",
    createdAt: "2026-01-01T00:00:00Z",
    inbox: { pendingToolUseIds: [], dismissedToolUseIds: [], lastProcessedByteOffset: 0 },
    ...over,
  };
}

describe("parseLaunchBody — codexImplementationModel", () => {
  it("absent body field → undefined, no error", () => {
    const result = parseLaunchBody({}, makeTask());
    expect("error" in result).toBe(false);
    if (!("error" in result)) {
      expect(result.codexImplementationModel).toBeUndefined();
    }
  });

  it.each([
    "gpt-5.6-luna",
    "gpt-5.6-terra",
    "gpt-5-codex",
    "a",
    "custom_model-v2.1",
    "A".repeat(64),
  ])("a syntactically valid slug %s parses through", (slug) => {
    const result = parseLaunchBody({ codexImplementationModel: slug }, makeTask());
    expect("error" in result).toBe(false);
    if (!("error" in result)) {
      expect(result.codexImplementationModel).toBe(slug);
    }
  });

  it("trims incidental whitespace before validating and storing", () => {
    const result = parseLaunchBody(
      { codexImplementationModel: "  gpt-5.6-luna  " },
      makeTask(),
    );
    expect("error" in result).toBe(false);
    if (!("error" in result)) {
      expect(result.codexImplementationModel).toBe("gpt-5.6-luna");
    }
  });

  it.each([
    ["", "empty string"],
    [".leading-dot", "leading dot (must start alnum)"],
    ["-leading-dash", "leading dash (must start alnum)"],
    ["has space", "embedded space"],
    ["has/slash", "embedded slash"],
    ["has;semicolon", "shell metacharacter"],
    ['a";x="y', 'embedded double-quote (the -c model="<slug>" boundary char)'],
    ["a\\x", "embedded backslash"],
    ["A".repeat(65), "over the 64-char cap"],
  ])("rejects %s (%s) with 400, never silently dropped", (slug) => {
    const result = parseLaunchBody({ codexImplementationModel: slug }, makeTask());
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.status).toBe(400);
      expect(result.error.error).toBe("invalid_codex_implementation_model");
    }
  });

  it("a non-string value fails closed with 400", () => {
    const result = parseLaunchBody({ codexImplementationModel: 42 }, makeTask());
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.status).toBe(400);
    }
  });

  it("has no once-set-always-used task fallback — absent body field never resurrects a prior value", () => {
    // Unlike actionId/phase/description/autonomy, this field is body-only —
    // there is no ExternalTask field to fall back to (the override is never
    // persisted). Omitting it from the body must yield undefined even for
    // a task otherwise fully populated.
    const result = parseLaunchBody({}, makeTask({ runtime: "codex" }));
    expect("error" in result).toBe(false);
    if (!("error" in result)) {
      expect(result.codexImplementationModel).toBeUndefined();
    }
  });
});
