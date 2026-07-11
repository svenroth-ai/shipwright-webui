import type { ProfileConfig } from "./profile-loader.js";

/**
 * Preview-capability coherence predicate + warn matrix (plan § 2.1).
 *
 * Extracted out of `index.ts`'s `isMainModule` boot IIFE so the frontend
 * predicate and the warn matrix are unit-testable without a live server
 * boot (that block never executes under Vitest) and so `index.ts` stays
 * off its bloat baseline. `index.ts` still owns the iteration + the
 * `console.warn` side effect — the two functions here are pure.
 *
 * Used by:
 *   - index.ts § "Section 03 — boot-time profile coherence check".
 */

/**
 * Preview-capability precedence (CLAUDE.md § "Preview-capability
 * precedence") Step 1 — does this profile DECLARE a frontend stack?
 *
 * A profile counts as frontend-declared only when `stack.frontend` is a
 * NON-EMPTY object (or a truthy non-object value). The bundled
 * `python-plugin-monorepo` profile intentionally ships
 * `stack.frontend: {}` alongside `dev_server: null` — a backend-only
 * stack by design. Plain `Boolean({})` is `true`, which made the
 * boot-time coherence check emit a spurious "preview misconfigured"
 * warning on EVERY boot for such projects (F32). Treating an empty
 * object as backend-only keeps the diagnostic honest and the
 * PreviewButton gate coherent. Non-object values keep the pre-fix
 * `Boolean(...)` semantics (this narrows ONLY the empty-object case),
 * and the `typeof === "object"` guard is TypeError-safe for any stray
 * primitive.
 */
export function profileDeclaresFrontend(frontend: unknown): boolean {
  if (frontend == null) return false;
  if (typeof frontend !== "object") return Boolean(frontend);
  return Object.keys(frontend as Record<string, unknown>).length > 0;
}

/**
 * The narrow slice of a resolved profile the coherence check reads.
 * `dev_server` is `| null` because the bundled backend-only profiles ship
 * `"dev_server": null` in their JSON (e.g. python-plugin-monorepo).
 */
export type PreviewCoherenceProfile = {
  stack?: { frontend?: unknown };
  dev_server?: ProfileConfig["dev_server"] | null;
};

/** Warn envelope emitted (as a JSON string) for an incoherent profile. */
export interface PreviewCoherenceWarning {
  level: "warn";
  message: string;
  projectId: string;
  profile: string;
}

/**
 * Pure evaluation of the preview coherence matrix for a single resolved
 * profile. Returns a warning envelope when the profile's frontend
 * declaration and dev_server wiring disagree, or `null` when they are
 * coherent — including an intentionally backend-only stack
 * (`stack.frontend: {}` + `dev_server: null`, F32). The caller owns the
 * `console.warn` side effect.
 */
export function evaluatePreviewCoherence(
  projectId: string,
  profile: string,
  prof: PreviewCoherenceProfile,
): PreviewCoherenceWarning | null {
  const hasFrontend = profileDeclaresFrontend(prof.stack?.frontend);
  const hasDevServer = Boolean(prof.dev_server?.command);
  if (hasFrontend && !hasDevServer) {
    return {
      level: "warn",
      message:
        "profile declares stack.frontend but no dev_server.command — preview button will stay hidden",
      projectId,
      profile,
    };
  }
  if (!hasFrontend && hasDevServer) {
    return {
      level: "warn",
      message:
        "profile has dev_server.command but no stack.frontend — preview gate denies regardless (ADR-036)",
      projectId,
      profile,
    };
  }
  return null;
}
