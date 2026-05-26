/*
 * Pure-helper tests for paramHelpers (paramsToPreview, explicitParamEntries).
 * Step 3.5 review OpenAI #11: assert sensitive params never leak into the
 * launch payload when disabled.
 */

import { describe, it, expect } from "vitest";

import { explicitParamEntries, paramsToPreview } from "./paramHelpers";
import type { RenderableParamSchema } from "../../../types/action-schema";

describe("paramsToPreview", () => {
  it("boolean param: emits cli_flag when value === true", () => {
    const schema: RenderableParamSchema[] = [
      { name: "fix", label: "Fix", type: "boolean", cli_flag: "--fix" },
    ];
    expect(paramsToPreview(schema, { fix: true }, {})).toEqual([
      { cli_flag: "--fix", separator: "none" },
    ]);
  });

  it("boolean param: drops emission when value !== true", () => {
    const schema: RenderableParamSchema[] = [
      { name: "fix", label: "Fix", type: "boolean", cli_flag: "--fix" },
    ];
    expect(paramsToPreview(schema, { fix: false }, {})).toEqual([]);
    expect(paramsToPreview(schema, {}, {})).toEqual([]);
  });

  it("string param: drops when enabled=false", () => {
    const schema: RenderableParamSchema[] = [
      { name: "depth", label: "Depth", type: "string", cli_flag: "--depth" },
    ];
    expect(
      paramsToPreview(schema, { depth: "3" }, { depth: false }),
    ).toEqual([]);
  });

  it("string param: drops when enabled=true but value is empty", () => {
    const schema: RenderableParamSchema[] = [
      { name: "depth", label: "Depth", type: "string", cli_flag: "--depth" },
    ];
    expect(paramsToPreview(schema, { depth: "" }, { depth: true })).toEqual(
      [],
    );
    expect(paramsToPreview(schema, { depth: "   " }, { depth: true })).toEqual(
      [],
    );
  });

  it("string param: emits cli_flag + trimmed value when enabled + non-empty", () => {
    const schema: RenderableParamSchema[] = [
      {
        name: "depth",
        label: "Depth",
        type: "string",
        cli_flag: "--depth",
        value_separator: "space",
      },
    ];
    expect(
      paramsToPreview(schema, { depth: "  5  " }, { depth: true }),
    ).toEqual([
      { cli_flag: "--depth", value: "5", separator: "space" },
    ]);
  });

  it("required string param: emits without explicit enable=true (modal seeds it)", () => {
    const schema: RenderableParamSchema[] = [
      {
        name: "section",
        label: "Section",
        type: "string",
        cli_flag: "--section",
        required: true,
      },
    ];
    expect(paramsToPreview(schema, { section: "ok" }, {})).toEqual([
      { cli_flag: "--section", value: "ok", separator: "space" },
    ]);
  });
});

describe("explicitParamEntries", () => {
  it("boolean true → forwarded", () => {
    const schema: RenderableParamSchema[] = [
      { name: "fix", label: "Fix", type: "boolean" },
    ];
    expect(explicitParamEntries(schema, { fix: true }, {})).toEqual({
      fix: true,
    });
  });

  it("boolean false/undefined → dropped", () => {
    const schema: RenderableParamSchema[] = [
      { name: "fix", label: "Fix", type: "boolean" },
    ];
    expect(explicitParamEntries(schema, { fix: false }, {})).toEqual({});
    expect(explicitParamEntries(schema, {}, {})).toEqual({});
  });

  it("string + enabled=true + non-empty → trimmed value forwarded", () => {
    const schema: RenderableParamSchema[] = [
      { name: "depth", label: "Depth", type: "string" },
    ];
    expect(
      explicitParamEntries(schema, { depth: "  5 " }, { depth: true }),
    ).toEqual({ depth: "5" });
  });

  it("sensitive disabled → not forwarded (Step 3.5 OpenAI #11)", () => {
    const schema: RenderableParamSchema[] = [
      {
        name: "token",
        label: "Token",
        type: "string",
        sensitive: true,
      },
    ];
    expect(
      explicitParamEntries(
        schema,
        { token: "secret-123" },
        { token: false },
      ),
    ).toEqual({});
  });
});
