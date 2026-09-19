// Shell-specific argument escaping for the three launch shells (PowerShell,
// cmd.exe, POSIX).
//
// Extracted from launcher.ts (iterate-2026-06-27-codeql-hardening) to keep that
// file under the 300-LOC limit and make the quoters independently testable.
// `core/actions-substitute.ts` calls them per target shell before substituting
// user-derived placeholders into command templates; the shell-escape discipline
// is the security boundary for command-template substitution (plan.md § 2.2).
// launcher.ts re-exports these, so existing `from "./launcher.js"` importers
// keep working. Do not move this logic behind a different abstraction without
// updating `actions-substitute.ts`.

export function qPs(v: string): string {
  // PS single-quoted: embedded `'` → `''`.
  return `'${v.replace(/'/g, "''")}'`;
}

/**
 * PowerShell arg-quoting for text that may contain embedded newlines
 * (multi-paragraph prompts) — used where `qPs()` alone is not safe.
 *
 * `qPs()` produces syntactically correct PowerShell (the tokenizer is
 * quote-aware and does not get confused by content inside an open single-
 * quoted string), but that is not sufficient here: PSReadLine (PowerShell 7)
 * maintains its OWN multi-line edit buffer as input arrives, and when that
 * input is delivered via pty keystroke injection (not a real interactive
 * paste event) rather than typed by a human, a literal newline inside the
 * still-open quoted string can corrupt that buffer — a trailing fragment of
 * the string then gets parsed and executed as its own bare command once
 * Enter is finally processed. Reproduced live against a real pwsh.exe pty
 * (iterate-2026-09-19-codex-launch-powershell-chunk); confirmed independent
 * of write-chunking (fails identically via one atomic `pty.write()`) and
 * independent of bracketed-paste wrapping (PS7's bracketed-paste handling
 * does not prevent it either) — the only thing that avoided it was removing
 * every literal newline from the bytes actually sent to the pty.
 *
 * A value with no `\r`/`\n` takes the plain `qPs()` path unchanged (stays
 * human-readable for manual copy/paste). A value containing either is
 * Base64-encoded — the encoded text itself has no `\r`/`\n` by construction
 * (RFC 4648 alphabet) — and wrapped in a PowerShell sub-expression that
 * decodes it back to the exact original string at parse time, before the
 * command it's embedded in ever runs. `$(...)` around a native-command
 * argument passes its result as ONE argument regardless of embedded
 * whitespace, so this is transparent to the receiving process.
 */
export function qPsMultiline(v: string): string {
  if (!/[\r\n]/.test(v)) return qPs(v);
  const b64 = Buffer.from(v, "utf8").toString("base64");
  return `$([System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String(${qPs(b64)})))`;
}

export function qCmd(v: string): string {
  // cmd.exe double-quoted argument, escaped per CommandLineToArgvW (the prior
  // `"${v.replace(/"/g,'\\"')}"` left backslashes unescaped — CodeQL
  // js/incomplete-sanitization #4): N `\` before an embedded `"` → 2N+1 `\`+`"`;
  // N `\` before the CLOSING quote → 2N `\` (a trailing `\` can't escape it);
  // `\` not before a quote stays literal (`C:\foo` must not become `C:\\foo`).
  // Argv layer only; cmd.exe metachar handling is out of scope on this
  // loopback tool (inputs aren't cross-user-trust; `qPs` is the default shell).
  let out = '"';
  let pendingBackslashes = 0;
  for (const ch of v) {
    if (ch === "\\") {
      pendingBackslashes += 1;
      continue;
    }
    if (ch === '"') {
      out += "\\".repeat(pendingBackslashes * 2 + 1) + '"';
    } else {
      out += "\\".repeat(pendingBackslashes) + ch;
    }
    pendingBackslashes = 0;
  }
  out += "\\".repeat(pendingBackslashes * 2) + '"';
  return out;
}

export function qPosix(v: string): string {
  // POSIX single-quoted: `'` → `'\''`.
  return `'${v.replace(/'/g, "'\\''")}'`;
}

export function toPosixPath(p: string): string {
  return p.replace(/\\/g, "/");
}
