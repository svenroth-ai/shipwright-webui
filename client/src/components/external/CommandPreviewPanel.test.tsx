/*
 * Tests for CommandPreviewPanel — focuses on the iterate/preview-params-render
 * follow-up: parameters appear in the preview, sensitive values mask with
 * a fixed-length placeholder, and a "Show secrets" toggle reveals on demand
 * (clipboard text always carries cleartext).
 */

import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";

import {
  CommandPreviewPanel,
  type PreviewParam,
} from "./CommandPreviewPanel";

const BASE_PROPS = {
  mode: "new-task" as const,
  title: "Adopt project",
  description: "",
  projectPath: "/tmp/demo",
  sessionUuid: "00000000-0000-0000-0000-000000000001",
  phaseId: "adopt",
  phaseLabel: "Adopt",
  // debounceMs=0 so we don't have to advance fake timers in every test.
  debounceMs: 0,
};

describe("CommandPreviewPanel — parameters rendering", () => {
  it("renders nothing extra when parameters is undefined or empty", () => {
    render(<CommandPreviewPanel {...BASE_PROPS} />);
    const panel = screen.getByTestId("command-preview-panel");
    expect(panel.textContent).toContain("/shipwright-adopt");
    // No param-specific flags appear (only the base scaffold does).
    expect(panel.textContent).not.toContain("--dry-run");
    expect(panel.textContent).not.toContain("--scope");
    // No reveal toggle when there are no sensitive params.
    expect(screen.queryByTestId("command-preview-reveal")).toBeNull();
  });

  it("renders a single boolean flag", () => {
    const params: PreviewParam[] = [
      { cli_flag: "--dry-run", separator: "none" },
    ];
    render(<CommandPreviewPanel {...BASE_PROPS} parameters={params} />);
    const panel = screen.getByTestId("command-preview-panel");
    expect(panel.textContent).toContain("--dry-run");
  });

  it("renders space separator with value", () => {
    const params: PreviewParam[] = [
      { cli_flag: "--scope", value: "library", separator: "space" },
    ];
    render(<CommandPreviewPanel {...BASE_PROPS} parameters={params} />);
    expect(screen.getByTestId("command-preview-panel").textContent).toContain(
      "--scope library",
    );
  });

  it("renders equals separator", () => {
    const params: PreviewParam[] = [
      { cli_flag: "--key", value: "x", separator: "equals" },
    ];
    render(<CommandPreviewPanel {...BASE_PROPS} parameters={params} />);
    expect(screen.getByTestId("command-preview-panel").textContent).toContain(
      "--key=x",
    );
  });

  it("renders none separator without space (positional @<file>)", () => {
    const params: PreviewParam[] = [
      { cli_flag: "@", value: "planning/03.md", separator: "none" },
    ];
    render(<CommandPreviewPanel {...BASE_PROPS} parameters={params} />);
    const text = screen.getByTestId("command-preview-panel").textContent ?? "";
    expect(text).toContain("@planning/03.md");
    expect(text).not.toMatch(/@ planning/);
  });

  it("preserves declared parameter order", () => {
    const params: PreviewParam[] = [
      { cli_flag: "@", value: "planning/03.md", separator: "none" },
      { cli_flag: "--from", value: "03", separator: "space" },
    ];
    render(<CommandPreviewPanel {...BASE_PROPS} parameters={params} />);
    const text = screen.getByTestId("command-preview-panel").textContent ?? "";
    const atIdx = text.indexOf("@planning/03.md");
    const fromIdx = text.indexOf("--from 03");
    expect(atIdx).toBeGreaterThan(-1);
    expect(fromIdx).toBeGreaterThan(atIdx);
  });
});

describe("CommandPreviewPanel — sensitive masking", () => {
  const SENSITIVE_PARAMS: PreviewParam[] = [
    {
      cli_flag: "--crawl-auth-token",
      value: "supersecret_TOKEN_12345",
      separator: "space",
      sensitive: true,
    },
  ];

  it("masks sensitive value with fixed-length 8-char placeholder by default", () => {
    render(<CommandPreviewPanel {...BASE_PROPS} parameters={SENSITIVE_PARAMS} />);
    const text = screen.getByTestId("command-preview-panel").textContent ?? "";
    expect(text).toContain("--crawl-auth-token ********");
    expect(text).not.toContain("supersecret_TOKEN_12345");
  });

  it("renders a 'Show secrets' toggle when at least one sensitive param exists", () => {
    render(<CommandPreviewPanel {...BASE_PROPS} parameters={SENSITIVE_PARAMS} />);
    expect(screen.getByTestId("command-preview-reveal")).toBeTruthy();
  });

  it("toggle reveals cleartext value on click", async () => {
    render(<CommandPreviewPanel {...BASE_PROPS} parameters={SENSITIVE_PARAMS} />);
    await act(async () => {
      fireEvent.click(screen.getByTestId("command-preview-reveal"));
    });
    const text = screen.getByTestId("command-preview-panel").textContent ?? "";
    expect(text).toContain("supersecret_TOKEN_12345");
    expect(text).not.toContain("--crawl-auth-token ********");
  });

  it("toggle re-collapses on second click", async () => {
    render(<CommandPreviewPanel {...BASE_PROPS} parameters={SENSITIVE_PARAMS} />);
    const btn = screen.getByTestId("command-preview-reveal");
    await act(async () => {
      fireEvent.click(btn);
    });
    await act(async () => {
      fireEvent.click(btn);
    });
    const text = screen.getByTestId("command-preview-panel").textContent ?? "";
    expect(text).toContain("--crawl-auth-token ********");
    expect(text).not.toContain("supersecret_TOKEN_12345");
  });

  it("non-sensitive params are never masked even when reveal is off", () => {
    const mixed: PreviewParam[] = [
      { cli_flag: "--scope", value: "library", separator: "space" },
      ...SENSITIVE_PARAMS,
    ];
    render(<CommandPreviewPanel {...BASE_PROPS} parameters={mixed} />);
    const text = screen.getByTestId("command-preview-panel").textContent ?? "";
    expect(text).toContain("--scope library");
    expect(text).toContain("--crawl-auth-token ********");
  });

  it("mask length is fixed (8 chars) regardless of original token length", () => {
    const short: PreviewParam[] = [
      { cli_flag: "--t", value: "abc", separator: "space", sensitive: true },
    ];
    const long: PreviewParam[] = [
      {
        cli_flag: "--t",
        value: "a".repeat(200),
        separator: "space",
        sensitive: true,
      },
    ];
    const { unmount } = render(
      <CommandPreviewPanel {...BASE_PROPS} parameters={short} />,
    );
    const shortText =
      screen.getByTestId("command-preview-panel").textContent ?? "";
    unmount();
    render(<CommandPreviewPanel {...BASE_PROPS} parameters={long} />);
    const longText =
      screen.getByTestId("command-preview-panel").textContent ?? "";
    // Both masked sequences are exactly "********" (8 chars).
    expect(shortText).toContain("--t ********");
    expect(longText).toContain("--t ********");
    // Length-leak guard: short and long produce identical mask substrings.
    expect(shortText.match(/\*+/)?.[0]).toBe("********");
    expect(longText.match(/\*+/)?.[0]).toBe("********");
  });
});

describe("CommandPreviewPanel — title escaping (CodeQL js/incomplete-sanitization)", () => {
  it("escapes a backslash before a quote in the --name title so it can't slip the closing quote", () => {
    // title `a"b\c` → `"` becomes \" and `\` becomes \\, so the preview shows
    // a\"b\\c. The old code escaped only the quote, leaving the backslash.
    render(<CommandPreviewPanel {...BASE_PROPS} title={'a"b\\c'} />);
    const text = screen.getByTestId("command-preview-panel").textContent ?? "";
    expect(text).toContain('a\\"b\\\\c');
  });
});
