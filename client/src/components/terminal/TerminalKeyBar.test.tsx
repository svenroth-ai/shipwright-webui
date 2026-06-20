import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { TerminalKeyBar, terminalKeySequence } from "./TerminalKeyBar";

function mockPointer(coarse: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: query === "(pointer: coarse)" ? coarse : false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

describe("terminalKeySequence", () => {
  it("maps the non-arrow keys to fixed control bytes", () => {
    expect(terminalKeySequence("esc", false)).toBe("\x1b");
    expect(terminalKeySequence("tab", false)).toBe("\t");
    expect(terminalKeySequence("ctrlc", false)).toBe("\x03");
    expect(terminalKeySequence("enter", false)).toBe("\r");
  });

  it("emits CSI arrows in normal-buffer (applicationCursorKeysMode=false)", () => {
    expect(terminalKeySequence("up", false)).toBe("\x1b[A");
    expect(terminalKeySequence("down", false)).toBe("\x1b[B");
    expect(terminalKeySequence("right", false)).toBe("\x1b[C");
    expect(terminalKeySequence("left", false)).toBe("\x1b[D");
  });

  it("emits SS3 arrows in application-cursor mode (Claude's alt-screen TUI)", () => {
    expect(terminalKeySequence("up", true)).toBe("\x1bOA");
    expect(terminalKeySequence("down", true)).toBe("\x1bOB");
    expect(terminalKeySequence("right", true)).toBe("\x1bOC");
    expect(terminalKeySequence("left", true)).toBe("\x1bOD");
  });
});

describe("<TerminalKeyBar>", () => {
  afterEach(() => vi.restoreAllMocks());

  it("renders nothing on a fine-pointer (desktop) device", () => {
    mockPointer(false);
    const { container } = render(
      <TerminalKeyBar onKey={vi.fn()} onFocusTerminal={vi.fn()} />,
    );
    expect(container.querySelector('[data-testid="terminal-key-bar"]')).toBeNull();
  });

  it("renders the bar on a coarse-pointer (touch) device", () => {
    mockPointer(true);
    render(<TerminalKeyBar onKey={vi.fn()} onFocusTerminal={vi.fn()} />);
    expect(screen.getByTestId("terminal-key-bar")).toBeInTheDocument();
    // The keys Claude's TUI needs are all present.
    for (const id of ["esc", "tab", "ctrlc", "up", "down", "left", "right", "enter"]) {
      expect(screen.getByTestId(`terminal-key-${id}`)).toBeInTheDocument();
    }
  });

  it("calls onKey with the semantic id when a control key is tapped", () => {
    mockPointer(true);
    const onKey = vi.fn();
    render(<TerminalKeyBar onKey={onKey} onFocusTerminal={vi.fn()} />);
    fireEvent.click(screen.getByTestId("terminal-key-esc"));
    fireEvent.click(screen.getByTestId("terminal-key-up"));
    expect(onKey).toHaveBeenNthCalledWith(1, "esc");
    expect(onKey).toHaveBeenNthCalledWith(2, "up");
  });

  it("the ⌨ button summons the keyboard via onFocusTerminal (not onKey)", () => {
    mockPointer(true);
    const onKey = vi.fn();
    const onFocusTerminal = vi.fn();
    render(<TerminalKeyBar onKey={onKey} onFocusTerminal={onFocusTerminal} />);
    fireEvent.click(screen.getByTestId("terminal-key-keyboard"));
    expect(onFocusTerminal).toHaveBeenCalledTimes(1);
    expect(onKey).not.toHaveBeenCalled();
  });

  it("disables the control keys for the read-only reader role", () => {
    mockPointer(true);
    const onKey = vi.fn();
    render(<TerminalKeyBar onKey={onKey} onFocusTerminal={vi.fn()} disabled />);
    expect(screen.getByTestId("terminal-key-enter")).toBeDisabled();
    fireEvent.click(screen.getByTestId("terminal-key-enter"));
    expect(onKey).not.toHaveBeenCalled();
  });

  it("prevents default on pointer-down so it never steals focus from xterm", () => {
    mockPointer(true);
    render(<TerminalKeyBar onKey={vi.fn()} onFocusTerminal={vi.fn()} />);
    const ev = fireEvent.pointerDown(screen.getByTestId("terminal-key-esc"));
    // fireEvent returns false when a handler called preventDefault().
    expect(ev).toBe(false);
  });

  it("keys carry a white border + white text for legibility (AC-2)", () => {
    mockPointer(true);
    render(<TerminalKeyBar onKey={vi.fn()} onFocusTerminal={vi.fn()} />);
    for (const id of ["keyboard", "esc", "up", "enter"]) {
      const cls = screen.getByTestId(`terminal-key-${id}`).className;
      expect(cls).toContain("border");
      expect(cls).toContain("border-white/80");
      expect(cls).toContain("text-white");
      // The old low-contrast grey token must be gone.
      expect(cls).not.toContain("text-[var(--color-text,#e5e5e5)]");
    }
  });

  it("the read-only reader keys stay visibly muted (AC-2 — disabled dims the white border+glyph)", () => {
    mockPointer(true);
    render(<TerminalKeyBar onKey={vi.fn()} onFocusTerminal={vi.fn()} disabled />);
    const esc = screen.getByTestId("terminal-key-esc");
    expect(esc).toBeDisabled();
    // `disabled:opacity-40` dims the brighter white border + glyph for the
    // reader role, so the new high-contrast styling doesn't make a read-only
    // bar look interactive.
    expect(esc.className).toContain("disabled:opacity-40");
  });
});
