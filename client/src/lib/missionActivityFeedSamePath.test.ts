/*
 * `sameTestFilePath` — the absolute/relative bridge used by TDD authoring-run
 * detection. Split out of `missionActivityFeedAuthoringTrack.test.ts` at the
 * 300-line convention (44th review round), same as that file was split out of
 * `missionActivityFeedClassify.test.ts`. */
import { describe, expect, it } from "vitest";
import { sameTestFilePath } from "./missionActivityFeedAuthoringTrack";

describe("sameTestFilePath (a Write's file_path is often absolute, the shell command's path relative)", () => {
  it("matches identical paths", () => {
    expect(sameTestFilePath("src/lib/foo.test.ts", "src/lib/foo.test.ts")).toBe(true);
  });

  it("matches a relative path against an absolute one naming the same file", () => {
    expect(sameTestFilePath("src/lib/foo.test.ts", "/project/src/lib/foo.test.ts")).toBe(true);
    expect(sameTestFilePath("C:\\project\\src\\lib\\foo.test.ts", "src/lib/foo.test.ts")).toBe(true);
  });

  it("does not match on a bare substring across a path-segment boundary", () => {
    expect(sameTestFilePath("src/lib/foo.test.ts", "OLDsrc/lib/foo.test.ts")).toBe(false);
  });

  it("does not match two genuinely different files", () => {
    expect(sameTestFilePath("src/lib/foo.test.ts", "src/lib/bar.test.ts")).toBe(false);
  });

  // 2nd-round external review catch: two RELATIVE paths must match exactly,
  // never by suffix — neither is anchored to a known root.
  it("does not suffix-match two different relative paths, even when one is a suffix of the other", () => {
    expect(sameTestFilePath("other/src/foo.test.ts", "src/foo.test.ts")).toBe(false);
  });

  // 4th-round catch (openai, medium): a leading `./` is purely cosmetic.
  it("matches a relative path with a leading './' against the same path without it", () => {
    expect(sameTestFilePath("./src/lib/foo.test.ts", "src/lib/foo.test.ts")).toBe(true);
  });

  // 11th-round catch (glm, low): a Windows drive-letter path means a case-
  // insensitive filesystem — differing casing must still match.
  it("matches case-insensitively when either side is a Windows drive-letter path", () => {
    expect(sameTestFilePath("C:\\project\\src\\lib\\Foo.test.ts", "src/lib/foo.test.ts")).toBe(true);
    expect(sameTestFilePath("C:/project/src/lib/foo.test.ts", "C:/PROJECT/SRC/LIB/FOO.TEST.TS")).toBe(true);
  });

  it("still matches two relative paths case-sensitively when neither is a Windows path", () => {
    expect(sameTestFilePath("src/lib/Foo.test.ts", "src/lib/foo.test.ts")).toBe(false);
  });

  // 16th-round catch (glm, low): the absolute side must be the LONGER one
  // before bridging — a longer "relative" path names a different file.
  it("does not bridge when the 'relative' side is longer than the absolute side", () => {
    expect(sameTestFilePath("/src/foo.test.ts", "a/src/foo.test.ts")).toBe(false);
  });

  // KNOWN LIMITATION, pinned deliberately (28th-round catch, glm, low): a
  // `cd`-resolved path and a project-root-relative `Write` `file_path` are
  // BOTH relative, so this correctly declines rather than guessing.
  it("does not bridge a cd-resolved relative path against a project-root-relative path with no matching prefix", () => {
    expect(sameTestFilePath("client/src/lib/foo.test.ts", "src/lib/foo.test.ts")).toBe(false);
  });
});
