/** V1 guards: chat type scale floor, spacing tokens, dark token lifts, teal link. */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const dir = path.dirname(fileURLToPath(import.meta.url));
const chat = readFileSync(path.join(dir, "mission-chat.css"), "utf8");
const op = readFileSync(path.join(dir, "mission-operation.css"), "utf8");

function lum(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
const ratio = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

describe("mission chat scale (V1)", () => {
  it("declares the spacing + type tokens", () => {
    expect(chat).toMatch(/--gap-turn: 28px/);
    expect(chat).toMatch(/--gap-switch: 36px/);
    expect(chat).toMatch(/--gap-block: 12px/);
    expect(chat).toMatch(/--fs-chat: 15px/);
    expect(chat).toMatch(/--fs-small: 13px/);
  });
  it("uses no font-size below 12px in the chat stylesheet", () => {
    for (const m of chat.matchAll(/font-size:\s*([\d.]+)px/g)) expect(Number(m[1])).toBeGreaterThanOrEqual(12);
  });
  it("dark scope carries the lifted tokens and AA contrast on the card", () => {
    expect(op).toMatch(/--body: #d9d6d0; --muted: #a9a39b; --faint: #8f8981/);
    expect(op).toMatch(/--link: #7fdcca/);
    for (const fg of ["#d9d6d0", "#a9a39b", "#8f8981", "#7fdcca"]) expect(ratio(fg, "#1a1817")).toBeGreaterThanOrEqual(4.5);
  });
  it("feed links are underlined and table header uses the --thead token", () => {
    expect(chat).toMatch(/\.mc-feed-card a \{[^}]*text-decoration: underline/);
    expect(chat).toMatch(/\.mc-table-wrap th \{[^}]*var\(--thead/);
  });
});
