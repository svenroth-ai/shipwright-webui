import type { Terminal } from "@xterm/xterm";

const MIN_TERMINAL_COLS = 5;
const MIN_TERMINAL_ROWS = 2;

export function isUsableGrid(term: Pick<Terminal, "cols" | "rows">): boolean {
  return term.cols >= MIN_TERMINAL_COLS && term.rows >= MIN_TERMINAL_ROWS;
}

export function isMeasurableTerminalContainer(container: HTMLElement): boolean {
  const { width, height } = container.getBoundingClientRect();
  return width > 0 && height > 0;
}
