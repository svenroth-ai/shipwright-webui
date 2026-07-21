/*
 * shell-heads.ts — "did this shell string actually RUN X, or merely mention it?"
 * (FR-01.68 AC8, split out of `stage-markers.ts` at the 300-LOC ceiling).
 *
 * Split because the two concerns move for different reasons: this file changes
 * when SHELL SYNTAX handling does, `stage-markers.ts` changes when Shipwright's
 * tooling vocabulary does. Nothing here knows what a phase is.
 *
 * Pure + deterministic. No I/O.
 */

/** Shell separators that begin a new command. Quote-blind — the FALLBACK only
 *  (see `splitSegments`), never the primary path. */
const SEGMENT_SPLIT = /\n|;|&&|\|\||[|&]/;
/** Leading noise before the real command: env assignments and runner wrappers. */
const COMMAND_PREFIX = /^(\S+=\S+|npx|pnpm|yarn|bun|sudo|time|command)\s+/;
const SEPARATORS = new Set(["\n", ";", "|", "&"]);

/**
 * Split a shell string at separators that are actually SEPARATORS — i.e. not
 * inside quotes and not backslash-escaped.
 *
 * A plain `split(SEGMENT_SPLIT)` cuts quoted arguments apart and promotes a
 * fragment to a command position, so a tool name merely MENTIONED inside a
 * quoted string claims its phase. `grep -n "visual\|screenshot\|playwright"`
 * yielded a head of `playwright" .gitignore` and set the Test marker. Measured
 * over 198 real transcripts: 47 (23%) carry at least one such command (63 test,
 * 11 build, 4 merge) — a live defect in the SHIPPED stepper, and the same
 * name-vs-evidence confusion `stage-markers.ts` already guards one level up.
 *
 * A stateful scanner, deliberately not a cleverer regex: quote state is not a
 * regular property, and every regex attempt at it breaks on escapes.
 *
 * NOT supported, and knowingly so: command substitution (`$(…)`, backticks),
 * heredocs, and `$'…'` ANSI-C quoting. They mis-split as before rather than
 * silently mis-CLASSIFY, because an unterminated quote falls back to the old
 * behaviour — a real command after a stray `"` must still be seen.
 */
function splitSegments(cmd: string): string[] {
  const out: string[] = [];
  let buf = "";
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < cmd.length; i++) {
    const ch = cmd[i];
    if (quote) {
      // POSIX: a backslash escapes inside double quotes, never inside single.
      if (quote === '"' && ch === "\\" && i + 1 < cmd.length) buf += ch + cmd[++i];
      else if (ch === quote) (quote = null), (buf += ch);
      else buf += ch;
      continue;
    }
    if (ch === "\\" && i + 1 < cmd.length) {
      buf += ch + cmd[++i];
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      buf += ch;
    } else if (SEPARATORS.has(ch)) {
      out.push(buf);
      buf = "";
      // `&&` / `||` are one separator, not two empty segments.
      while (i + 1 < cmd.length && (cmd[i + 1] === "|" || cmd[i + 1] === "&")) i++;
    } else {
      buf += ch;
    }
  }
  if (quote) return cmd.split(SEGMENT_SPLIT); // unterminated: degrade, never swallow
  out.push(buf);
  return out;
}

/**
 * The command heads of a shell string — one per real separator, with env
 * assignments and runner wrappers stripped, so `npx vitest run` and
 * `SHIPWRIGHT_NETWORK_PROFILE=local npx vitest run` both expose `vitest run`
 * while `cat vitest.config.ts` exposes `cat …`.
 */
export function commandHeads(cmd: string): string[] {
  return splitSegments(cmd).map((segment) => {
    let s = segment.trim();
    for (;;) {
      const m = COMMAND_PREFIX.exec(s);
      if (!m) return s;
      s = s.slice(m[0].length);
    }
  });
}

/** Did this shell string actually RUN the pattern, rather than mention it? */
export function runsCommand(cmd: string, pattern: RegExp): boolean {
  return commandHeads(cmd).some((head) => pattern.test(head));
}
