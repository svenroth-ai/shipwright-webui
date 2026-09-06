/*
 * external/launch/claim-permission-perimeter-assert.ts — FR-04.22 Stage-3
 * doubt-review follow-up (iterate-2026-09-06-claim-launch-permission-perimeter).
 *
 * `claimAuthorized` is threaded, opt-in, into only two of the six
 * launch-precedence branches (action-substitution, legacy-fallback) because
 * those are the only ones a `{ claimToken }`-only body can structurally
 * reach today. That is an assumption about the CALLING daemon's current
 * body shape, not a code-enforced invariant — a future body that combines a
 * valid `claimToken` with `phaseTaskRef` / `campaignSlug` / `campaignStep` /
 * `masterRun` would dispatch to one of the four branches that never learned
 * about claims and get back a fully unrestricted command while still
 * holding a valid claim.
 *
 * This is the centralized backstop: regardless of which branch produced
 * `commands`, a claim-authorized launch must show the permission perimeter
 * on every shell form or the request is refused (409) — never silently
 * downgraded.
 */

import type { CopyCommandForms } from "../../core/launcher.js";

export function commandsCarryPermissionPerimeter(
  commands: CopyCommandForms,
): boolean {
  return (Object.keys(commands) as Array<keyof CopyCommandForms>).every(
    (shellForm) =>
      commands[shellForm].includes("--tools") &&
      commands[shellForm].includes("--permission-mode"),
  );
}
