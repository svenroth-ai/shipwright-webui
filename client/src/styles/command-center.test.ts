/*
 * command-center.css — AC2 (the palette is GLASS) + AC5 (density is
 * token-driven, no magic numbers) asserted at the stylesheet level. jsdom does
 * not apply CSS, so this reads the source and proves the recipe is present; the
 * pixels are pinned by the visual baseline (client/e2e/visual).
 */
import { describe, it, expect, beforeAll } from "vitest";

let css = "";

beforeAll(async () => {
  const fs = await import("node:fs" as string);
  const path = await import("node:path" as string);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const url = (await import("node:url" as string)) as any;
  const here = path.dirname(url.fileURLToPath((import.meta as any).url));
  css = fs.readFileSync(path.join(here, "command-center.css"), "utf8");
});

describe("command-center.css — the palette is GLASS (AC2)", () => {
  it(".cmd-palette references all four A03 glass tokens", () => {
    const palette = css.slice(css.indexOf(".cmd-palette {"));
    expect(palette).toContain("var(--glass-light)");
    expect(palette).toContain("var(--glass-filter)");
    expect(palette).toContain("var(--glass-light-line)");
    expect(palette).toContain("var(--sh-photo)");
  });

  it("uses backdrop-filter (the frosted glass, not a flat tint)", () => {
    expect(css).toContain("backdrop-filter: var(--glass-filter)");
  });
});

describe("command-center.css — density is token-driven (AC5)", () => {
  it("defines density spacing tokens off data-density, not inline magic numbers", () => {
    expect(css).toContain('[data-density="compact"]');
    expect(css).toContain("--density-row-py");
    expect(css).toContain("--density-font");
  });
});

describe("command-center.css — a visible selection ring (AC4/AC7)", () => {
  it("renders an outline on the keyboard-selected item", () => {
    expect(css).toContain('[data-nav-selected="true"]');
    expect(css).toMatch(/outline:\s*2px solid/);
  });
});
