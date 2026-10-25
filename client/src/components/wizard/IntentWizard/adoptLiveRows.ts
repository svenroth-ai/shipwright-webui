/*
 * adoptLiveRows.ts - which rows of the Adopt result screen are read from the repo and
 * which are still samples. The scan reports per key: a value (live), "nothing found"
 * (reported, empty - `null`), or nothing at all (key omitted: an older scan or an
 * analyzer without that detector). Those last two are different statements and are
 * worded differently, so an empty monorepo root never reads as "all is well".
 * Everything returned is plain text for React to render, never markup.
 */

import type { AdoptScanFindings } from "../../../lib/adoptScanApi";
import type { AdoptSnapshot } from "./types";

export type AdoptRowState = "live" | "empty" | "unreported" | "sample";
export interface AdoptRow {
  label: string;
  value: string;
  state: AdoptRowState;
}

export const NOTHING_FOUND = "Nothing found at the top of the repo - it may be in a sub-folder";
export const NOT_REPORTED = "Not reported by this scan version";

function live<T>(value: T | null | undefined, say: (v: T) => string): Pick<AdoptRow, "value" | "state"> {
  if (value === undefined) return { value: NOT_REPORTED, state: "unreported" };
  if (value === null || value === 0) return { value: NOTHING_FOUND, state: "empty" };
  return { value: say(value), state: "live" };
}

/** `found` rows of the sample, with every row the scan can answer replaced. */
export function buildAdoptRows(
  sample: AdoptSnapshot["found"],
  scan: { profileValue: string | null; findings: AdoptScanFindings | null },
): AdoptRow[] {
  const f = scan.findings;
  return sample.map((row): AdoptRow => {
    const asSample: AdoptRow = { ...row, state: "sample" };
    if (row.label === "Profile") return scan.profileValue ? { ...row, value: scan.profileValue, state: "live" } : asSample;
    if (!f) return asSample;
    switch (row.label) {
      case "Stack":
        return { label: row.label, ...live(f.stack, String) };
      case "Routes":
        return { label: row.label, ...live(f.routes, (n) => `${n} found in the router and server handlers`) };
      case "Tests":
        return { label: row.label, ...live(f.tests, String) };
      case "CI":
        return { label: row.label, ...live(f.ci, String) };
      case "Conventions":
        return { label: row.label, ...live(f.conventions, String) };
      case "Commands":
        return { label: row.label, ...live(f.commands, (names) => `package.json scripts: ${names.join(" · ")}`) };
      default:
        return asSample;
    }
  });
}

/** One honest sentence about what is live, derived from the rows - never a fixed claim. */
export function adoptBannerText(rows: AdoptRow[]): string {
  const labels = (...states: AdoptRowState[]) => rows.filter((r) => states.includes(r.state)).map((r) => r.label);
  const read = labels("live", "empty");
  const unreported = labels("unreported");
  const samples = labels("sample");
  if (read.length === 0 && unreported.length === 0) return "Sample findings - not a live read of your repo yet (the full scan lands later). ";
  const sentences: string[] = [];
  if (read.length > 0) sentences.push(`Read live from your repo: ${read.join(", ")}.`);
  if (unreported.length > 0) sentences.push(`Not reported by this scan version: ${unreported.join(", ")}.`);
  if (samples.length > 0) sentences.push(`Still samples: ${samples.join(", ")} (the full scan lands later).`);
  return `${sentences.join(" ")} `;
}
