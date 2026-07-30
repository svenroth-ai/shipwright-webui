# Iterate ADR — D13 installer-vbs-encoding (F18)

run_id: iterate-2026-07-10-installer-vbs-encoding
complexity: medium (spec-designated STANDARD; classify_complexity keyword-`large`
is a false positive from verbose prose — treated as medium per campaign brief)
risk flags: none (dev-tooling installer script; no io-boundary/auth/rls/migration/
billing/shared-infra/public-api/build/cross-split surface — writes only into
%USERPROFILE%\.shipwright-webui\ + the Startup folder) · change_type: bug

## Decision
Write the autostart VBS launcher with `Set-Content -Encoding Unicode` (UTF-16LE +
BOM, read natively by wscript.exe) instead of `-Encoding ASCII`, which mapped
every char > 127 to "?" and silently corrupted a non-ASCII repo path
(e.g. C:\Users\Müller\...) baked into the launcher — breaking login autostart
while the installer reported success. Add a post-write round-trip guard that
re-reads the file and aborts loudly (exit 1, remove the bad launcher, no Startup
shortcut) if the embedded server path did not survive the encoding. The escaped
server path is computed once and shared between the VBS generator and the guard
so the check compares against exactly what was written (no recomputation drift).

## Self-Review (Step 3.6 — 7-item checklist)
1. **Spec Compliance** — PASS. `-Encoding Unicode` + post-write round-trip guard
   that fails the install loudly, exactly per the fix direction. Footprint = the
   named `install-windows.ps1` + its co-located `install-windows.test.mjs` (AC2).
2. **Error Handling** — PASS. `$ErrorActionPreference="Stop"` turns Set/Get-Content
   cmdlet failures into terminating errors; the round-trip mismatch path removes
   the bad VBS and `exit 1` before any Startup shortcut is created (fails closed).
3. **Security Basics** — PASS. No new interpolation surface: `$ServerDir` derives
   from `$PSScriptRoot` (the installer's own location) — a real directory, so it
   cannot contain `"` (illegal Windows filename char); the VBS-literal quote-
   injection the reviewers floated is unreachable. No secrets touched.
4. **Test Quality** — PASS. 2 new structural tests RED-first on pre-fix main
   (captured), green after; behavioral PowerShell smoke reproduces the ASCII
   corruption and proves Unicode round-trip + UTF-16LE BOM (see Confidence
   Calibration). Follows the sibling test's established convention.
5. **Performance Basics** — PASS. One extra file read of a tiny VBS at install
   time; no loop/allocation growth. Irrelevant to any hot path.
6. **Naming & Structure** — PASS. `$escapedServerDir`/`$escapedEntryPoint` name
   the shared transform; script stays 152 LOC, < 300 ceiling, not baselined.
7. **Affected Boundaries (ADR-024)** — PASS. Boundary = PowerShell installer
   (producer) → `start-server.vbs` file → wscript.exe (consumer). Real round-trip
   probe run on this Win11 box (ASCII→corruption, Unicode→survives, BOM present).

Items failed: 0 / 7.

## External-Plan-Review-Findings (Step 3.5 — openrouter: openai + gemini)
| # | Sev | Finding | Disposition |
|---|-----|---------|-------------|
| P1 | high | Recomputing the backslash-escape in the guard could drift from the generator → false confidence | accepted-and-fixed — compute `$escapedServerDir`/`$escapedEntryPoint` ONCE, share between the VBS generator and the guard; the check now compares against exactly what was written |
| P2 | medium | Verify `$serverEntryPoint` round-trips too, not just `$ServerDir` | rejected-with-reason — `$serverEntryPoint = $ServerDir + "\dist\index.js"`, so its non-ASCII chars are a strict subset of `$ServerDir`'s prefix; verifying `$ServerDir` survived is sufficient to prove no path char was lost (documented in-code) |
| P3 | medium | Add try/catch + cleanup on validation failure | accepted-and-fixed (cleanup) — on round-trip failure the bad VBS is removed before exit; the Startup shortcut is created only AFTER the guard passes. try/catch is redundant: `$ErrorActionPreference="Stop"` already makes the cmdlet I/O terminating |
| P4 | medium (both) | Footprint: spec Files lists only `install-windows.ps1`, plan adds `install-windows.test.mjs` | accepted-and-noted — the test file is AC2-mandated (new regression test) and is the script's co-located companion; identical footprint pattern to merged D01–D12. Flagged in the PR body |
| P5 | high (gemini) | Backslash-doubling is wrong — VBScript literals don't escape `\` | rejected-with-reason — PRE-EXISTING behavior (not introduced here); empirically the shipped ASCII-path autostart works, so Windows path APIs tolerate the doubled separators. Out of F18 (encoding) scope; changing it risks regressing working installs |
| P6 | medium (openai) | `.Contains()` proves only one substring survived, not full VBS validity | rejected-with-reason — F18 is strictly the non-ASCII encoding-corruption defect; the guard's job is to prove path chars survived the encoding, which `.Contains($escapedServerDir)` does. Full VBScript-syntax validation is out of scope |
| P7 | low | Double-quote injection if a path contains `"` | rejected-with-reason — unreachable: `$ServerDir` is a real filesystem directory (`$PSScriptRoot`), and `"` is an illegal Windows filename char |
| P8 | low (gemini) | Drop the guard — encoding change alone fixes it (over-production) | rejected-with-reason — the guard is spec-mandated ("add a post-write sanity check … fail the install loudly if not") and defends against a future encoding regression; a drift fails CLOSED (safe abort), not falsely-passing |

## External-Code-Review-Findings (Step 3.7 — openrouter: openai + gemini)
| # | Sev | Finding | Disposition |
|---|-----|---------|-------------|
| C1 | medium | `-replace '\\','\\'` "doesn't double backslashes; comment misleading" | rejected-with-reason — empirically FALSE: probe on this box shows `C:\Users\Müller` → `C:\\Users\\Müller` (original ≠ doubled). In .NET regex replacement `\` is literal, so `'\\'` emits two backslashes. The comment is accurate |
| C2 | medium | Tests only grep the script source; don't validate the runtime scenario | accepted-and-addressed — this is the codebase's established convention (the sibling test's header: "PowerShell is not executable cross-platform under node --test"); RED-first captured + behavioral PowerShell smoke reproduces the corruption and proves the fix (documented per the no-silent-success rule) |
| C3 | medium | AC2 should reproduce the umlaut scenario, not statically inspect | accepted-and-addressed — same as C2: the reproduction IS the spec-prescribed scripted PowerShell smoke (ASCII→corruption, Unicode→round-trip, BOM present); the structural node --test is the automated RED-first proof |
| — | (gemini) | no findings returned | n/a |

Internal code-reviewer cascade: `reviews.code = delegated_to_orchestrator`
(campaign mode; runner has no Agent tool).

## Confidence Calibration (Step 3.8 — boundary = installer → VBS file → wscript)
Boundary: PowerShell installer (producer, stamps `$ServerDir`) → `start-server.vbs`
on disk → wscript.exe / node (consumer, reads the embedded path).
Probes run (real, empirical, on this Win11 box):
1. **Round-trip probe** (producer→file→consumer): umlaut path `C:\Users\Müller\…`
   written with `-Encoding Unicode`, re-read → `.Contains($escapedServerDir)` TRUE.
   Finding: none (path survives).
2. **Corruption/negative probe**: same content written with the OLD `-Encoding
   ASCII` → re-read → `.Contains()` FALSE (umlaut became "?"). Proves the guard is
   NOT vacuous — it actually catches the F18 defect. Finding: reproduces F18.
3. **BOM probe**: `-Encoding Unicode` file's first two bytes are `FF FE` (UTF-16LE
   BOM — the documented WSH read signal). Finding: none (wscript reads natively).
4. **RED-first regression probe**: the 2 new node --test assertions RED on pre-fix
   main (ASCII present / no Get-Content re-read), GREEN after. Finding: none.
5. **Refactor-preservation probe**: new `$escapedServerDir` var form byte-identical
   to the old inline `$($ServerDir -replace '\\','\\')` form. Finding: none.
Asymptote: probes 1/3/4/5 all no-finding after the fix; probe 2 confirms the guard
bites. Two-plus consecutive clean rounds → boundary calibrated.
Edge not probed: a path containing `"` — accepted, unreachable (illegal Windows
filename char; `$ServerDir` is a real dir). asymptote_reached: true.
