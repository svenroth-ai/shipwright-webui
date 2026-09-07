/*
 * external-routes-wiring.test.ts — CI diff-coverage gap fix (Diff coverage
 * gate, iterate-2026-09-07-leadwright-setup-wizard): the args-construction
 * factory extracted from index.ts (bloat-ceiling split) had zero direct
 * coverage — only exercised transitively by booting the whole server.
 */
import { describe, it, expect, vi } from "vitest";

import { buildExternalRoutesArgs } from "./external-routes-wiring.js";
import type { ExternalRoutesWiringDeps } from "./external-routes-wiring.js";
import type { ProjectManager } from "./core/project-manager.js";
import type { ServerConfig } from "./config.js";

function deps(overrides: Partial<ExternalRoutesWiringDeps> = {}): ExternalRoutesWiringDeps {
  const projectManager = {
    getAll: () => [
      { id: "p1", synthesized: false },
      { id: "unassigned", synthesized: true },
    ],
    getById: (id: string) => {
      if (id === "p1") {
        return {
          id: "p1",
          name: "Project One",
          path: "/abs/p1",
          profile: "node",
          synthesized: false,
          settings: { color: "blue", other: "dropped" },
        };
      }
      if (id === "unassigned") {
        return { id: "unassigned", name: "Unassigned", path: "/abs/u", synthesized: true };
      }
      return undefined;
    },
  } as unknown as ProjectManager;

  const ptyManager = {
    get: vi.fn().mockReturnValue("pty-1"),
    kill: vi.fn(),
    peekTerminalText: vi.fn().mockReturnValue("hello"),
  };

  return {
    sdkSessionsStore: { marker: "store" } as never,
    sessionWatcher: { marker: "watcher" } as never,
    projectManager,
    previewManager: { marker: "preview" } as never,
    scrollbackStore: { clearBestEffort: vi.fn() } as never,
    snapshotStore: { clearBestEffort: vi.fn() } as never,
    ptyManager: ptyManager as never,
    honoHost: "localhost",
    config: {
      leadsRoot: "/abs/leads",
      leadsRouteSecret: "secret",
      leadwrightCheckoutRoot: "/abs/leadwright",
    } as unknown as ServerConfig,
    ...overrides,
  };
}

describe("buildExternalRoutesArgs", () => {
  it("passes store, watcher, previewManager and honoHost through unchanged", () => {
    const d = deps();
    const args = buildExternalRoutesArgs(d);
    expect(args.store).toBe(d.sdkSessionsStore);
    expect(args.watcher).toBe(d.sessionWatcher);
    expect(args.previewManager).toBe(d.previewManager);
    expect(args.honoHost).toBe("localhost");
  });

  it("getKnownProjectIds excludes the synthesized row", () => {
    const args = buildExternalRoutesArgs(deps());
    expect(args.getKnownProjectIds()).toEqual(new Set(["p1"]));
  });

  it("getProjectById returns a trimmed view (only settings.color) and skips synthesized rows", () => {
    const args = buildExternalRoutesArgs(deps());
    const view = args.getProjectById!("p1");
    expect(view).toEqual({
      id: "p1",
      name: "Project One",
      path: "/abs/p1",
      profile: "node",
      synthesized: false,
      settings: { color: "blue" },
    });
    expect(args.getProjectById!("unassigned")).toBeUndefined();
    expect(args.getProjectById!("nope")).toBeUndefined();
  });

  it("scrollbackClearBestEffort / snapshotClearBestEffort delegate to the stores", () => {
    const d = deps();
    const args = buildExternalRoutesArgs(d);
    args.scrollbackClearBestEffort!("t1");
    args.snapshotClearBestEffort!("t1");
    expect((d.scrollbackStore as unknown as { clearBestEffort: ReturnType<typeof vi.fn> }).clearBestEffort).toHaveBeenCalledWith("t1");
    expect((d.snapshotStore as unknown as { clearBestEffort: ReturnType<typeof vi.fn> }).clearBestEffort).toHaveBeenCalledWith("t1");
  });

  it("wraps ptyManager to expose only get/kill/peekTerminalText", () => {
    const d = deps();
    const args = buildExternalRoutesArgs(d);
    expect(args.ptyManager.get("t1")).toBe("pty-1");
    expect(args.ptyManager.peekTerminalText!("t1")).toBe("hello");
    args.ptyManager.kill!("t1");
    expect((d.ptyManager as unknown as { kill: ReturnType<typeof vi.fn> }).kill).toHaveBeenCalledWith("t1");
  });

  it("carries leadsRoot / leadsRouteSecret / leadwrightCheckoutRoot from config, and a webuiBaseUrl", () => {
    const args = buildExternalRoutesArgs(deps());
    expect(args.leadsRoot).toBe("/abs/leads");
    expect(args.leadsRouteSecret).toBe("secret");
    expect(args.leadwrightCheckoutRoot).toBe("/abs/leadwright");
    expect(args.webuiBaseUrl).toMatch(/^http:\/\/localhost:\d+$/);
  });
});
