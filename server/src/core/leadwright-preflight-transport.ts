/*
 * leadwright-preflight-transport.ts — spawns leadwright's
 * `scripts/check-setup.ts --stdin --json` and returns its verdict.
 * (iterate-2026-09-07-leadwright-setup-wizard, W14).
 *
 * "The transport is a subprocess, not a re-implementation. Never re-type a
 * shape, never compute a verdict here." This module does none of leadwright's
 * validation — it only gets a proposal there and a result back, faithfully.
 *
 * Fail-closed signal (correction 4, verified against leadwright origin/main
 * @ 43fcd492's scripts/check-setup.ts): stdout parses as {ok, findings} ⇒
 * ranOk:true, REGARDLESS of exit code (exit 1 with a parseable result is a
 * legitimate red verdict). stdout empty/unparsable ⇒ ranOk:false — this,
 * not the exit code, is "leadwright not reachable".
 *
 * Reuses the existing Windows-safe spawn resolver (core/win32-spawn.ts) —
 * the same one preview-session-manager.ts already uses — rather than a
 * second spawn primitive.
 */
import { spawn as realSpawn, type ChildProcess } from "node:child_process";
import path from "node:path";

import { resolveSpawn as realResolveSpawn, type ResolvedSpawn } from "./win32-spawn.js";
import type { PreflightResult, PreflightStdinInput } from "../types/leadwright-preflight.js";

export type LeadwrightTransportResult =
  | { ranOk: true; result: PreflightResult }
  | { ranOk: false; reason: string };

export interface RunLeadwrightPreflightOptions {
  /** Injected for tests. */
  spawn?: typeof realSpawn;
  /** Injected for tests. */
  resolveSpawnFn?: (argv: string[], cwd: string) => ResolvedSpawn | null;
  /** Wall-clock deadline for the ENTIRE call, independent of the CLI's own
   *  30s stdin-read timeout — bounds a child that hangs after receiving
   *  stdin (e.g. stalled on filesystem I/O). Default: 45s. */
  timeoutMs?: number;
  /** Caps total collected stdout+stderr bytes; exceeding it kills the
   *  child rather than parsing a truncated/misleading partial result.
   *  Default: 10 MiB (generous — a real PreflightResult with dozens of
   *  findings is a few KB). */
  maxOutputBytes?: number;
}

const DEFAULT_TIMEOUT_MS = 45_000;
const DEFAULT_MAX_OUTPUT_BYTES = 10 * 1024 * 1024;

function looksLikePreflightResult(value: unknown): value is PreflightResult {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { ok?: unknown }).ok === "boolean" &&
    Array.isArray((value as { findings?: unknown }).findings)
  );
}

export function runLeadwrightPreflight(
  checkoutRoot: string,
  proposal: PreflightStdinInput,
  options: RunLeadwrightPreflightOptions = {},
): Promise<LeadwrightTransportResult> {
  const spawnFn = options.spawn ?? realSpawn;
  const resolveSpawnFn = options.resolveSpawnFn ?? realResolveSpawn;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;

  const argv = [
    path.join(checkoutRoot, "node_modules", ".bin", "tsx"),
    path.join(checkoutRoot, "scripts", "check-setup.ts"),
    "--stdin",
    "--json",
  ];

  const resolved = resolveSpawnFn(argv, checkoutRoot);
  if (resolved === null) {
    return Promise.resolve({
      ranOk: false,
      reason: `tsx not found under the configured leadwright checkout (${checkoutRoot}) — check SHIPWRIGHT_LEADWRIGHT_CHECKOUT and that dependencies are installed there`,
    });
  }

  return new Promise((resolvePromise) => {
    let settled = false;
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let stdoutText = "";
    let stderrText = "";
    let outputCapExceeded = false;

    const child: ChildProcess = spawnFn(resolved.command, resolved.args, {
      cwd: checkoutRoot,
      stdio: "pipe",
      windowsVerbatimArguments: resolved.windowsVerbatimArguments,
    });

    const timer = setTimeout(() => {
      finish({ ranOk: false, reason: `leadwright check-setup timed out after ${timeoutMs}ms` });
      child.kill();
    }, timeoutMs);

    function finish(result: LeadwrightTransportResult): void {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolvePromise(result);
    }

    child.on("error", (err) => {
      finish({ ranOk: false, reason: `could not spawn leadwright check-setup: ${err.message}` });
    });

    child.stdin?.on("error", () => {
      // EPIPE etc. — the eventual 'close' (or the timeout) is the source of
      // truth for the final result; a stdin write failure alone must not
      // resolve early with a misleading partial state.
    });

    child.stdout?.on("data", (chunk: Buffer) => {
      stdoutBytes += chunk.length;
      stdoutText += chunk.toString("utf-8");
      if (stdoutBytes + stderrBytes > maxOutputBytes && !outputCapExceeded) {
        outputCapExceeded = true;
        finish({ ranOk: false, reason: "leadwright check-setup produced more output than the configured cap — treated as a runaway process" });
        child.kill();
      }
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      stderrBytes += chunk.length;
      stderrText += chunk.toString("utf-8");
      if (stdoutBytes + stderrBytes > maxOutputBytes && !outputCapExceeded) {
        outputCapExceeded = true;
        finish({ ranOk: false, reason: "leadwright check-setup produced more output than the configured cap — treated as a runaway process" });
        child.kill();
      }
    });

    child.on("close", () => {
      if (outputCapExceeded) return; // already finished
      const trimmed = stdoutText.trim();
      if (trimmed === "") {
        finish({ ranOk: false, reason: stderrText.trim() || "leadwright check-setup produced no output" });
        return;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        finish({ ranOk: false, reason: stderrText.trim() || `leadwright check-setup produced unparsable output: ${trimmed.slice(0, 500)}` });
        return;
      }
      if (!looksLikePreflightResult(parsed)) {
        finish({ ranOk: false, reason: "leadwright check-setup produced output that does not match the published PreflightResult shape" });
        return;
      }
      finish({ ranOk: true, result: parsed });
    });

    child.stdin?.write(JSON.stringify(proposal));
    child.stdin?.end();
  });
}
