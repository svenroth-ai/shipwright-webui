/*
 * TerminalBanners.test.tsx — iterate-2026-06-02-terminal-idle-attachment-gate
 *
 * AC6 (resume-safety): when the terminal-reset banner shows AND the task has
 * scrollback history, a data-loss-aware note must appear — `claude --resume`
 * rebuilds from the JSONL, so on-screen content the suspended session had
 * not yet persisted may not return; the last screen survives in scrollback.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";

import { TerminalBanners, type TerminalBannersProps } from "./TerminalBanners";

afterEach(cleanup);

function makeProps(overrides: Partial<TerminalBannersProps> = {}): TerminalBannersProps {
  return {
    reconnecting: false,
    reconnectStalled: false,
    readOnly: false,
    showResetBanner: false,
    resetScrollbackBytes: null,
    onDismissResetBanner: vi.fn(),
    replayOnly: false,
    previewCommand: null,
    manualSendCommand: null,
    onManualSend: vi.fn(),
    onDismissManualSend: vi.fn(),
    clipboardNotice: null,
    onDismissClipboardNotice: vi.fn(),
    ...overrides,
  };
}

const DATALOSS = '[data-testid="embedded-terminal-reset-dataloss"]';
const RESET = '[data-testid="embedded-terminal-reset"]';
const RECONNECTING = '[data-testid="embedded-terminal-reconnecting"]';

describe("TerminalBanners — reset-banner resume data-loss note (AC6)", () => {
  it("renders the data-loss note when reset is shown and scrollback exists", () => {
    const { container } = render(
      <TerminalBanners
        {...makeProps({ showResetBanner: true, resetScrollbackBytes: 4096 })}
      />,
    );
    expect(container.querySelector(RESET)).not.toBeNull();
    const note = container.querySelector(DATALOSS);
    expect(note).not.toBeNull();
    expect(note?.textContent).toMatch(/saved transcript/i);
    expect(note?.textContent).toMatch(/scrollback/i);
  });

  it("omits the data-loss note when there is no scrollback (bytes = 0)", () => {
    const { container } = render(
      <TerminalBanners
        {...makeProps({ showResetBanner: true, resetScrollbackBytes: 0 })}
      />,
    );
    expect(container.querySelector(RESET)).not.toBeNull(); // banner still shows
    expect(container.querySelector(DATALOSS)).toBeNull();
  });

  it("omits the data-loss note while scrollback bytes are unknown (null)", () => {
    const { container } = render(
      <TerminalBanners
        {...makeProps({ showResetBanner: true, resetScrollbackBytes: null })}
      />,
    );
    expect(container.querySelector(DATALOSS)).toBeNull();
  });

  it("renders neither the reset banner nor the note when reset is not shown", () => {
    const { container } = render(
      <TerminalBanners
        {...makeProps({ showResetBanner: false, resetScrollbackBytes: 4096 })}
      />,
    );
    expect(container.querySelector(RESET)).toBeNull();
    expect(container.querySelector(DATALOSS)).toBeNull();
  });
});

/*
 * AC-5 (iterate-2026-07-21-mac-sleep-terminal-frozen) — a dead socket must read
 * as "disconnected, coming back" instead of a silently frozen terminal.
 */
describe("TerminalBanners — reconnecting banner (AC-5)", () => {
  it("renders while reconnecting and tells the user not to reload", () => {
    const { container } = render(
      <TerminalBanners {...makeProps({ reconnecting: true })} />,
    );
    const el = container.querySelector(RECONNECTING);
    expect(el).not.toBeNull();
    // The reload advice is the whole point — the reporter's workaround was a
    // tab refresh, which is exactly what should no longer be necessary.
    expect(el?.textContent).toMatch(/not needed/i);
  });

  it("softens the copy once the outage stops looking transient", () => {
    const { container } = render(
      <TerminalBanners
        {...makeProps({ reconnecting: true, reconnectStalled: true })}
      />,
    );
    const el = container.querySelector(RECONNECTING);
    expect(el).not.toBeNull();
    expect(el).toHaveAttribute("data-stalled", "true");
    // It must STOP asserting the session is fine: a deleted task cwd is
    // refused deterministically and would never come back (code review MED).
    expect(el?.textContent).not.toMatch(/not needed/i);
    expect(el?.textContent).toMatch(/may be unreachable|no longer exist/i);
  });

  it("is absent when the socket is healthy", () => {
    const { container } = render(
      <TerminalBanners {...makeProps({ reconnecting: false })} />,
    );
    expect(container.querySelector(RECONNECTING)).toBeNull();
  });

  it("renders ABOVE the read-only banner — no connection outranks role", () => {
    const { container } = render(
      <TerminalBanners {...makeProps({ reconnecting: true, readOnly: true })} />,
    );
    const rc = container.querySelector(RECONNECTING);
    const ro = container.querySelector('[data-testid="embedded-terminal-readonly"]');
    expect(rc).not.toBeNull();
    expect(ro).not.toBeNull();
    // DOCUMENT_POSITION_FOLLOWING === 4 → `ro` comes after `rc`.
    expect(rc!.compareDocumentPosition(ro!)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });
});
