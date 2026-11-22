/*
 * logo.ts — the Shipwright logo for the mail header band (mockup page 05).
 * Attached INLINE (CID), never a remote image: the mail loads nothing from the
 * network. A missing file just leaves the header without the image.
 */

import { readFileSync } from "node:fs";

export const LOGO_CID = "shipwright-logo";
const LOGO_URL = new URL("../../config/mail/shipwright-logo-white.png", import.meta.url);

let cached: Buffer | null | undefined;

export function logoAttachment(): { filename: string; content: Buffer; cid: string; contentType: string; contentDisposition: "inline" }[] {
  if (cached === undefined) {
    try {
      cached = readFileSync(LOGO_URL);
    } catch {
      cached = null;
    }
  }
  return cached ? [{ filename: "shipwright-logo.png", content: cached, cid: LOGO_CID, contentType: "image/png", contentDisposition: "inline" }] : [];
}
