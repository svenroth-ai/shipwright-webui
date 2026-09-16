/*
 * codex-terminal-signal-detect.ts — Codex Light §5.3 "Guided-mode approvals
 * and structured errors": pure detectors over the visible-viewport text of
 * a Codex-runtime embedded terminal, mirroring `terminal-prompt-detect.ts`'s
 * shape (bottom-anchored, bounded, best-effort) but keyed to Codex's own
 * strings instead of Claude's.
 *
 * Evidence: `codex-task-watcher.ts`'s module header previously scoped this
 * detector OUT as "no verified plain-pty-TUI text pattern to build a
 * detector from yet" — the spec's own §3 confirmation test only exercised
 * `request_user_input` over the APP-SERVER protocol (Stage 2, not v1). That
 * gap is now closed for the plain-pty case: the exact strings below were
 * extracted directly from the real, installed `codex-cli 0.147.0` Windows
 * binary (`@openai/codex-win32-x64`'s `codex.exe`, via a printable-string
 * scan), the same evidence tier `codex-thread-discovery.ts` used for the
 * rollout-file naming convention. One honest gap remains, smaller than that
 * one: these strings are confirmed to exist verbatim in the binary, not
 * (yet) observed in an actual rendered pty capture of a live approval
 * dialog — ratatui box-drawing/wrapping around them is unverified. The
 * detectors are therefore deliberately conservative (a short, literal
 * heading match within a bottom-anchored recency window, no footer-shape
 * assumptions) so a wrapped border cannot produce a false NEGATIVE beyond
 * "missed this tick, the next poll on unchanged text still forms a false
 * positive risk that a real capture might have avoided" — and the anchor
 * strings are distinctive enough (only Codex's own approval elicitation or
 * error footer would ever emit them) that a false POSITIVE is effectively
 * impossible.
 *
 * Independent of the silence-timer/oracle loop (§5.3's own wording) — wired
 * as an Inbox post-pass (`external/inbox/_codex.ts`), not into
 * `CodexTaskWatcher.tick()`, exactly like `terminal_prompt`'s own
 * `appendTerminalPrompts` post-pass.
 */

/** Recency window — how many trailing lines of visible text count as "the
 *  current bottom-most content" for either signal. A live dialog or error
 *  footer is always the last thing Codex printed; older scrollback above
 *  this window is deliberately never scanned (an old, since-scrolled-past
 *  approval/error must not resurrect itself as "still pending"). */
const RECENCY_WINDOW_LINES = 40;

/** Codex's two known approval-elicitation headings (command exec, patch
 *  apply) — verified verbatim in the real codex.exe binary. */
const APPROVAL_HEADING = /Allow Codex to (run `|apply proposed code changes\?)/i;

/** Codex's generic turn-ending error footer — shown for a turn abort,
 *  Ctrl-C interrupt, high load, rate limit, etc.; the one constant across
 *  all of them. Verified verbatim in the real codex.exe binary. */
const ERROR_FOOTER = /Something went wrong\??\s*Hit\s*`?\/feedback`?\s*to report the issue/i;

const MAX_BLOCK_LINES = 24;
/** Mirrors terminal-prompt-detect.ts's MAX_QUESTION_TEXT_LEN cap — keeps a
 *  pathological viewport from leaking unbounded text into the Inbox. */
const MAX_SIGNAL_TEXT_LEN = 4000;

function isBlank(line: string): boolean {
  return line.trim().length === 0;
}

function recencyLines(visibleText: string): { lines: string[]; startIndex: number } {
  const lines = visibleText.split("\n");
  const startIndex = Math.max(0, lines.length - RECENCY_WINDOW_LINES);
  return { lines: lines.slice(startIndex), startIndex };
}

/** Collect a bounded block around the matched heading line — from the
 *  heading down to the next blank-line gap or the hard cap, so the block
 *  captures the command/heading plus its immediately-following option
 *  list without pulling in unrelated scrollback. */
function collectBlock(lines: string[], headingIndex: number): string {
  const block: string[] = [];
  let blankRun = 0;
  for (let i = headingIndex; i < lines.length && block.length < MAX_BLOCK_LINES; i++) {
    const line = lines[i];
    if (isBlank(line)) {
      blankRun++;
      if (blankRun >= 2) break;
    } else {
      blankRun = 0;
    }
    block.push(line);
  }
  while (block.length > 0 && isBlank(block[block.length - 1])) block.pop();
  const text = block.join("\n");
  return text.length > MAX_SIGNAL_TEXT_LEN ? text.slice(0, MAX_SIGNAL_TEXT_LEN) : text;
}

/** A pending Codex approval request (command exec or patch apply) in the
 *  trailing text of a live embedded terminal, or `null`. */
export function extractCodexApprovalPrompt(visibleText: string): string | null {
  if (!visibleText) return null;
  const { lines } = recencyLines(visibleText);
  for (let i = lines.length - 1; i >= 0; i--) {
    if (APPROVAL_HEADING.test(lines[i])) {
      return collectBlock(lines, i);
    }
  }
  return null;
}

/** A Codex-reported structured error/turn-abort in the trailing text of a
 *  live embedded terminal, or `null`. */
export function extractCodexErrorText(visibleText: string): string | null {
  if (!visibleText) return null;
  const { lines } = recencyLines(visibleText);
  for (let i = lines.length - 1; i >= 0; i--) {
    if (ERROR_FOOTER.test(lines[i])) {
      // The error line itself is usually self-contained ("<cause>.
      // Something went wrong? Hit `/feedback` ...") — a few lines of
      // leading context in case the cause wrapped onto the prior line.
      const from = Math.max(0, i - 2);
      return collectBlock(lines, from);
    }
  }
  return null;
}
