/*
 * launcher-codextender.auth-token.test.ts — Codextender integration spec
 * Part B.2. Split out of launcher-codextender.test.ts (2026-09-26, bloat
 * anti-ratchet) so each file stays a single concern: `resolveCodextenderAuthToken`
 * env-var resolution is unrelated to `buildCodextenderCommands`'s command-string
 * assembly, which the sibling file still covers.
 */

import { describe, it, expect } from "vitest";

import { resolveCodextenderAuthToken } from "./launcher-codextender.js";

describe("resolveCodextenderAuthToken", () => {
  const ENV_KEY = "CODEXTENDER_AUTH_TOKEN";

  it("PR-review BLOCK (iterate-2026-09-23, second round) — returns undefined when unset, no built-in fallback", () => {
    const prior = process.env[ENV_KEY];
    delete process.env[ENV_KEY];
    try {
      expect(resolveCodextenderAuthToken()).toBeUndefined();
    } finally {
      if (prior !== undefined) process.env[ENV_KEY] = prior;
    }
  });

  it("returns a non-blank CODEXTENDER_AUTH_TOKEN env var verbatim", () => {
    const prior = process.env[ENV_KEY];
    process.env[ENV_KEY] = "custom-master-key";
    try {
      expect(resolveCodextenderAuthToken()).toBe("custom-master-key");
    } finally {
      if (prior === undefined) delete process.env[ENV_KEY];
      else process.env[ENV_KEY] = prior;
    }
  });

  it("treats a blank/whitespace env var as unset", () => {
    const prior = process.env[ENV_KEY];
    process.env[ENV_KEY] = "   ";
    try {
      expect(resolveCodextenderAuthToken()).toBeUndefined();
    } finally {
      if (prior === undefined) delete process.env[ENV_KEY];
      else process.env[ENV_KEY] = prior;
    }
  });
});
