/**
 * Structural tests for stop-server.ps1 — the Windows server-stop script.
 * PowerShell is not portably executable end-to-end under `node --test`, so —
 * like start-server-production.test.mjs / .sh.test.mjs — we assert the script's
 * *structure* by reading its text.
 *
 * What this iterate pins (the bug it fixes — campaign webui-deep-audit D14,
 * F35): the .ps1 must honor $env:PORT (default 3847) exactly like its .sh twin's
 * PORT="${PORT:-3847}". The pre-fix script hardcoded 3847 for the kill sweep and
 * the operator message, so a Windows operator on a custom PORT (a documented env
 * override in CLAUDE.md; repo-root .env.local can carry it) killed nothing — the
 * OLD server on the custom port survived and the message named the wrong port.
 * Its .sh twin (stop-server.sh) already derives PORT once and uses it
 * consistently.
 *
 * Run: node --test scripts/stop-server.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ps1Path = path.join(here, 'stop-server.ps1');
const src = fs.readFileSync(ps1Path, 'utf8');
const lines = src.split(/\r?\n/);

// A PowerShell line comment starts with `#` (after optional leading whitespace).
const isComment = (l) => l.trimStart().startsWith('#');
const codeLines = lines.filter((l) => !isComment(l));

// The kill-sweep line: `Get-NetTCPConnection -LocalPort <x> -State Listen`.
const localPortLine =
  codeLines.find((l) => /Get-NetTCPConnection\s+-LocalPort/i.test(l)) ?? '';
// The "nothing was running on port ..." operator message.
const nothingLine =
  codeLines.find((l) => /nothing was running on port/i.test(l)) ?? '';

test('structure markers present (guards the other assertions)', () => {
  // If either marker is renamed in a refactor, the assertions below would
  // silently pass on an empty string — fail loudly instead.
  assert.ok(
    localPortLine,
    'expected a `Get-NetTCPConnection -LocalPort` kill-sweep line',
  );
  assert.ok(
    nothingLine,
    'expected a "nothing was running on port" operator-message line',
  );
});

test('derives the port from $env:PORT with a 3847 default (parity with stop-server.sh PORT="${PORT:-3847}")', () => {
  const derives = codeLines.some(
    (l) => /\$env:PORT/.test(l) && /\b3847\b/.test(l),
  );
  assert.ok(
    derives,
    'expected a port variable derived from $env:PORT that defaults to 3847 — ' +
      'the .ps1 parallel of the .sh twin PORT="${PORT:-3847}".',
  );
});

test('the kill sweep targets the port VARIABLE, not a hardcoded 3847 (RED on pre-fix main)', () => {
  assert.match(
    localPortLine,
    /-LocalPort\s+\$\w+/i,
    '`-LocalPort` must reference the derived $port variable, not a literal — ' +
      'otherwise a custom-PORT operator kills nothing and the OLD server survives.',
  );
  assert.doesNotMatch(
    localPortLine,
    /-LocalPort\s+3847\b/,
    '`-LocalPort` must not hardcode 3847.',
  );
});

test('the "nothing running" message references the port variable, not a literal 3847 (RED on pre-fix main)', () => {
  assert.match(
    nothingLine,
    /\$\w+/,
    'the operator message must interpolate the derived port variable.',
  );
  assert.doesNotMatch(
    nothingLine,
    /port 3847\b/,
    'the operator message must not name a hardcoded port 3847 — it would ' +
      'misdiagnose the state on a custom PORT.',
  );
});

test('one SINGLE variable ($Port) is derived from $env:PORT and reused in BOTH the kill sweep and the message', () => {
  // Guards the openai code-review concern: structural checks could pass if the
  // script derived $Port but then killed a port named by a DIFFERENT variable.
  // Pin the exact name across the derivation, the -LocalPort kill sweep, and the
  // "nothing running" message.
  const usesPort = (re) => codeLines.some((l) => re.test(l));
  assert.ok(
    usesPort(/\$Port\s*=\s*if\s*\(\s*\$env:PORT/i),
    'expected `$Port = if ($env:PORT ...` derivation',
  );
  assert.match(
    localPortLine,
    /-LocalPort\s+\$Port\b/i,
    'the kill sweep must use $Port',
  );
  assert.match(
    nothingLine,
    /port \$Port\b/i,
    'the "nothing running" message must use $Port',
  );
});

test('no stray hardcoded 3847 on a code line (only the $env:PORT default derivation keeps it)', () => {
  const strays = codeLines
    .filter((l) => /\b3847\b/.test(l) && !/\$env:PORT/.test(l))
    .map((l) => l.trim());
  assert.deepEqual(
    strays,
    [],
    `no 3847 literal may appear outside the $env:PORT default derivation; found: ${JSON.stringify(strays)}`,
  );
});
