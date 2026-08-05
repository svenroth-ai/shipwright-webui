import { expect, type Locator, type Page } from "@playwright/test";

import { tryParseEnvelope, type WsCapture } from "./ws-capture";

export function expectOnlyUsableResizesSince(
  cap: WsCapture,
  socketId: number,
  since: number,
): void {
  const frames = cap.frames
    .filter((frame) =>
      frame.kind === "tx" && frame.ts >= since && frame.socketId === socketId)
    .map((frame) => tryParseEnvelope(frame.text))
    .filter((env) => env?.type === "resize");
  for (const env of frames) {
    expect(env?.cols).toEqual(expect.any(Number));
    expect(env?.rows).toEqual(expect.any(Number));
    expect(env!.cols as number).toBeGreaterThanOrEqual(5);
    expect(env!.rows as number).toBeGreaterThanOrEqual(2);
  }
}

export async function installFirstCompactTabProbe(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const observer = new MutationObserver(() => {
      const selected = document.querySelector(
        '[data-testid="pane-tab-bar"] [role="tab"][aria-selected="true"]',
      );
      if (!selected) return;
      document.documentElement.dataset.firstCompactWorkspaceTab =
        selected.getAttribute("data-testid") ?? "unknown";
      observer.disconnect();
    });
    observer.observe(document, { childList: true, subtree: true });
  });
}

export async function expectLightActiveControl(control: Locator): Promise<void> {
  const colors = await control.evaluate((element) => {
    const style = getComputedStyle(element);
    const probe = document.createElement("span");
    probe.style.color = "var(--accent)";
    document.body.append(probe);
    const accent = getComputedStyle(probe).color;
    probe.style.color = "var(--ink)";
    const ink = getComputedStyle(probe).color;
    probe.remove();
    return { background: style.backgroundColor, color: style.color,
      indicator: style.boxShadow, accent, ink };
  });
  expect(colors.background).toBe("rgb(255, 255, 255)");
  expect(colors.color).toBe(colors.ink);
  expect(colors.indicator).toContain(colors.accent);
}

export async function expectOneLineEllipsis(control: Locator): Promise<void> {
  const geometry = await control.locator("span").evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      clipped: element.scrollWidth > element.clientWidth,
      whiteSpace: style.whiteSpace,
      overflow: style.overflow,
    };
  });
  expect(geometry).toMatchObject({ clipped: true, whiteSpace: "nowrap", overflow: "hidden" });
}

export async function expectMinTouchTargets(targets: Locator[]): Promise<void> {
  for (const target of targets) {
    const box = await target.boundingBox();
    expect(box?.width).toBeGreaterThanOrEqual(44);
    expect(box?.height).toBeGreaterThanOrEqual(44);
  }
}
