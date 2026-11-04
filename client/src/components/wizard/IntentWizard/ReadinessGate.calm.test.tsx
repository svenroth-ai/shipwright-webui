/**
 * Readiness banner calm-down: Codex CLI is optional (info, never an alert) and
 * Standalone view needs neither Shipwright plugins nor the plugin cache.
 * @covers FR-01.51
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ReadinessGate } from "./ReadinessGate";
import { readyWithoutPlugins, type ReadinessState } from "./useReadiness";
import type { ReadinessReport } from "./types";

const chk = (key: string, ok: boolean, critical: boolean, extra = {}) => ({
  key,
  label: key,
  ok,
  detail: ok ? "ok" : "missing",
  why: "",
  critical,
  ...extra,
});

const report: ReadinessReport = {
  ready: false,
  repairCommand: "npx @svenroth-ai/shipwright@latest",
  checks: [
    chk("claude", true, false),
    chk("codex", false, false, { hint: "install codex" }),
    chk("plugins", false, true),
    chk("cache", false, true),
    chk("uv", true, true),
  ],
} as ReadinessReport;

const state = (over: Partial<ReadinessState> = {}): ReadinessState => ({
  report,
  ready: false,
  loading: false,
  error: false,
  ...over,
});

describe("ReadinessGate calm", () => {
  it("shows Codex as an info note, not an alert row", () => {
    render(<ReadinessGate state={state()} />);
    expect(screen.queryByTestId("readiness-missing-codex")).toBeNull();
    expect(screen.getByTestId("readiness-info-codex")).toBeTruthy();
    expect(screen.getByTestId("readiness-missing-plugins")).toBeTruthy();
  });

  it("standalone hides plugins/cache rows and the npx repair command", () => {
    render(<ReadinessGate state={state({ standalone: true })} />);
    expect(screen.queryByTestId("readiness-missing-plugins")).toBeNull();
    expect(screen.queryByTestId("readiness-missing-cache")).toBeNull();
    expect(screen.queryByTestId("readiness-repair-command")).toBeNull();
  });

  it("readyWithoutPlugins ignores plugins/cache but still needs an engine", () => {
    expect(readyWithoutPlugins(report)).toBe(true);
    const noEngine = {
      ...report,
      checks: report.checks.map((c) => (c.key === "claude" ? { ...c, ok: false } : c)),
    } as ReadinessReport;
    expect(readyWithoutPlugins(noEngine)).toBe(false);
    expect(readyWithoutPlugins(undefined)).toBe(false);
  });
});
