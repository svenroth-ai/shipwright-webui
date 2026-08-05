/*
 * preview-win32-spawn.ts — the PREVIEW-facing face of the win32 spawn resolver.
 *
 * The resolution itself lives in `win32-spawn.ts` and is shared by three
 * consumer classes (preview dev-server spawn, the boot-time Claude version
 * probe, and — mirrored, not imported — the bootstrapper package). This module
 * adds exactly one thing on top: the preview subsystem's error type.
 *
 * WHY THE SPLIT (iterate-2026-08-01-win32-spawn-followups). `PreviewProfileInvalidError`
 * lives in `preview-session-manager.ts`, so ANY module that wants the throwing
 * form also pulls the preview subsystem into its import closure. That is how
 * `cli-compat.ts` — the BOOT path — became a MEMBER of the
 * preview-win32-spawn <-> preview-session-manager ESM cycle when PR #340 made it
 * a consumer of the resolver, which that PR recorded as a new fragility. Keeping
 * the throw HERE and the resolution THERE means only callers that actually want
 * a `PreviewProfileInvalidError` pay for the preview import. Note this file is
 * still IN that cycle, by design — it is the module that needs the error type.
 *
 * ADR-044 / DO-NOT #9 are untouched: the preview path still receives a THROW for
 * an unresolvable bare command (never a silent `cmd /d /s /c <bare>` delegation,
 * which would hand cmd.exe its own cwd-first lookup inside an untrusted repo).
 * The FROZEN guard `preview-win32-resolve.test.ts` — Guards 3-6 from security
 * review rounds 2-3 — imports `resolveSpawn` from THIS module and is unmodified
 * by that split; it passing verbatim is the proof the extraction preserved the
 * preview contract.
 */

import {
  resolveSpawn as resolveSpawnOrNull,
  type ResolvedSpawn,
} from "./win32-spawn.js";
// Intra-package import used only inside resolveSpawn's body (never at module
// load), so the preview-session-manager <-> this-module cycle is ESM-safe.
import { PreviewProfileInvalidError } from "./preview-session-manager.js";

export { splitWin32Command, type ResolvedSpawn } from "./win32-spawn.js";

/**
 * `win32-spawn.resolveSpawn` with the preview subsystem's failure mode: an
 * unresolvable BARE command is a profile error, not a `null`.
 *
 * Identical to the core resolver on every other input — asserted directly by
 * the core<->wrapper differential matrix in `win32-spawn.test.ts`.
 */
export function resolveSpawn(argv: string[], cwd: string): ResolvedSpawn {
  const plan = resolveSpawnOrNull(argv, cwd);
  if (plan) return plan;
  throw new PreviewProfileInvalidError(
    `dev_server.command not found on PATH: ${argv[0]}`,
  );
}
