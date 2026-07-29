/*
 * The diagrams `mermaid-real-render.spec.ts` renders, with the ABSOLUTE
 * expectations each one must meet.
 * iterate-2026-07-29-mermaid-real-render-e2e.
 *
 * ── Why more than one diagram type ──────────────────────────────────────────
 * Mermaid ships every diagram type in its OWN lazily-imported chunk (38 such
 * loaders in `mermaid.core.mjs`). A suite that renders only a flowchart is
 * blind to a bump that breaks sequence, class or state rendering — and the app
 * renders whatever the user writes, via `.mmd`/`.mermaid` files in SmartViewer
 * and via ```mermaid fences in any markdown. Four types is not all 21, but it
 * is four independent chunks instead of one. (Stage-3 doubt review, 2026-07-29.)
 *
 * ── Every number below was MEASURED through the shipped path ────────────────
 * Not estimated, and not measured through a scratch harness: mermaid prefixes
 * EVERY rule of its injected <style> block with the render id, so the SVG
 * character count scales with the id string. An earlier ladder measured under
 * different ids was off by ~1.1 kB, which is the whole margin an assertion like
 * this trades in. `renderId` below is therefore the id the spec actually uses,
 * and the `measured*` values were taken with exactly that id.
 *
 * Floors sit ~15-30% under the measured value: the gate runs in the pinned
 * Linux container while these were measured on Windows, and font substitution
 * moves glyph metrics. The margin is stated as HEADROOM, not as a prediction —
 * an earlier comment argued Linux would substitute a wider face and therefore
 * only ever grow the width, which was never measured and is not safe to assert
 * (the container ships Liberation fonts, and Liberation Sans is metric-
 * IDENTICAL to Arial rather than wider). The floors still fail closed: a
 * collapsed or errored render measures 0, and the degradation ladder in the
 * spec header sits below them.
 *
 * NOTE on relying on `minChars` alone — do not. Falsifying the ADD_TAGS/
 * ADD_ATTR guards showed a real sanitizer regression dropping the flowchart to
 * 15 029 chars against a 15 000 floor: 29 characters of margin. The structural
 * assertions (`minForeignObjects`, `minDominantBaseline`) are what actually
 * catch that class; the char floor only catches a collapsed drawing.
 */

export interface DiagramCase {
  /** Also the render id: `mermaid-${name}`. Changing it changes `measuredChars`. */
  name: string;
  /** What this case buys that the others do not. */
  why: string;
  source: string;
  /** Every label the source declares — all must appear in the drawn output. */
  labels: string[];
  measuredChars: number;
  minChars: number;
  measuredWidth: number;
  minWidth: number;
  measuredHeight: number;
  minHeight: number;
  /**
   * Minimum `<foreignObject>` elements. Mermaid asks DOMPurify to keep these
   * via `ADD_TAGS: ["foreignobject"]`; under `securityLevel: "strict"` they
   * survive the sanitize ONLY because that option is honoured, so a DOMPurify
   * regression there drops HTML labels and turns this red.
   */
  minForeignObjects: number;
  /**
   * Minimum `dominant-baseline` attributes. Mermaid asks DOMPurify to keep this
   * one via `ADD_ATTR: ["dominant-baseline"]`. ONLY the sequence diagram emits
   * it — the flowchart emits none — which is precisely why a flowchart-only
   * suite could not see an `ADD_ATTR` regression at all.
   */
  minDominantBaseline: number;
}

export const DIAGRAM_CASES: DiagramCase[] = [
  {
    name: "flowchart",
    why: "the flowchart-v2 chunk; the ADD_TAGS foreignObject survivors",
    source: [
      "graph TD",
      "  A[Launch Task] --> B{JSONL present?}",
      "  B -->|yes| C[Observe transcript]",
      "  B -->|no| D[Await first write]",
      "  C --> E[Render Mission]",
      "  D --> E",
    ].join("\n"),
    labels: [
      "Launch Task",
      "JSONL present?",
      "Observe transcript",
      "Await first write",
      "Render Mission",
    ],
    measuredChars: 17_674,
    minChars: 15_000,
    measuredWidth: 436,
    minWidth: 300,
    measuredHeight: 515,
    minHeight: 350,
    minForeignObjects: 5,
    minDominantBaseline: 0,
  },
  {
    name: "sequence",
    why: "a different chunk, NO foreignObject, and the only ADD_ATTR (dominant-baseline) emitter",
    source: [
      "sequenceDiagram",
      "  participant WebUI",
      "  participant Claude",
      "  WebUI->>Claude: Launch session",
      "  Claude-->>WebUI: JSONL append",
      "  WebUI->>WebUI: Render Mission",
    ].join("\n"),
    labels: ["WebUI", "Claude", "Launch session", "JSONL append", "Render Mission"],
    measuredChars: 23_641,
    minChars: 18_000,
    measuredWidth: 450,
    minWidth: 300,
    measuredHeight: 333,
    minHeight: 240,
    minForeignObjects: 0,
    minDominantBaseline: 1,
  },
  {
    name: "class",
    why: "a third chunk; narrow output, so the width floor is exercised near its bound",
    source: [
      "classDiagram",
      "  class TaskStore {",
      "    +String taskId",
      "    +launch()",
      "  }",
      "  class Transcript",
      "  TaskStore --> Transcript",
    ].join("\n"),
    labels: ["TaskStore", "taskId", "launch()", "Transcript"],
    measuredChars: 17_862,
    minChars: 14_000,
    measuredWidth: 173,
    minWidth: 120,
    measuredHeight: 294,
    minHeight: 200,
    minForeignObjects: 3,
    minDominantBaseline: 0,
  },
  {
    name: "state",
    why: "a fourth chunk; the smallest output, so no floor is accidentally trivial",
    source: [
      "stateDiagram-v2",
      "  [*] --> Draft",
      "  Draft --> Active: launch",
      "  Active --> Done: close",
    ].join("\n"),
    labels: ["Draft", "Active", "Done", "launch", "close"],
    measuredChars: 11_223,
    minChars: 9_000,
    measuredWidth: 77,
    minWidth: 50,
    measuredHeight: 348,
    minHeight: 240,
    minForeignObjects: 3,
    minDominantBaseline: 0,
  },
];
