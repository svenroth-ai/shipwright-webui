/*
 * Shared clipboard-copy helper.
 *
 * resume-cta-rework (2026-05-16) — extracted from TaskDetailHeader's
 * private `writeClipboard`. Two consumers: "Copy session UUID" and
 * "Copy Resume command", both fired from a Radix DropdownMenu.Item.
 *
 * Two failure modes this closes:
 *   1. The caller MUST `await` and handle rejection. The prior
 *      `writeClipboard` sat behind a silent `catch {}` at the call
 *      site, so a failed copy looked identical to a successful one —
 *      the user clicked and nothing happened ("Copy doesn't work").
 *      `copyText` rejects with a descriptive Error; callers surface it.
 *   2. The `execCommand` textarea fallback must run with NO active
 *      focus-trap. A Radix `DropdownMenu.Content` traps focus; calling
 *      `textarea.focus()` while the menu is open loses the race to
 *      Radix's focus-scope — the selection ends up empty and
 *      `execCommand('copy')` copies nothing. Callers therefore fire
 *      `copyText` only AFTER the menu has closed (from `onSelect`
 *      WITHOUT `event.preventDefault()`, deferred via
 *      `requestAnimationFrame`).
 */

/**
 * Copy `text` to the clipboard. Resolves on success; rejects with a
 * descriptive `Error` when every available path fails — callers MUST
 * surface that rejection (no silent swallow).
 */
export async function copyText(text: string): Promise<void> {
  // Modern async Clipboard API — the primary path. Needs a secure
  // context + transient activation; both hold when called from a click
  // handler on localhost.
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch (err) {
      // Fall through to the legacy path — e.g. a VS Code Simple Browser
      // webview where the async Clipboard API is proxied or denied.
      // eslint-disable-next-line no-console
      console.warn(
        "[clipboard] navigator.clipboard.writeText failed, trying execCommand:",
        err instanceof Error ? err.message : String(err),
      );
    }
  }
  // Legacy execCommand path. Reliable only with no focus-trap active
  // (see the file header) — callers defer until the menu has closed.
  if (typeof document === "undefined") {
    throw new Error("clipboard unavailable: no document");
  }
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.style.position = "fixed";
  ta.style.top = "0";
  ta.style.left = "-9999px";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  try {
    ta.focus();
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand("copy");
    if (!ok) {
      throw new Error("execCommand('copy') returned false");
    }
  } finally {
    document.body.removeChild(ta);
  }
}
