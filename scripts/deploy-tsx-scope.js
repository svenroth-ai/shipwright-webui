/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Deploy-scope helpers for findTsxServerPids() (deploy-procs.mjs).
 *
 * A production deploy has to kill not just the port listener but the `tsx
 * watch` PARENT (it would otherwise respawn the child and re-take the port).
 * The parent process is found by a generic command-line match ('tsx' +
 * 'src/index.ts') that says nothing about WHICH repo — the entry path is
 * relative — so without an extra scoping step it matches every `tsx watch`
 * process on the machine, including an unrelated project's and a sibling
 * worktree's (iterate-2026-09-09-deploy-tsx-kill-scope).
 *
 * The fix does not need per-PID cwd resolution: a `tsx watch` process's
 * command line already carries the ABSOLUTE, checkout-specific
 * `node_modules/tsx/...` resolution path, because npm never invokes a bare
 * relative `tsx` — it always resolves through the repo-local
 * node_modules/.bin. filterTsxEntriesByRepo() scopes the raw discovery
 * result to entries whose command line resolves inside the deploying repo's
 * own server directory, which — being per-checkout — also distinguishes one
 * worktree from another.
 *
 * Pure/impure split mirrors kill-targets.js: this file is pure parsing and
 * matching (unit-tested in deploy-tsx-scope.test.js); deploy-procs.mjs owns
 * the actual subprocess calls.
 */

/**
 * Case-folds ONLY on Windows (win32 paths are case-insensitive, and this
 * repo mostly runs there). External review (openai + glm,
 * iterate-2026-09-09-deploy-tsx-kill-scope) caught that unconditional
 * case-folding widens the match on a case-sensitive POSIX filesystem — two
 * differently-cased checkouts (`/work/App/server` vs. `/work/app/server`)
 * would cross-match, which is exactly the sibling-worktree collision this
 * whole fix exists to prevent. A real POSIX command line's argv is derived
 * from the actual on-disk path, so its case always matches `repoRoot`'s —
 * folding case there could only ever WIDEN a match, never rescue a
 * legitimate one, so gating it to win32 has no under-matching downside.
 * @param {unknown} s @returns {string}
 */
function normalizeForPathMatch(s) {
  const str = String(s ?? '').replace(/\\/g, '/');
  return process.platform === 'win32' ? str.toLowerCase() : str;
}

/**
 * Is this the command line of a `tsx watch` dev-server process (the webui
 * server entry, specifically — not any other `tsx`-adjacent process)? Single
 * source of truth for the marker match, used by BOTH platform parsers below
 * so the two can never drift into checking different things.
 * @param {string} commandLine
 * @returns {boolean}
 */
function isTsxServerCommandLine(commandLine) {
  return /tsx/i.test(commandLine) && /src[\\/]index\.ts/i.test(commandLine);
}

/**
 * Parse `Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Select
 * ProcessId, ParentProcessId, CommandLine | ConvertTo-Json` output into
 * {pid, ppid, commandLine} entries, keeping only the tsx-watch-server
 * candidates (isTsxServerCommandLine). `ConvertTo-Json` collapses a single
 * match to a bare object rather than a one-element array — both shapes are
 * handled. A leading UTF-8 BOM (`\uFEFF`) is stripped before parsing:
 * PowerShell 5.1's redirected UTF-8 output commonly carries one, and
 * `JSON.parse` throws on it — a bug this file's `[Console]::OutputEncoding`
 * fix (added for non-ASCII command lines) would otherwise have silently
 * reintroduced for every deploy, every time.
 *
 * @param {string} json
 * @returns {{pid: string, ppid: string, commandLine: string}[]}
 */
function parseWindowsTsxEntries(json) {
  const BOM = String.fromCharCode(0xfeff);
  const raw = String(json ?? '').replace(new RegExp('^' + BOM), '').trim();
  if (!raw) return [];
  let rows;
  try {
    rows = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(rows)) rows = [rows];
  return rows
    .filter((r) => r && r.ProcessId !== undefined && r.ProcessId !== null)
    .map((r) => ({
      pid: String(r.ProcessId),
      ppid: r.ParentProcessId === undefined || r.ParentProcessId === null ? '' : String(r.ParentProcessId),
      commandLine: String(r.CommandLine ?? ''),
    }))
    .filter((e) => isTsxServerCommandLine(e.commandLine));
}

/**
 * Parse `ps -A -o pid=,ppid=,args=` output (`"<pid> <ppid> <full command
 * line>"` per line, unfiltered — every process on the machine) into {pid,
 * ppid, commandLine} entries, keeping only the tsx-watch-server candidates
 * (isTsxServerCommandLine).
 *
 * `ps -A -o pid=,ppid=,args=` (NOT `pgrep -af`) on purpose: `-a` is NOT
 * portable across POSIX `pgrep` implementations — procps (Linux) treats it
 * as "print the full command line", but BSD/macOS `pgrep -a` means "include
 * process ancestors" instead and does not add the command line at all.
 * Feeding that through unchanged made every entry's commandLine empty, so
 * the repo-scope filter below dropped everything and the whole sweep
 * silently went dark on macOS — spec-reviewer caught this in
 * iterate-2026-09-09-deploy-tsx-kill-scope before it shipped.
 * `ps -A -o pid=,ppid=,args=` has no such split: `-A` and the `keyword=`
 * (empty header) form of `-o` are honored identically by GNU ps and BSD ps.
 * `ps -A` returns EVERY process unfiltered, so — unlike the pre-fix
 * `pgrep -f` pattern, which pre-filtered server-side — the marker match has
 * to happen here, in JS.
 *
 * @param {string} output
 * @returns {{pid: string, ppid: string, commandLine: string}[]}
 */
function parsePosixTsxEntries(output) {
  return String(output ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const m = line.match(/^(\d+)\s+(\d+)\s+(.*)$/s);
      return m ? { pid: m[1], ppid: m[2], commandLine: m[3] } : { pid: '', ppid: '', commandLine: '' };
    })
    .filter((e) => /^\d+$/.test(e.pid))
    .filter((e) => isTsxServerCommandLine(e.commandLine));
}

/**
 * Narrow a set of tsx-watch process entries down to ONLY the ones belonging
 * to `repoRoot`'s own checkout. An empty/missing repoRoot matches nothing —
 * fail CLOSED, never back to the machine-wide match this replaces.
 *
 * The pattern is `<repoRoot>/node_modules/(<segment>/)*tsx/` — NOT a bare
 * `<repoRoot>/` (external review, openai/glm round 1: a bare repoRoot
 * substring can appear in an UNRELATED tsx process's command line via an
 * incidental argument that merely references this repo, e.g.
 * `--tsconfig <repoRoot>/tsconfig.json`), and NOT a flat
 * `<repoRoot>/node_modules/` either (external review round 2: that still
 * matches an unrelated process's `--require <repoRoot>/node_modules/dotenv/config`
 * without that process's OWN tsx resolving from this repo at all). Requiring
 * a literal `tsx/` path SEGMENT somewhere after `node_modules/` — with any
 * number of segments in between — encodes the actual invariant this whole
 * scoping strategy relies on (see the function header on findTsxServerPids()
 * in deploy-procs.mjs): every real tsx-watch process's command line contains
 * ITS OWN resolved path INTO the `tsx` package under the repo that owns it.
 * The `(<segment>/)*` gap is required, not optional — real captured command
 * lines resolve through `node_modules/.bin/../tsx/...` (the npm bin shim),
 * not a flat `node_modules/tsx/...`, so anchoring directly on
 * `node_modules/tsx/` would silently stop matching the watch PARENT itself
 * (see deploy-tsx-scope.test.js's `.bin\..\tsx` fixture).
 *
 * Residual, ACCEPTED gap (external review round 3, openai): this still
 * matches an unrelated repo's tsx process if ITS OWN command line happens to
 * carry an argument pointing INTO the deploying repo's actual
 * `node_modules/.../tsx/...` path (e.g. `--import <repoRoot>/node_modules/tsx/dist/loader.mjs`
 * naming a DIFFERENT repo's tsx internals specifically, not merely its
 * root). Each review round has produced a narrower, more contrived
 * counter-example on this same axis — plain `<repoRoot>/`, then any
 * `node_modules/` reference, now specifically the tsx package's own
 * resolution path — and closing this one requires literally parsing which
 * argv token is the invoked executable versus an argument, which two
 * platforms' flat CommandLine strings (Windows CIM, POSIX `ps args=`) do not
 * reliably delimit. Nor can it be closed by rejecting a preceding
 * `--import`/`--require` flag — that is how tsx invokes ITS OWN loader (see
 * PID 39236 in deploy-tsx-scope.test.js's own fixture: `--import
 * file:///.../tsx/dist/loader.mjs` is a LEGITIMATE self-invocation shape,
 * not a foreign reference). No real-world tooling constructs a command line
 * that references a foreign checkout's tsx internals this precisely;
 * treated as an accepted, out-of-scope residual risk rather than chased
 * further — raised again, unchanged, by external review rounds 3 AND 4
 * (openai); the standing rebuttal is this comment.
 *
 * The pattern also anchors the TRAILING edge of the repo-root prefix at a
 * path boundary as a side effect: `.../server-old/node_modules/...` (a
 * sibling checkout whose name merely EXTENDS this one) cannot satisfy
 * `.../server/node_modules/`.
 *
 * The LEADING edge is not anchored the same way — deliberately: in a real
 * command line the absolute path is preceded by whatever the process's own
 * argv formatting puts there (a quote, a space, `file:///`, …), never
 * reliably a bare path separator, so requiring one would reject genuine
 * matches rather than reject false ones. This remains a textual substring
 * match, not a resolved filesystem identity check: on a POSIX host where
 * `repoRoot` itself recurs verbatim as a subpath of a genuinely different
 * absolute path (e.g. a bind mount mirroring the same tree under another
 * prefix), a false match is still structurally possible. Windows is immune
 * by construction — a drive letter (`C:`) cannot recur mid-path.
 *
 * `repoRoot` and the process command line are compared as-given, NOT
 * `fs.realpathSync`'d — unlike DO-NOT #10's path-guard rule (which governs
 * webui's own file-serving routes), because there is no filesystem access
 * here to resolve against; this is a text match over another process's argv.
 * A checkout reached through a symlink/junction (or a Windows `subst`
 * drive) can therefore present a DIFFERENT spelling of the same directory
 * on each side and silently fail to match — under-matching (the repo's own
 * watch parent survives, blocking the port) rather than over-matching a
 * foreign one. Accepted: this is a known, undocumented-until-now limitation
 * of an unusual checkout layout, not a regression this fix introduces.
 *
 * Kill ORDER: a matched entry whose PARENT PID is ALSO a matched entry is
 * placed AFTER that parent in the returned list. Raw process-enumeration
 * order (what the OS handed back) is otherwise arbitrary — usually
 * parent-before-child in practice (a parent's PID is normally allocated
 * before any child it spawns), but not guaranteed, and `stopOldServer`
 * relies on killing the tsx watch PARENT before its own child to prevent a
 * respawn race (external review round 5, openai). Only a stable PARTITION
 * (parents, then children), not a full topological sort: tsx's watch
 * hierarchy is one level deep (CLI supervisor -> loader/entry child), never
 * a longer chain, per every command line captured for this fix so far.
 *
 * @param {{pid: string, ppid: string, commandLine: string}[]} entries
 * @param {string|undefined} repoRoot  absolute path unique to this checkout
 *   (the server/ dir being deployed) — every node_modules-resolved tsx
 *   invocation's command line embeds it.
 * @returns {string[]} deduped PIDs, parents-before-children, otherwise
 *   first-seen order
 */
function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function filterTsxEntriesByRepo(entries, repoRoot) {
  const root = normalizeForPathMatch(repoRoot).replace(/\/+$/, '');
  if (!root) return [];
  // (?:[^\s"'/]+\/)*tsx\/ — any number of intermediate path segments (e.g.
  // the `.bin/../` npm shim hop), bounded by whitespace/quotes so the match
  // can't run on past the end of this argv token into an unrelated one.
  // Excluding `/` itself from the segment class (Semgrep
  // detect-non-literal-regexp / ReDoS finding, PR #459 review) makes each
  // repetition consume exactly one path segment with no ambiguity about
  // where a segment ends — the regex engine has only one way to partition
  // the string, so this can never backtrack catastrophically regardless of
  // how many `/`-separated segments a command line contains.
  const pattern = new RegExp(`${escapeRegExp(root)}/node_modules/(?:[^\\s"'/]+/)*tsx/`);
  const seen = new Set();
  const matched = [];
  for (const entry of entries) {
    const { pid } = entry;
    if (!pid || seen.has(pid)) continue;
    if (!pattern.test(normalizeForPathMatch(entry.commandLine))) continue;
    seen.add(pid);
    matched.push(entry);
  }
  const matchedPids = new Set(matched.map((e) => e.pid));
  const roots = matched.filter((e) => !matchedPids.has(e.ppid));
  const children = matched.filter((e) => matchedPids.has(e.ppid));
  return [...roots, ...children].map((e) => e.pid);
}

module.exports = {
  isTsxServerCommandLine,
  parseWindowsTsxEntries,
  parsePosixTsxEntries,
  filterTsxEntriesByRepo,
};
