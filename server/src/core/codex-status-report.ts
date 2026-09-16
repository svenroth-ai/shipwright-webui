/*
 * core/codex-status-report.ts — §5.4's structured self-report parser.
 *
 * Every Codex launch prompt (`launcher-codex.ts buildCodexPrompt`) ends
 * with an instruction to close with a fenced ```SHIPWRIGHT-STATUS {json}```
 * block. §5.4 (hard v1 scope, not an "Open item"): "Parsed from terminal
 * scrollback, cross-checked against the oracle verdict: agreement raises
 * confidence; disagreement always defers to the oracle. This gives
 * `no_oracle` phases a real, if weaker, signal."
 *
 * Pure parser — no I/O. `CodexTaskWatcher` reads the terminal text (via
 * `PtyManager.peekTerminalText`'s visible-viewport snapshot, the same
 * mechanism `appendCodexTerminalSignals` already uses for approval-request
 * detection) and hands it here.
 */

export interface ShipwrightStatusReport {
  phase: string;
  done: boolean;
}

// Matches the exact fence `buildCodexPrompt` instructs Codex to emit. Global
// so a viewport containing more than one report (e.g. an earlier nudge's
// echoed instruction text plus a real closing report) is fully scanned —
// the LAST well-formed match wins, since that's the most recent status.
const FENCE_RE = /```SHIPWRIGHT-STATUS\s*\r?\n([\s\S]*?)```/g;

export function parseShipwrightStatusReport(text: string): ShipwrightStatusReport | null {
  let match: RegExpExecArray | null;
  let last: ShipwrightStatusReport | null = null;
  FENCE_RE.lastIndex = 0;
  while ((match = FENCE_RE.exec(text)) !== null) {
    try {
      const parsed: unknown = JSON.parse(match[1].trim());
      if (parsed && typeof parsed === "object" && typeof (parsed as Record<string, unknown>).done === "boolean") {
        const p = parsed as Record<string, unknown>;
        last = { phase: typeof p.phase === "string" ? p.phase : "", done: p.done as boolean };
      }
    } catch {
      // Malformed block (truncated viewport, stray backticks in unrelated
      // output) — skip it and keep scanning for an earlier well-formed one.
    }
  }
  return last;
}
