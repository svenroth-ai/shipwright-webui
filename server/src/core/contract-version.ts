/**
 * Cross-repo contract version check.
 *
 * The WebUI reads JSON artefacts that are written by the Shipwright
 * plugins (a *different* repo once the split lands). To make silent
 * schema drift visible we stamp each cross-repo artefact with a
 * `contractVersion` / `schemaVersion` integer that the WebUI compares
 * against a library-side "known max".
 *
 * Intentionally fail-soft: an unknown-higher version logs a warning
 * and the caller proceeds. Failing the read would lock users out of
 * otherwise-functioning projects just because their plugin side is
 * newer than the observer — the opposite of what the WebUI should do.
 */

/**
 * Highest `contractVersion` this WebUI build knows how to read for
 * `shipwright_run_config.json`. Bump in lockstep with the plugin
 * writer (plugins/shipwright-project/scripts/write_run_config.py).
 */
export const RUN_CONFIG_CONTRACT_VERSION = 1;

/**
 * Highest `schemaVersion` this WebUI build knows how to read for
 * `<project>/.shipwright-webui/actions.json`.
 */
export const ACTIONS_SCHEMA_VERSION = 1;

/**
 * Highest schema version this WebUI build knows how to parse for the
 * stack-profile JSON envelope (the shape of files in
 * `server/profiles/*.json` or `shared/profiles/*.json`). Compared
 * against the integer content of `<profilesDir>/PROFILE_SCHEMA_VERSION`
 * when present.
 */
export const PROFILE_SCHEMA_VERSION = 1;

/**
 * Highest `schema_version` this WebUI build knows how to read for the
 * test-traceability manifest (`.shipwright/compliance/test-traceability.json`),
 * produced by the shipwright plugins. Bump in lockstep with the manifest
 * collector when its shape changes in a way the WebUI relies on.
 *
 * **v3** — the manifest namespace now derives from the requirement id, so the
 * composite outer key moved from `01-adopted::FR-01.01` to `01::FR-01.01`
 * (shipwright monorepo: "derive the traceability namespace from the FR id").
 * Every INNER field is unchanged, and this reader never reads the outer key
 * (it consumes `Object.values(requirements)` then inner `.id`/`.tests`), so v3
 * is a pure data-shape acknowledgement — no reader-logic change.
 *
 * **v4** (shipwright monorepo campaign req3-04c-ac-identity-wave2, P3.2:
 * "AC-scoped `@covers` tag grammar + test-traceability manifest v4") —
 * additive AC-scoped test binding. A test link may carry an optional
 * `ac_id` (e.g. `covers("FR-01.11/AC07")` → `"AC07"`), and a requirement
 * node may carry an optional `acs` breakdown mirroring its own
 * `tests`/`coverage` shape, scoped per AC. Both are OMITTED ENTIRELY when
 * the requirement has no AC-scoped tag anywhere, so a repo with none of
 * these tags yet emits a byte-identical v3-shaped body (only the
 * `schema_version` const moves). This reader does not consume `ac_id` or
 * `acs` — it still only reads `.id`/`.tests[<layer>][*].id/.layer/.resolved_from`,
 * every one of which is unchanged and required in both v3 and v4 — so a
 * v4 manifest with NO AC tags at all (a "v3-shaped bare FR tag" body) and
 * one WITH AC tags both invert identically; frozen fixture in
 * `traceability.v4-fixture.test.ts` pins both shapes.
 *
 * A manifest declaring a HIGHER version is warned once (via
 * `checkContractVersion`) and still read best-effort — the inner shape the
 * reader consumes has been stable across the bumps seen so far, so an
 * ahead-of-us manifest still yields a useful index.
 */
export const TRACEABILITY_SCHEMA_VERSION = 4;

interface WarnOnceKey {
  artefact: string;
  path: string;
  observedVersion: number;
}

const warnedOnce = new Set<string>();

function warnKey(k: WarnOnceKey): string {
  return `${k.artefact}::${k.path}::${k.observedVersion}`;
}

/**
 * Check a parsed artefact's declared version against the library's
 * known max. Logs one JSON warning per (artefact, path, version)
 * triple; subsequent calls with the same triple stay silent so we
 * don't spam the log.
 *
 * Returns `true` when the version is within the known range (the
 * common case); `false` when a warning was emitted. Callers use the
 * return value only for testability — production code ignores it.
 */
export function checkContractVersion(input: {
  artefact: string;
  path: string;
  declared: unknown;
  knownMax: number;
  fieldName?: string;
}): boolean {
  const { artefact, path, declared, knownMax, fieldName = "contractVersion" } =
    input;

  // Undefined/missing is fine — contract versions only landed in v0.3.2;
  // older artefacts on disk won't have them, and that's the whole point
  // of "fail-soft": keep reading.
  if (declared === undefined || declared === null) return true;

  if (typeof declared !== "number" || !Number.isInteger(declared)) {
    // Not a blocker either — but emit once so we notice corruption.
    const k = warnKey({ artefact, path, observedVersion: -1 });
    if (!warnedOnce.has(k)) {
      warnedOnce.add(k);
      console.warn(
        JSON.stringify({
          level: "warn",
          event: "contract_version_malformed",
          artefact,
          path,
          field: fieldName,
          declared: String(declared).slice(0, 64),
        }),
      );
    }
    return false;
  }

  if (declared > knownMax) {
    const k = warnKey({ artefact, path, observedVersion: declared });
    if (!warnedOnce.has(k)) {
      warnedOnce.add(k);
      console.warn(
        JSON.stringify({
          level: "warn",
          event: "contract_version_ahead",
          artefact,
          path,
          field: fieldName,
          declared,
          knownMax,
          hint:
            "WebUI build is older than the plugin side. Reading proceeds; " +
            "unknown fields are ignored. Update the WebUI if behaviour drifts.",
        }),
      );
    }
    return false;
  }

  return true;
}

/** Test helper — reset the one-shot warn memo between tests. */
export function _resetWarnMemo(): void {
  warnedOnce.clear();
}
