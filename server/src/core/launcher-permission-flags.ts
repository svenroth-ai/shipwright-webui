/*
 * core/launcher-permission-flags.ts — FR-04.22 permission-perimeter argv
 * rendering, split out of launcher.ts purely to keep that file under the
 * repo's 300-line guideline (no behavior change from the split itself).
 *
 * See `external/launch/claim-executor-permissions.ts` for WHY this exists
 * and the empirical CLI evidence behind the `--tools` + `--permission-mode`
 * combination.
 */

/** Narrowest slice of `launcher.ts`'s own `Argv` this module needs. */
export interface PermissionPerimeterArgv {
  toolsAllowlist: readonly string[];
  permissionMode?: string;
}

/**
 * Emits `--tools <comma-list>` and `--permission-mode <mode>` when
 * `toolsAllowlist` is non-empty. Both flags or neither: a `permissionMode`
 * without a `toolsAllowlist` would leave the process's full default toolset
 * pre-approved-without-asking, the exact "looks compliant, isn't" shape
 * this perimeter exists to prevent — so `permissionMode` is only ever
 * emitted alongside a real allow-list. Emits nothing for an ordinary launch
 * (`toolsAllowlist` empty/absent), which is why a manual launch's command
 * string is unchanged byte-for-byte.
 */
export function appendPermissionPerimeter(
  a: PermissionPerimeterArgv,
  parts: string[],
  q: (v: string) => string,
): void {
  if (a.toolsAllowlist.length === 0) return;
  parts.push("--tools", q(a.toolsAllowlist.join(",")));
  if (a.permissionMode) parts.push("--permission-mode", q(a.permissionMode));
}
