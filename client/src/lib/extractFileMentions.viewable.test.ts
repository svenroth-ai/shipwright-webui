import { describe, it, expect } from "vitest";
import { extractFileMentions, RECOGNIZED_EXTENSIONS } from "./extractFileMentions";
import { resolveKind } from "../components/external/SmartViewer";

// Drift guard (code-review finding, iterate-2026-08-29-compliance-file-viewer):
// a mention SmartViewer can't render is a link to a dead end. Imports the
// real RECOGNIZED_EXTENSIONS list rather than a second hand-copy, so this
// fails the moment the two lists disagree in either direction.
describe("extractFileMentions extensions stay viewable in SmartViewer", () => {
  it.each(RECOGNIZED_EXTENSIONS)("recognized extension .%s resolves to a viewable kind", (ext) => {
    const path = `some/file.${ext}`;
    expect(extractFileMentions(`see ${path} for detail`).map((m) => m.path)).toEqual([path]);
    expect(resolveKind(path).kind).not.toBe("unknown");
  });
});
