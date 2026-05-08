/*
 * GET /api/diagnostics — external-launch health + version gate.
 *
 * Exposes the CLI version + supported-range, number of tracked sessions,
 * last-scan timestamp (set by the heartbeat probe), and per-launcher
 * availability (Copy is always available; Terminal/VSCode/Desktop are
 * explicitly labeled as v2+).
 *
 * Round-3 plan integration: UI's Diagnostics page reads this and surfaces
 * a persistent banner when the installed CLI is out-of-range.
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

import { Hono } from "hono";

import { MIN_SUPPORTED_CLI, type ClaudeVersionInfo } from "../core/cli-compat.js";
import { SdkSessionsStore } from "../core/sdk-sessions-store.js";

export interface ClaudeCliDiagnostic {
  /** Stdout of `where claude` / `which claude`, trimmed. Empty if cmd failed. */
  whereOutput: string;
  /** First N entries of process.env.PATH (newline-/colon-/semi-split). Bounded. */
  pathSample: string[];
  /** Curated fallback paths the resolver checked when PATH lookup was empty. */
  checkedFallbacks: string[];
}

export interface DiagnosticsSnapshot {
  claudeCli: {
    raw: string;
    parsed: ClaudeVersionInfo["parsed"];
    supported: boolean;
    minSupported: string;
    /**
     * iterate-2026-05-08 v0.8.8 AC-4 — present ONLY when supported=false.
     * Empowers operators to self-diagnose "why isn't my CLI being found?"
     * without reading the server log. The block surfaces the primary
     * `where`/`which` output, a sample of the server's PATH, and the
     * curated fallback paths the resolver would have checked.
     */
    diagnostic?: ClaudeCliDiagnostic;
  };
  sessions: {
    total: number;
    byState: Record<string, number>;
  };
  launchers: {
    copy: { available: true };
    terminal: { available: false; reason: "deferred to v2 (variant-a narrow)" };
    vscode: { available: false; reason: "deferred to v2 (variant-a narrow)" };
    desktop: { available: false; reason: "awaiting Claude Desktop URL scheme" };
  };
}

const PATH_SAMPLE_LIMIT = 8;

function buildClaudeCliDiagnostic(): ClaudeCliDiagnostic {
  const isWin = process.platform === "win32";
  const lookup = isWin ? "where" : "which";
  let whereOutput = "";
  try {
    const r = spawnSync(lookup, ["claude"], { encoding: "utf-8", shell: false });
    whereOutput = ((r.stdout ?? "") as string).trim();
  } catch {
    whereOutput = "";
  }
  const sep = isWin ? ";" : ":";
  const pathRaw = process.env.PATH ?? "";
  const pathEntries = pathRaw.length > 0 ? pathRaw.split(sep) : [];
  const pathSample = pathEntries.slice(0, PATH_SAMPLE_LIMIT);
  const checkedFallbacks: string[] = [];
  if (isWin) {
    const userProfile = process.env.USERPROFILE ?? "";
    const appData = process.env.APPDATA ?? "";
    const localAppData = process.env.LOCALAPPDATA ?? "";
    const programFiles = process.env.ProgramFiles ?? "";
    if (userProfile) {
      checkedFallbacks.push(path.join(userProfile, ".local", "bin", "claude.exe"));
      checkedFallbacks.push(path.join(userProfile, ".local", "bin", "claude.cmd"));
    }
    if (appData) {
      checkedFallbacks.push(path.join(appData, "npm", "claude.cmd"));
      checkedFallbacks.push(path.join(appData, "npm", "claude.exe"));
    }
    if (localAppData) {
      checkedFallbacks.push(
        path.join(localAppData, "Microsoft", "WinGet", "Links", "claude.exe"),
      );
    }
    if (programFiles) {
      checkedFallbacks.push(path.join(programFiles, "Claude Code", "claude.exe"));
    }
  } else {
    const home = process.env.HOME ?? "";
    if (home) {
      checkedFallbacks.push(path.posix.join(home, ".local", "bin", "claude"));
      checkedFallbacks.push(path.posix.join(home, ".npm-global", "bin", "claude"));
    }
    checkedFallbacks.push("/usr/local/bin/claude");
    checkedFallbacks.push("/opt/homebrew/bin/claude");
  }
  // Annotate which candidates exist on disk — the operator immediately
  // sees "this one exists but PATH lookup didn't find it" vs "none of
  // the curated paths exist".
  const annotated = checkedFallbacks.map((p) => `${p} (${existsSync(p) ? "exists" : "missing"})`);
  return { whereOutput, pathSample, checkedFallbacks: annotated };
}

export function createDiagnosticsRoutes(args: {
  store: SdkSessionsStore;
  versionInfo: () => ClaudeVersionInfo;
}) {
  const app = new Hono();

  app.get("/api/diagnostics", (c) => {
    const v = args.versionInfo();
    const tasks = args.store.list();
    const byState: Record<string, number> = {};
    for (const t of tasks) {
      byState[t.state] = (byState[t.state] ?? 0) + 1;
    }
    const claudeCli: DiagnosticsSnapshot["claudeCli"] = {
      raw: v.raw,
      parsed: v.parsed,
      supported: v.supported,
      minSupported: MIN_SUPPORTED_CLI,
    };
    if (!v.supported) {
      claudeCli.diagnostic = buildClaudeCliDiagnostic();
    }
    const snapshot: DiagnosticsSnapshot = {
      claudeCli,
      sessions: {
        total: tasks.length,
        byState,
      },
      launchers: {
        copy: { available: true },
        terminal: { available: false, reason: "deferred to v2 (variant-a narrow)" },
        vscode: { available: false, reason: "deferred to v2 (variant-a narrow)" },
        desktop: { available: false, reason: "awaiting Claude Desktop URL scheme" },
      },
    };
    return c.json(snapshot);
  });

  return app;
}
