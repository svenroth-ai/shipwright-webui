# Mini-plan — D13 installer-vbs-encoding (F18)

## Problem
`scripts/install-windows.ps1` writes the autostart VBS launcher
(`start-server.vbs`) with `Set-Content -Path $VbsPath -Value $vbsContent
-Encoding ASCII`. The VBS content embeds `$ServerDir` and `$serverEntryPoint`
literally. `-Encoding ASCII` maps every character > 127 to `?`, so a repo cloned
under a non-ASCII path — typical for DACH / French / CJK locales where the clone
lives under the profile, e.g. `C:\Users\Müller\Documents\shipwright-webui` —
gets a corrupted path baked into the launcher. The login autostart silently
fails (node cannot cd into `C:\Users\M?ller\...`) while the installer prints
"Installation complete!".

## Alternatives considered
1. **UTF-8 (`-Encoding UTF8`)** — rejected: Windows PowerShell 5.1 writes UTF-8
   *with* a BOM (`EF BB BF`), and `wscript.exe` does NOT reliably honour a UTF-8
   BOM for `.vbs` — the classic engine expects ANSI or UTF-16LE. A UTF-8 BOM can
   surface as stray glyphs on the first line. Wrong tool for a WSH consumer.
2. **`-Encoding Default` (system ANSI codepage)** — rejected: only round-trips
   characters present in the active code page; a CJK char under a Latin-1
   (1252) code page still corrupts. Locale-dependent, not a fix.
3. **Chosen: `-Encoding Unicode` (UTF-16LE + BOM)** — `wscript.exe` reads
   UTF-16LE natively (the BOM `FF FE` is the documented WSH signal), so every
   Unicode path character round-trips. Plus a post-write sanity check that
   re-reads the file and confirms the embedded `$ServerDir` survived — fail the
   install loudly (exit 1, no shortcut) instead of reporting a false success.

## Decision trace
- The round-trip check compares the re-read file content against the same
  backslash-doubled form the VBS embeds (`$ServerDir -replace '\\', '\\'`) using
  a plain `.Contains()` substring test (not `-like`, which would treat `[`/`?`
  in a path as wildcards).
- `Get-Content -Raw -Encoding Unicode` mirrors the write encoding so the compare
  is exact; a corrupting encoding turns the umlaut into `?`, the substring
  vanishes, and the guard aborts before the Startup shortcut is created.
- No automated PowerShell harness exists cross-platform, so the regression proof
  follows the established structural convention of the sibling
  `install-windows.test.mjs` (read the script text under `node --test`) plus an
  empirical on-Windows PowerShell encoding smoke.

## Files (footprint contract)
- `scripts/install-windows.ps1` (ASCII→Unicode + ~11-line post-write round-trip guard)
- `scripts/install-windows.test.mjs` (+2 structural regression tests)

## Invariants preserved
- Read-only-observer rules 1/12: the installer writes only into
  `%USERPROFILE%\.shipwright-webui\` + the Startup folder; no `~/.claude/projects/**`
  and no `shipwright_run_config.json` write.
- The 4 npm exit-code gates + no-stderr-to-$null contracts
  (iterate-2026-06-19) stay green — the new tests are additive.
- `scripts/install-windows.ps1` NOT in `shipwright_bloat_baseline.json`; stays < 300 LOC.
