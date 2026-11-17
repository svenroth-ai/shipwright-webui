/*
 * markdownTablePreserve.test — untouched tables survive byte-for-byte, edited
 * tables keep the original padding, `<br>` cells stay GFM
 * (iterate-2026-11-17-md-editor-table-editing).
 */
import { describe, it, expect } from "vitest";
import { Editor } from "@tiptap/react";

import { buildEditorExtensions, serializeEditorMarkdown } from "./markdownTiptap";
import { restoreUntouchedTables, padTable, extractPipeTables } from "./markdownTablePreserve";
import { tableAtCaret, validateTableSource, applyTableSource } from "./markdownTableSource";

const NL = String.fromCharCode(10);
const doc = (...l: string[]) => l.join(NL);
const mk = (md: string) => new Editor({ element: document.createElement("div"), extensions: buildEditorExtensions(), content: md });
const ser = (e: Editor) => serializeEditorMarkdown(e as unknown as { storage: object });

const PADDED = doc("| Name   | Wert |", "| ------ | ---- |", "| foo    | 1    |", "| barbaz | 22   |");

describe("table preservation", () => {
  // @covers FR-01.35
  it("an untouched padded table is restored byte-for-byte", () => {
    const text = doc("# T", "", PADDED, "", "end");
    const ed = mk(text);
    const base = ser(ed);
    expect(base).not.toContain("foo    |"); // the editor itself re-flows it
    expect(restoreUntouchedTables(text, base, ser(ed))).toBe(text);
    ed.destroy();
  });

  // @covers FR-01.35
  it("an edited table keeps the original padding; its sibling stays untouched", () => {
    const other = doc("| a | b |", "| - | - |", "| 1 | 2 |");
    const text = doc(PADDED, "", other);
    const ed = mk(text);
    const base = ser(ed);
    ed.commands.setContent(base.replace("| foo | 1 |", "| foo | 100 |"));
    const out = restoreUntouchedTables(text, base, ser(ed)).trimEnd();
    expect(out).toBe(doc("| Name   | Wert |", "| ------ | ---- |", "| foo    | 100  |", "| barbaz | 22   |", "", other));
    ed.destroy();
  });

  // @covers FR-01.35
  it("falls back to the editor output when tables cannot be paired", () => {
    expect(restoreUntouchedTables("no table", "| a |\n| - |\n| 1 |", "| a |\n| - |\n| 1 |")).toBe("| a |\n| - |\n| 1 |");
  });

  // @covers FR-01.35
  it("never drops a lazy row (no leading pipe) when restoring", () => {
    const text = doc("| a |", "|---|", "| 1 |", "foo");
    const ed = mk(text);
    const out = restoreUntouchedTables(text, ser(ed), ser(ed));
    expect(out).toContain("foo");
    ed.destroy();
  });

  // @covers FR-01.35
  it("ignores pipe tables inside code fences", () => {
    const t = doc("```", "| a |", "| - |", "```");
    expect(extractPipeTables(t)).toHaveLength(0);
  });

  // @covers FR-01.35
  it("padTable honours alignment", () => {
    expect(padTable(["| a | b |", "| :-: | --: |", "| long | 1 |"])).toEqual([
      "| a    |   b |",
      "| :--: | --: |",
      "| long |   1 |",
    ]);
  });

  // @covers FR-01.35
  it("a <br> inside a cell keeps the table a GFM pipe table", () => {
    const md = doc("| A | B |", "| --- | --- |", "| line1<br>line2 | x |");
    const ed = mk(md);
    expect(ser(ed).trimEnd()).toBe(md);
    ed.destroy();
  });
});

describe("table source editing", () => {
  // @covers FR-01.35
  it("validates a pipe table", () => {
    expect(validateTableSource("")).not.toBeNull();
    expect(validateTableSource("just text")).not.toBeNull();
    expect(validateTableSource(doc("| a | b |", "| - | - |", "| 1 |"))).toMatch(/Zeile 3/);
    expect(validateTableSource(doc("| a | b |", "| - | - |", "| 1 | 2 |"))).toBeNull();
  });

  // @covers FR-01.35
  it("replaces the caret's table with the typed source", () => {
    const ed = mk(doc("before", "", "| a | b |", "| --- | --- |", "| 1 | 2 |", "", "after"));
    let pos = -1;
    ed.state.doc.descendants((n, p) => {
      if (n.type.name === "tableCell" && pos < 0) pos = p + 2;
      return true;
    });
    ed.commands.setTextSelection(pos);
    expect(tableAtCaret(ed)?.markdown).toContain("| a | b |");
    expect(applyTableSource(ed, doc("| a | b | c |", "| --- | --- | --- |", "| 1 | 2 | 3 |"))).toBe(true);
    expect(ser(ed).trimEnd()).toBe(doc("before", "", "| a | b | c |", "| --- | --- | --- |", "| 1 | 2 | 3 |", "", "after"));
    ed.destroy();
  });
});
