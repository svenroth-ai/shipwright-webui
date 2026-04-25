/*
 * Tests for ParamField — iterate/v030-five-ux-fixes (P1 + P5).
 *
 * Coverage:
 *   - Boolean: consolidated checkbox is value AND emit-flag
 *   - String/Enum (with onEnableToggle): enable-checkbox + value-control
 *   - Required + non-boolean: "Required" badge replaces enable-checkbox
 *   - Disabled value-control gets aria-disabled + visual disabled state
 *   - Auto-helpText "If omitted: …" with default + non-sensitive
 *   - Auto-helpText omits sensitive defaults
 *   - Inline empty-hint shown when enabled + non-required + empty value
 *   - aria-describedby chains enable-checkbox to helpText
 *   - Backward-compat: no onEnableToggle → no enable-checkbox
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { ParamField } from "./ParamField";
import type { RenderableParamSchema } from "../../types/action-schema";

describe("ParamField — boolean (consolidated)", () => {
  it("renders single checkbox; checked == value", () => {
    const onChange = vi.fn();
    render(
      <ParamField
        schema={{
          name: "fix",
          label: "Auto-fix",
          type: "boolean",
        }}
        value={true}
        onChange={onChange}
      />,
    );
    const checkbox = screen
      .getByTestId("paramfield-fix")
      .querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
    fireEvent.click(checkbox);
    expect(onChange).toHaveBeenCalledWith(false);
  });

  it("does NOT render a separate enable-checkbox even when onEnableToggle is provided", () => {
    render(
      <ParamField
        schema={{ name: "fix", label: "Auto-fix", type: "boolean" }}
        value={false}
        onChange={() => {}}
        enabled={false}
        onEnableToggle={() => {}}
      />,
    );
    expect(screen.queryByTestId("paramfield-fix-enable")).toBeNull();
  });
});

describe("ParamField — string with enable-checkbox (P1)", () => {
  const SCHEMA: RenderableParamSchema = {
    name: "depth",
    label: "Crawl depth",
    type: "string",
    default: "3",
  };

  it("renders an enable-checkbox to the left of the input when onEnableToggle is provided", () => {
    render(
      <ParamField
        schema={SCHEMA}
        value=""
        onChange={() => {}}
        enabled={false}
        onEnableToggle={() => {}}
      />,
    );
    expect(screen.getByTestId("paramfield-depth-enable")).toBeTruthy();
  });

  it("disables the value input + sets aria-disabled when enabled=false", () => {
    render(
      <ParamField
        schema={SCHEMA}
        value=""
        onChange={() => {}}
        enabled={false}
        onEnableToggle={() => {}}
      />,
    );
    const input = screen
      .getByTestId("paramfield-depth")
      .querySelector("input:not([type='checkbox'])") as HTMLInputElement;
    expect(input.disabled).toBe(true);
    expect(input.getAttribute("aria-disabled")).toBe("true");
  });

  it("enables the input when enabled=true", () => {
    render(
      <ParamField
        schema={SCHEMA}
        value=""
        onChange={() => {}}
        enabled={true}
        onEnableToggle={() => {}}
      />,
    );
    const input = screen
      .getByTestId("paramfield-depth")
      .querySelector("input:not([type='checkbox'])") as HTMLInputElement;
    expect(input.disabled).toBe(false);
  });

  it("calls onEnableToggle when the enable-checkbox is clicked", () => {
    const onEnableToggle = vi.fn();
    render(
      <ParamField
        schema={SCHEMA}
        value=""
        onChange={() => {}}
        enabled={false}
        onEnableToggle={onEnableToggle}
      />,
    );
    fireEvent.click(screen.getByTestId("paramfield-depth-enable"));
    expect(onEnableToggle).toHaveBeenCalled();
  });

  it("backward-compat: omits enable-checkbox when onEnableToggle is undefined", () => {
    render(<ParamField schema={SCHEMA} value="" onChange={() => {}} />);
    expect(screen.queryByTestId("paramfield-depth-enable")).toBeNull();
    const input = screen
      .getByTestId("paramfield-depth")
      .querySelector("input") as HTMLInputElement;
    expect(input.disabled).toBe(false);
  });
});

describe("ParamField — required string renders 'Required' badge", () => {
  const SCHEMA: RenderableParamSchema = {
    name: "section",
    label: "Section",
    type: "string",
    required: true,
  };

  it("shows the Required badge instead of an enable-checkbox", () => {
    render(
      <ParamField
        schema={SCHEMA}
        value=""
        onChange={() => {}}
        enabled={true}
        onEnableToggle={() => {}}
      />,
    );
    expect(screen.getByTestId("paramfield-section-required-badge")).toBeTruthy();
    expect(screen.queryByTestId("paramfield-section-enable")).toBeNull();
  });

  it("keeps the value-control editable regardless of enabled prop", () => {
    render(
      <ParamField
        schema={SCHEMA}
        value=""
        onChange={() => {}}
        enabled={false}
        onEnableToggle={() => {}}
      />,
    );
    const input = screen
      .getByTestId("paramfield-section")
      .querySelector("input") as HTMLInputElement;
    expect(input.disabled).toBe(false);
  });
});

describe("ParamField — auto-helpText (P5)", () => {
  it("renders 'If omitted: schema default is X…' when default is set + non-sensitive + no helpText", () => {
    render(
      <ParamField
        schema={{
          name: "depth",
          label: "Crawl depth",
          type: "string",
          default: "3",
        }}
        value=""
        onChange={() => {}}
      />,
    );
    expect(
      screen.getByText(/If omitted: schema default is 3/i),
    ).toBeTruthy();
  });

  it("renders 'If omitted: skill applies its own default.' when no default is set", () => {
    render(
      <ParamField
        schema={{ name: "fix", label: "Fix", type: "boolean" }}
        value={false}
        onChange={() => {}}
      />,
    );
    expect(
      screen.getByText(/If omitted: skill applies its own default\./i),
    ).toBeTruthy();
  });

  it("does NOT expose sensitive defaults via auto-helpText", () => {
    render(
      <ParamField
        schema={{
          name: "token",
          label: "Auth token",
          type: "string",
          sensitive: true,
          default: "super-secret-default",
        }}
        value=""
        onChange={() => {}}
        revealed={false}
        onRevealToggle={() => {}}
      />,
    );
    // The default value must not appear in any rendered text.
    expect(screen.queryByText(/super-secret-default/i)).toBeNull();
  });

  it("does NOT add auto-helpText for required fields", () => {
    render(
      <ParamField
        schema={{
          name: "section",
          label: "Section",
          type: "string",
          required: true,
          default: "x.md",
        }}
        value=""
        onChange={() => {}}
      />,
    );
    expect(screen.queryByText(/If omitted/i)).toBeNull();
  });

  it("explicit helpText takes precedence over auto-helpText", () => {
    render(
      <ParamField
        schema={{
          name: "depth",
          label: "Crawl depth",
          type: "string",
          default: "3",
          helpText: "Max depth for crawling",
        }}
        value=""
        onChange={() => {}}
      />,
    );
    expect(screen.getByText("Max depth for crawling")).toBeTruthy();
    expect(screen.queryByText(/If omitted/i)).toBeNull();
  });
});

describe("ParamField — empty-hint when enabled + non-required + blank", () => {
  const SCHEMA: RenderableParamSchema = {
    name: "url",
    label: "URL",
    type: "string",
  };

  it("shows hint when enabled+empty (non-required)", () => {
    render(
      <ParamField
        schema={SCHEMA}
        value=""
        onChange={() => {}}
        enabled={true}
        onEnableToggle={() => {}}
      />,
    );
    expect(screen.getByTestId("paramfield-url-empty-hint")).toBeTruthy();
  });

  it("hides hint when enabled+filled", () => {
    render(
      <ParamField
        schema={SCHEMA}
        value="https://example.com"
        onChange={() => {}}
        enabled={true}
        onEnableToggle={() => {}}
      />,
    );
    expect(screen.queryByTestId("paramfield-url-empty-hint")).toBeNull();
  });

  it("hides hint when disabled", () => {
    render(
      <ParamField
        schema={SCHEMA}
        value=""
        onChange={() => {}}
        enabled={false}
        onEnableToggle={() => {}}
      />,
    );
    expect(screen.queryByTestId("paramfield-url-empty-hint")).toBeNull();
  });

  it("hides hint for required fields", () => {
    render(
      <ParamField
        schema={{ ...SCHEMA, required: true }}
        value=""
        onChange={() => {}}
      />,
    );
    expect(screen.queryByTestId("paramfield-url-empty-hint")).toBeNull();
  });
});

describe("ParamField — a11y", () => {
  it("aria-describedby on enable-checkbox references the helpText id", () => {
    render(
      <ParamField
        schema={{
          name: "depth",
          label: "Crawl depth",
          type: "string",
          default: "3",
        }}
        value=""
        onChange={() => {}}
        enabled={false}
        onEnableToggle={() => {}}
      />,
    );
    const enableCheckbox = screen.getByTestId(
      "paramfield-depth-enable",
    ) as HTMLInputElement;
    const describedBy = enableCheckbox.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    // The helpText element with that id should exist.
    expect(document.getElementById(describedBy!)).toBeTruthy();
  });
});
