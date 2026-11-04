import { isAssetPath, type ResourceLoader } from "./htmlResourceLoader";

/** A loader over a path -> text map; every asset path "loads" as `data:<path>` unless listed as refused. */
export function fakeLoader(css: Record<string, string> = {}, refused: string[] = []) {
  const calls: string[] = [];
  const claimed = new Set<string>();
  const loader: ResourceLoader = {
    claimImport: (p) => (claimed.has(p) ? false : (claimed.add(p), true)),
    releaseImport: (p) => void claimed.delete(p),
    spend: () => true,
    dispose: () => undefined,
    text: async (p) => {
      if (css[p] === undefined) throw new Error("missing " + p);
      return css[p];
    },
    dataUri: async (p) => {
      calls.push(p);
      return refused.includes(p) || !isAssetPath(p) ? null : `data:x/${p}`;
    },
  };
  return { loader, calls };
}
