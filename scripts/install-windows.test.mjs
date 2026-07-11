/**
 * Structural tests for install-windows.ps1 — the Windows autostart installer.
 * PowerShell is not executable cross-platform under `node --test`, so we assert
 * the installer's *structure* by reading the script text (same convention as
 * start-server-production.test.mjs / kill-targets.test.js).
 *
 * What we pin (iterate-2026-06-19-deploy-npm-install): the dependency-install and
 * build steps must (a) NOT swallow stderr to $null and (b) be gated on the npm
 * exit code. `$ErrorActionPreference = "Stop"` does NOT trap a native command's
 * non-zero exit, so without explicit checks a failed `npm install` (e.g. a new
 * dependency that can't resolve) would silently proceed to create a startup
 * shortcut pointing at a server that won't run.
 *
 * Run: node --test scripts/install-windows.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(here, 'install-windows.ps1'), 'utf8');
const lines = src.split(/\r?\n/);

// A PowerShell line comment starts with `#` (after optional leading whitespace).
const isComment = (l) => l.trimStart().startsWith('#');

const npmLines = lines.filter((l) => !isComment(l) && /npm (install|run build)/.test(l));

test('installs deps for BOTH server and client + builds BOTH (4 npm steps)', () => {
  const installs = npmLines.filter((l) => /npm install/.test(l)).length;
  const builds = npmLines.filter((l) => /npm run build/.test(l)).length;
  assert.ok(installs >= 2, `expected >= 2 npm install steps, found ${installs}`);
  assert.ok(builds >= 2, `expected >= 2 npm run build steps, found ${builds}`);
});

test('npm steps do NOT suppress stderr to $null (a failed install must surface)', () => {
  const suppressed = npmLines.filter((l) => /2>\s*\$null/.test(l));
  assert.equal(
    suppressed.length,
    0,
    'npm steps must not redirect stderr to $null — a swallowed install/build ' +
      `error would silently produce a broken autostart: ${suppressed.join(' | ')}`,
  );
});

test('each npm step is gated on its exit code ($ErrorActionPreference does not trap native exits)', () => {
  const exitChecks = (src.match(/-ne 0/g) || []).length;
  assert.ok(
    exitChecks >= 4,
    'expected >= 4 exit-code gates for the 4 npm steps (2 install + 2 build), ' +
      `found ${exitChecks}. A failed npm install/build must abort before the ` +
      'startup shortcut is created.',
  );
});

// iterate-2026-07-10-installer-vbs-encoding (F18): the autostart VBS was written
// with `Set-Content -Encoding ASCII`, which maps every char >127 to '?'. A repo
// cloned under a non-ASCII path (umlauts / accents / CJK — e.g.
// C:\Users\Müller\Documents\shipwright-webui) got a corrupted $ServerDir /
// $serverEntryPoint baked into the launcher, silently breaking the login
// autostart while the installer still reported success. wscript.exe reads
// UTF-16LE natively, so the VBS must be written with -Encoding Unicode, and a
// post-write round-trip re-read must fail the install loudly if the path did
// not survive the encoding.

const vbsWriteLines = lines.filter(
  (l) => !isComment(l) && /Set-Content/.test(l) && /\$VbsPath/.test(l),
);

test('the VBS launcher is written as Unicode (UTF-16LE), never ASCII — non-ASCII repo paths must survive', () => {
  assert.equal(
    vbsWriteLines.length,
    1,
    `expected exactly one Set-Content writing $VbsPath, found ${vbsWriteLines.length}`,
  );
  const line = vbsWriteLines[0];
  assert.ok(
    !/-Encoding\s+ASCII/i.test(line),
    '-Encoding ASCII corrupts non-ASCII path characters to "?" — the login ' +
      `autostart would break silently for umlaut/accent/CJK repo paths: ${line}`,
  );
  assert.ok(
    /-Encoding\s+Unicode/i.test(line),
    `the VBS launcher must be written with -Encoding Unicode (UTF-16LE): ${line}`,
  );
});

test('the installer re-reads the VBS and fails loudly if the embedded server path did not round-trip', () => {
  const setIdx = lines.findIndex(
    (l) => !isComment(l) && /Set-Content/.test(l) && /\$VbsPath/.test(l),
  );
  assert.ok(setIdx >= 0, 'could not locate the Set-Content that writes $VbsPath');
  // The sanity check must come AFTER the write.
  const after = lines.slice(setIdx + 1).join('\n');
  assert.match(
    after,
    /Get-Content[^\n]*\$VbsPath/,
    'expected a Get-Content re-read of $VbsPath after writing it (post-write round-trip check)',
  );
  assert.match(
    after,
    /\$ServerDir/,
    'the round-trip check must verify the embedded $ServerDir survived the encoding',
  );
  assert.match(
    after,
    /exit 1/,
    'a failed round-trip must abort the install (exit 1) instead of reporting success',
  );
});
