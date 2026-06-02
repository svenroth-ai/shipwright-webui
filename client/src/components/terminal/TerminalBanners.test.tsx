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
    readOnly: false,
    showResetBanner: false,
    resetScrollbackBytes: null,
    onDismissResetBanner: vi.fn(),
    replayOnly: false,
    previewCommand: null,
    manualSendCommand: null,
    onManualSend: vi.fn(),
    onDismissManualSend: vi.fn(),
    mouseEventsActive: false,
    bannerDismissed: false,
    onDismissMouseHint: vi.fn(),
    clipboardNotice: null,
    onDismissClipboardNotice: vi.fn(),
    ...overrides,
  };
}

const DATALOSS = '[data-testid="embedded-terminal-reset-dataloss"]';
const RESET = '[data-testid="embedded-terminal-reset"]';

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
