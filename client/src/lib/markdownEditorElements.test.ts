/*
 * markdownEditorElements.test — every Markdown element through the SmartViewer
 * editor round trip (iterate-2026-11-12-smartviewer-editor-md-roundtrip, FR-01.35).
 *
 * Contract: a document written in the editor's canonical Markdown form comes
 * back BYTE-IDENTICAL (modulo the trailing newline the envelope re-attaches),
 * and serializing is idempotent. Before this iterate a table was flattened to
 * its cell text, an image dropped, `- [x]` escaped and a long fence shortened.
 */

import { describe, it, expect } from "vitest";
import { Editor } from "@tiptap/react";

import { buildEditorExtensions, serializeEditorMarkdown } from "./markdownTiptap";
import { longestBacktickRun, setColumnAlign } from "./markdownEditorNodes";

const NL = String.fromCharCode(10);
const doc = (...lines: string[]) => lines.join(NL);

function makeEditor(md: string): Editor {
  return new Editor({ element: document.createElement("div"), extensions: buildEditorExtensions(), content: md });
}
function ser(editor: Editor): string {
  return serializeEditorMarkdown(editor as unknown as { storage: object });
}
/** End position (inside) of the last textblock whose parent chain contains `typeName`. */
function endOfLast(ed: Editor, typeName: string): number {
  let pos = -1;
  ed.state.doc.descendants((node, p) => {
    if (node.type.name === typeName) pos = p + node.nodeSize - 1; // inside the closing token
    return true;
  });
  return pos;
}

function roundTrip(md: string): string {
  const ed = makeEditor(md);
  try {
    // The modal re-attaches the original surrounding whitespace (markdownEnvelope), so
    // trailing newlines the serializer emits are not part of the contract.
    return ser(ed).trimEnd();
  } finally {
    ed.destroy();
  }
}

const CANONICAL: Record<string, string> = {
  headings: doc("# One", "", "## Two", "", "### Three"),
  paragraph: doc("Plain **bold** *italic* ~~gone~~ `code` text."),
  bullets: doc("- a", "- b", "", "text"),
  ordered: doc("1. first", "2. second", "", "text"),
  orderedStart: doc("5. five", "6. six"),
  nested: doc("- a", "  - b", "    - c", "- d"),
  nestedOrdered: doc("1. a", "   1. b", "2. c"),
  taskList: doc("- [ ] todo", "- [x] done"),
  quote: doc("> quote", ">", "> - item"),
  table: doc("| A | B |", "| --- | --- |", "| 1 | 2 |", "| x | y |"),
  tableAlign: doc("| L | C | R |", "| :--- | :---: | ---: |", "| 1 | 2 | 3 |"),
  tableInline: doc("| Name | Link |", "| --- | --- |", "| **bold** | [site](https://example.com) |", "| `c` | *i* |"),
  link: doc("[text](https://example.com) and [rel](../a/b%20c.md#frag)"),
  linkTitle: doc('[t](https://example.com "title")'),
  image: doc("![alt text](pic.png)"),
  imageTitle: doc('before ![alt](dir/pic.png "cap") after'),
  code: doc("```ts", "const x = 1;", "```"),
  mermaid: doc("```mermaid", "graph TD", "  A-->B", "  B-->C", "```"),
  nestedFence: doc("````md", "```js", "x", "```", "````"),
  hr: doc("a", "", "---", "", "b"),
  rawHtml: doc("<details><summary>x</summary>", "", "body", "", "</details>"),
};

describe("every element round-trips unchanged", () => {
  for (const [name, md] of Object.entries(CANONICAL)) {
    // @covers FR-01.35
    it(`${name}: identical + idempotent`, () => {
      const once = roundTrip(md);
      expect(once).toBe(md);
      expect(roundTrip(once)).toBe(once);
    });
  }

  // @covers FR-01.35
  it("a document with ALL elements survives intact", () => {
    const all = Object.values(CANONICAL).join(NL + NL);
    expect(roundTrip(all)).toBe(all);
  });
});

describe("tables", () => {
  // @covers FR-01.35
  it("a pipe inside a cell stays inside the cell", () => {
    const md = doc("| A | B |", "| --- | --- |", String.raw`| a \| b | c |`);
    expect(roundTrip(md)).toBe(md);
  });

  // @covers FR-01.35
  it("a table the GFM syntax cannot express is kept as HTML, never flattened", () => {
    const md = doc(
      "<table>",
      "<thead><tr><th>A</th><th>B</th></tr></thead>",
      "<tbody><tr><td><p>one</p><p>two</p></td><td>x</td></tr></tbody>",
      "</table>",
    );
    const out = roundTrip(md);
    expect(out).toContain("<table");
    expect(out).toContain("one");
    expect(out).toContain("two");
    expect(roundTrip(out)).toBe(out);
  });

  // @covers FR-01.35
  it("editing a table (add row/column, align) keeps it a valid GFM table", () => {
    const ed = makeEditor(CANONICAL.table);
    try {
      ed.commands.setTextSelection(endOfLast(ed, "paragraph")); // end of the last cell
      expect(ed.isActive("table")).toBe(true);
      expect(ed.commands.addRowAfter()).toBe(true);
      expect(ed.commands.addColumnAfter()).toBe(true);
      expect(setColumnAlign(ed, "right")).toBe(true);
      const out = ser(ed).trimEnd();
      const lines = out.split(NL);
      expect(lines).toHaveLength(5); // header, delimiter, 3 body rows
      for (const l of lines) expect(l.startsWith("| ") && l.endsWith(" |")).toBe(true);
      expect(lines[1].split(" | ")[1]).toContain("---:"); // the column of the caret
      // every row has the same number of cells
      const counts = new Set(lines.map((l) => l.split(" | ").length));
      expect(counts.size).toBe(1);
      expect(roundTrip(out)).toBe(out);
    } finally {
      ed.destroy();
    }
  });

  // @covers FR-01.35
  it("insertTable produces a header row + body that serializes as GFM", () => {
    const ed = makeEditor("");
    try {
      ed.commands.insertTable({ rows: 3, cols: 2, withHeaderRow: true });
      const lines = ser(ed).trimEnd().split(NL);
      expect(lines[1]).toMatch(/^\| --- \| --- \|$/);
      expect(lines.length).toBeGreaterThanOrEqual(4);
      for (const l of lines) expect(l.split("|")).toHaveLength(4); // 2 columns
    } finally {
      ed.destroy();
    }
  });
});

describe("code fences", () => {
  // @covers FR-01.35
  it("longestBacktickRun counts consecutive backticks", () => {
    expect(longestBacktickRun("none")).toBe(0);
    expect(longestBacktickRun("a ` b ``` c ``")).toBe(3);
  });

  // @covers FR-01.35
  it("the fence is always longer than any backtick run inside the block", () => {
    const md = doc("`````", "````", "x", "````", "`````");
    expect(roundTrip(md)).toBe(md);
  });

  // @covers FR-01.35
  it("editing the code of a mermaid block keeps fence and language", () => {
    const ed = makeEditor(CANONICAL.mermaid);
    try {
      ed.commands.setTextSelection(endOfLast(ed, "codeBlock")); // end of the code text
      ed.view.dispatch(ed.state.tr.insertText(NL + "  C-->D"));
      const out = ser(ed).trimEnd();
      expect(out.startsWith("```mermaid" + NL)).toBe(true);
      expect(out.endsWith(NL + "```")).toBe(true);
      expect(out).toContain("C-->D");
    } finally {
      ed.destroy();
    }
  });
});

describe("task lists", () => {
  // @covers FR-01.35
  it("toggling a checkbox flips [ ] / [x] in the Markdown", () => {
    const ed = makeEditor(CANONICAL.taskList);
    try {
      ed.commands.setTextSelection(3);
      ed.chain().updateAttributes("taskItem", { checked: true }).run();
      expect(ser(ed)).toBe(doc("- [x] todo", "- [x] done"));
    } finally {
      ed.destroy();
    }
  });
});

describe("review findings (code + doubt review)", () => {
  // @covers FR-01.35
  it("an image-only table cell keeps its image", () => {
    const md = doc("| Icon | Name |", "| --- | --- |", "| ![logo](a.png) | x |");
    expect(roundTrip(md)).toBe(md);
  });

  // @covers FR-01.35
  it("a badge link in a cell survives", () => {
    const md = doc("| Build |", "| --- |", "| [![ci](b.svg)](https://ci.example) |");
    expect(roundTrip(md)).toBe(md);
  });

  // @covers FR-01.35
  it("a cell with a hard break falls back to HTML and stays one table", () => {
    const md = doc("<table>", "<tr><th>A</th></tr>", "<tr><td>one<br>two</td></tr>", "</table>");
    const out = roundTrip(md);
    expect(out).toContain("<table");
    expect(out).not.toMatch(/^\| /m);
    expect(roundTrip(out)).toBe(out);
  });

  // @covers FR-01.35
  it("a literal backslash before a pipe stays inside its cell", () => {
    const BS = String.fromCharCode(92);
    const md = doc("| A | B |", "| --- | --- |", `| C:${BS}${BS}${BS}| | x |`);
    const once = roundTrip(md);
    // A pipe is a real cell delimiter unless an ODD run of backslashes precedes it.
    const runs = new RegExp("(" + BS + BS + "*)\\|", "g");
    const delimiters = (once.split(NL)[2].match(runs) ?? []).filter((m) => (m.length - 1) % 2 === 0);
    expect(delimiters).toHaveLength(3); // | cell | cell | — the data pipe is escaped
    expect(roundTrip(once)).toBe(once);
  });

  // @covers FR-01.35
  it("a data: URI image is kept", () => {
    const md = doc("![d](data:image/png;base64,iVBORw0KGgo=)");
    expect(roundTrip(md)).toBe(md);
  });

  // @covers FR-01.35
  it("an image path with a space is written as a valid destination", () => {
    // markdown-it percent-encodes a bracketed destination (equivalent, documented).
    const encoded = roundTrip(doc("![p](<my pic.png>)"));
    expect(encoded).toBe("![p](my%20pic.png)");
    expect(roundTrip(encoded)).toBe(encoded);
    // a raw <img> carries the space through: wrapped in <> so the link stays valid
    expect(roundTrip('a <img src="my pic.png" alt="p"> b')).toBe("a ![p](<my pic.png>) b");
  });

  // @covers FR-01.35
  it("quotes and backslashes in an image title survive", () => {
    const md = String.raw`![a](p.png "x \"q\" \\ y")`;
    expect(roundTrip(md)).toBe(md);
  });

  // @covers FR-01.35
  it("a fence language with a backtick uses a tilde fence", () => {
    const md = doc("~~~a`b", "x", "~~~");
    expect(roundTrip(md)).toBe(md);
  });

  // @covers FR-01.35
  it("a loose task list is normalised to tight (documented), never merged", () => {
    const out = roundTrip(doc("- [ ] a", "", "- [x] b"));
    expect(out).toBe(doc("- [ ] a", "- [x] b"));
  });

  // @covers FR-01.35
  it("a task item with a nested bullet keeps it", () => {
    const md = doc("- [ ] parent", "  - child");
    expect(roundTrip(md)).toBe(md);
  });
});

describe("containers and mixed lists (doubt review)", () => {
  // @covers FR-01.35
  it("a mixed task/plain list keeps both items (only blank-line spacing changes)", () => {
    const out = roundTrip(doc("- [ ] a", "- b"));
    expect(out).toContain("- [ ] a");
    expect(out).toMatch(/^- b$/m);
  });

  // @covers FR-01.35
  it("a task item keeps a second paragraph and a code block", () => {
    const para = doc("- [ ] a", "", "  more");
    const code = doc("- [ ] a", "", "  ```js", "  x", "  ```");
    expect(roundTrip(para)).toBe(para);
    expect(roundTrip(code)).toBe(code);
  });

  // @covers FR-01.35
  it("a table inside a list item and inside a blockquote stays a table", () => {
    const inList = doc("- item", "", "  | A | B |", "  | --- | --- |", "  | 1 | 2 |");
    const inQuote = doc("> | A | B |", "> | --- | --- |", "> | 1 | 2 |");
    expect(roundTrip(inList)).toBe(inList);
    expect(roundTrip(inQuote)).toBe(inQuote);
  });
});
