import { WebLinksAddon } from "@xterm/addon-web-links";

/** Opens an http(s) terminal link in a new tab (noopener). Other schemes are ignored. */
export function openTerminalLink(uri: string): void {
  if (!/^https?:\/\//i.test(uri)) return;
  window.open(uri, "_blank", "noopener,noreferrer");
}

/**
 * Always a NEW tab, never the current one: the opener is nulled so the opened
 * page cannot reach the webui window (same contract as the addon default, made
 * explicit and testable instead of relying on its confirm()-less internals).
 */
export function createTerminalLinksAddon(): WebLinksAddon {
  return new WebLinksAddon((_event, uri) => openTerminalLink(uri));
}
