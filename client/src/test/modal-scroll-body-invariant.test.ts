/*
 * Meta-test — the bounded-scroll-container RATCHET.
 *
 * iterate-2026-07-14-modal-scroll-body-invariant. The CSS mechanism and why the
 * guard is load-bearing: see client/src/components/common/ModalScrollBody.tsx.
 *
 * Short version: a column-flex container that scrolls itself will SQUEEZE and
 * silently CLIP any direct child whose `overflow` is not `visible` (CSS drops
 * that child's automatic minimum size), and it then never becomes scrollable —
 * so the clipped content is unreachable. `[&>*]:shrink-0` disarms it. That bug
 * shipped once (iterate-2026-07-14-more-options-flex-clip) and three dialog
 * bodies had copied the class string with only one carrying the guard.
 *
 * Why a meta-test and not just per-component assertions: a per-component test
 * only protects components that already exist. The failure mode is a NEW
 * scroller re-typing the class string and quietly omitting the guard. Only a
 * source scan catches that. (Same shape as doc-sync.test.ts /
 * no-cross-package-imports.test.ts.)
 *
 * The predicate is STRUCTURAL, not a string proxy: any single `className` that
 * declares a column flex container AND its own scrollbar must also carry the
 * guard. It therefore survives `max-h-[40vh]` / `max-h-[calc(100dvh-…)]` /
 * `overflow-auto` / flex-1-bounded variants — an earlier draft keyed on
 * `max-h-[calc(100vh-` and was evadable by all four. Comments are stripped
 * before scanning, so a guard mentioned in prose cannot satisfy it.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CARRIER = path.join(SRC, "components", "common", "ModalScrollBody.tsx");

const GUARD = "[&>*]:shrink-0";

/** `className="…"`, `className={`…`}`, `className={"…"}` — literal forms only. */
const CLASS_ATTR = /className=(?:"([^"]*)"|\{`([^`]*)`\}|\{"([^"]*)"\})/gs;

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    if (!/\.tsx?$/.test(full)) return [];
    if (/\.test\.tsx?$/.test(full)) return [];
    return [full];
  });
}

/** A column flex container that provides its own scrollbar — i.e. one that can
 *  develop negative free space and squeeze a non-`visible`-overflow child. */
function isSelfScrollingColumnFlex(cls: string): boolean {
  const tokens = cls.split(/\s+/).filter(Boolean);
  const isFlex = tokens.includes("flex");
  const isColumn = tokens.includes("flex-col");
  const scrolls = tokens.some(
    (t) => t === "overflow-y-auto" || t === "overflow-auto" || t === "overflow-y-scroll",
  );
  return isFlex && isColumn && scrolls;
}

describe("bounded-scroll-container invariant (ratchet)", () => {
  it("ModalScrollBody carries the guard — it is the single source of the invariant", () => {
    const carrier = stripComments(readFileSync(CARRIER, "utf-8"));
    expect(carrier).toContain("overflow-y-auto");
    expect(carrier).toContain(GUARD);
  });

  it("every self-scrolling column-flex container carries [&>*]:shrink-0", () => {
    const offenders: string[] = [];

    for (const file of sourceFiles(SRC)) {
      if (file === CARRIER) continue; // the carrier composes its classes dynamically
      const text = stripComments(readFileSync(file, "utf-8"));

      for (const match of text.matchAll(CLASS_ATTR)) {
        const cls = (match[1] ?? match[2] ?? match[3] ?? "").replace(/\s+/g, " ").trim();
        if (!isSelfScrollingColumnFlex(cls)) continue;
        if (cls.includes(GUARD)) continue;
        offenders.push(`${path.relative(SRC, file).replace(/\\/g, "/")} — "${cls}"`);
      }
    }

    expect(
      offenders,
      "These declare a column flex container that scrolls itself, without the " +
        `\`${GUARD}\` guard. A direct child with overflow != visible will be ` +
        "squeezed below its content and clipped, and the container will never " +
        "scroll — the content becomes unreachable. Either add the guard, or use " +
        "<ModalScrollBody> (client/src/components/common/ModalScrollBody.tsx), " +
        "which carries it for you.",
    ).toEqual([]);
  });

  it("ModalScrollBody callers pass only the variable half (height budget + gap)", () => {
    // The client has no tailwind-merge: a caller slipping `overflow-visible` or
    // `[&>*]:shrink` into className would win or lose silently by stylesheet
    // order and defeat the guard. Keep the escape hatch narrow.
    const allowed = /^(max-h-|max-h\[|gap-|gap-x-|gap-y-)/;
    const offenders: string[] = [];

    for (const file of sourceFiles(SRC)) {
      const text = stripComments(readFileSync(file, "utf-8"));
      if (!text.includes("<ModalScrollBody")) continue;

      for (const tag of text.matchAll(/<ModalScrollBody\b[^>]*>/gs)) {
        const cls = /className="([^"]*)"/.exec(tag[0])?.[1] ?? "";
        for (const token of cls.split(/\s+/).filter(Boolean)) {
          if (!allowed.test(token)) {
            offenders.push(
              `${path.relative(SRC, file).replace(/\\/g, "/")} — "${token}"`,
            );
          }
        }
      }
    }

    expect(
      offenders,
      "ModalScrollBody's className is for the height budget + gap ONLY. " +
        "Anything else risks silently overriding the invariant half.",
    ).toEqual([]);
  });
});
