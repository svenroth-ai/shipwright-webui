# Mini-plan: custom-profiles-preview-and-adopt-wiring

## Approach (chosen)
1. `core/custom-profile-loader.ts`: resolve a profile name for a project through `validateStackProfile` (existing bridge); on `ok+valid` with source project/user → realpath-contain the path under `<project>/.shipwright/profiles` or `~/.shipwright/profiles` → read+JSON.parse → return. Source bundled → existing sync loader. Cache `projectPath\0name` → {profile, file, mtimeMs, checkedAt}; TTL 15 s; in-flight dedupe; mtime change drops entry. Any failure → null (no preview).
2. Make the two consumers async: `actions/get.ts` (button gate + preview block) and `preview/routes.ts` (spawn). `loadProfile` dep becomes `(name, projectPath) => Promise<PreviewProfile|null>|PreviewProfile|null`; wiring passes the new loader. Tokenizer + `shell:false` + `preview-session-manager` untouched.
3. Adopt scan: `routes/adopt-scan.ts` `POST /api/adopt/scan` runs `analyze_codebase.py` read-only (output to os tmp, deleted after), returns `{status, profile}` via the same discipline as `stack-profiles.ts`; client hook `useAdoptScan(path)` + `AdoptResult` Profile row with source badge + warnings, sample rows stay labelled.
4. Real-browser E2E: custom project profile with `dev_server` → Preview button visible → click → URL returned.
5. One real check that `/shipwright-run` honors the brief's profile name.

## Alternative rejected
Reading `<project>/.shipwright/profiles/<name>.json` directly in Node: re-implements project→user→bundled order and shadowing (the thing #534 deliberately avoided).

## Risks
Untrusted `dev_server.command` (mitigated by tokenizer + containment + user clicking Preview); resolver latency (cache); analyze scan duration on big repos (timeout, sample fallback).
