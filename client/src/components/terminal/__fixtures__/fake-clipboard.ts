/*
 * FakeDataTransfer + fakeClipboardEvent — jsdom doesn't ship
 * DataTransfer/DataTransferItemList. Shared shim for usePasteImage tests
 * (Campaign C / C5). Source pattern mirrors EmbeddedTerminal.test.tsx.
 */

interface FakeItem {
  kind: "string" | "file";
  type: string;
  getAsFile(): File | null;
  __string?: string;
}

export class FakeDataTransfer {
  items: {
    length: number;
    add(...args: unknown[]): void;
    [i: number]: FakeItem;
  } = (() => {
    const arr: FakeItem[] = [];
    const list = arr as unknown as {
      length: number;
      add: (...args: unknown[]) => void;
      [i: number]: FakeItem;
    };
    (list as unknown as { add: (...a: unknown[]) => void }).add = (
      ...args: unknown[]
    ) => {
      if (args.length === 2 && typeof args[0] === "string") {
        arr.push({
          kind: "string",
          type: args[1] as string,
          __string: args[0],
          getAsFile: () => null,
        });
      } else if (args.length === 1 && args[0] instanceof File) {
        const f = args[0] as File;
        arr.push({
          kind: "file",
          type: f.type,
          getAsFile: () => f,
        });
      }
    };
    return list;
  })();
  getData(type: string): string {
    for (let i = 0; i < (this.items as unknown as { length: number }).length; i++) {
      const it = (this.items as unknown as Record<number, FakeItem>)[i];
      if (it.kind === "string" && it.type === type) return it.__string ?? "";
    }
    return "";
  }
}

export function fakeClipboardEvent(dt: FakeDataTransfer): Event {
  const ev = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(ev, "clipboardData", { value: dt });
  return ev;
}
