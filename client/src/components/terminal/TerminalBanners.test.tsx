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

/*
 * iterate-2026-08-14-terminal-launch-preview-height — a long `new-iterate`
 * launch command (task description substituted into a single-line command,
 * observed at 5341 chars against the real production trg-c57bec15 report)
 * makes the previewCommand/manualSendCommand banners wrap to 1000+px tall.
 * As a flex-column sibling ahead of the xterm canvas div (min-h-0 flex-1),
 * an uncapped banner squeezes the canvas to 0 height — isMeasurableTerminalContainer
 * (width>0 && height>0) then never passes, so the pre-dispatch resize retry
 * loop in useAutoLaunch.ts spins until timeout and the launch command is
 * NEVER sent to the pty. jsdom does not compute real flex layout (no box
 * model), so this asserts the CSS class fence (max-height + overflow) that
 * bounds the banner's rendered size regardless of content length; the real
 * end-to-end geometry is covered by a Playwright spec (real browser layout).
 */
describe("TerminalBanners — long-command preview/manual-send banners stay height-capped (iterate-2026-08-14)", () => {
  const LONG_COMMAND = `claude --session-id abc --name x ${"y".repeat(5300)}`;

  it("previewCommand banner carries a max-height + overflow-y class fence regardless of command length", () => {
    const { container } = render(
      <TerminalBanners {...makeProps({ previewCommand: LONG_COMMAND })} />,
    );
    const el = container.querySelector(
      '[data-testid="embedded-terminal-launch-preview"]',
    );
    expect(el).not.toBeNull();
    expect(el?.className).toMatch(/max-h-\d+/);
    expect(el?.className).toMatch(/overflow-y-auto/);
    // shrink-0: the banner must never be squeezed to a fractional/zero
    // height under flexbox arithmetic either — it needs a firm cap, not a
    // negotiable one.
    expect(el?.className).toMatch(/shrink-0/);
  });

  it("manualSendCommand banner carries a max-height + overflow-y class fence regardless of command length", () => {
    const { container } = render(
      <TerminalBanners {...makeProps({ manualSendCommand: LONG_COMMAND })} />,
    );
    const el = container.querySelector(
      '[data-testid="embedded-terminal-manual-send"]',
    );
    expect(el).not.toBeNull();
    expect(el?.className).toMatch(/max-h-\d+/);
    expect(el?.className).toMatch(/overflow-y-auto/);
    expect(el?.className).toMatch(/shrink-0/);
  });

  it("a short previewCommand still renders the full text (no truncation of normal-length commands)", () => {
    const short = "claude --session-id abc --name x --add-dir .";
    const { container } = render(
      <TerminalBanners {...makeProps({ previewCommand: short })} />,
    );
    const el = container.querySelector(
      '[data-testid="embedded-terminal-launch-preview"]',
    );
    expect(el?.textContent).toContain(short);
  });
});

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
