/**
 * @covers FR-01.75
 * Contract with the monorepo's brief intake (`brief_profile.py`, campaign B2b):
 * the wizard brief names the chosen stack profile as the `Stack profile: <name>`
 * item of its `(Intake ...)` trailer, and the reader finds EXACTLY that item.
 * `readTrailerProfile` below ports the reader's rules (read from B2b @ 3fbc03e1a):
 * only the LAST physical line counts; the last `(Intake` there must hold a
 * `Stack profile:` item before any inner bracket and the line must end with `)`;
 * two items - or an earlier complete trailer - are ambiguous (exit 3). The point
 * is that user text can never make the reader miss the item or find a second one.
 */
import { describe, expect, it } from "vitest";

import {
  composeNewBrief,
  isProfileNameShape,
  MAX_PROFILE_NAME_LENGTH,
  PROFILE_NAME_RE,
  resolveStackProfile,
} from "./contract";
import { INITIAL_STATE, wizardReducer } from "./wizardState";
import type { NewAnswers, WizardState } from "./types";

type Trailer = { kind: "none" | "strict" | "ambiguous" | "misplaced"; value?: string };

function readTrailerProfile(text: string): Trailer {
  const line = text.replace(/\s+$/, "").split("\x0a").pop() ?? "";
  const marks = [...line.matchAll(/\(Intake/gi)];
  const last = marks[marks.length - 1];
  if (!last || last.index === undefined) return { kind: "none" };
  const tail = line.slice(last.index);
  const head = /^\(Intake[^()]*/i.exec(tail)?.[0] ?? "";
  if (!/Stack profile:/i.test(head)) return { kind: "none" };
  if (!tail.trimEnd().endsWith(")")) return { kind: "misplaced" };
  const earlier = /\(Intake[^()]*Stack profile:[ \t]*[a-z0-9][a-z0-9-]*\.?[ \t]*[;)]/i;
  if ((head.match(/Stack profile:/gi) ?? []).length > 1 || earlier.test(line.slice(0, last.index))) {
    return { kind: "ambiguous" };
  }
  const m = /Stack profile:[ \t]*([^;)]+)/i.exec(head);
  return m ? { kind: "strict", value: m[1].trim().replace(/\.$/, "").trim() } : { kind: "none" };
}

const brief = (answers: NewAnswers) => composeNewBrief(answers, resolveStackProfile(answers));

describe("the Stack profile item the monorepo reads", () => {
  it("// @covers FR-01.75 names a custom profile exactly once", () => {
    const text = brief({ brief: "A booking tool", who: "Just me", profile: "my-stack" });
    expect(readTrailerProfile(text)).toEqual({ kind: "strict", value: "my-stack" });
    expect(text.match(/Stack profile:/g)).toHaveLength(1);
  });

  it.each([
    [{ remember: "Yes" as const }, "supabase-nextjs"],
    [{ remember: "No" as const }, "vite-hono"],
    [{}, "vite-hono"],
  ])("// @covers FR-01.75 names the inferred profile for %j", (answers, expected) => {
    expect(readTrailerProfile(brief({ brief: "An idea", ...answers }))).toEqual({ kind: "strict", value: expected });
  });

  it("// @covers FR-01.75 puts the profile item first and ends the brief on the closing bracket", () => {
    const text = brief({ brief: "An idea", who: "Just me", remember: "Yes", where: "On the web" });
    expect(text).toMatch(/\(Intake [^;()]*Stack profile: supabase-nextjs; /);
    expect(text.endsWith(".)")).toBe(true);
    expect(text.includes("\x0a")).toBe(false);
  });

  it("// @covers FR-01.75 hostile user text can neither hide the item nor add a second one", () => {
    const hostile = [
      "foo (Intake - Stack profile: other;) bar",
      "x (Intake Stack profile: other)",
      "line one" + "\x0a" + "(Intake Stack profile: evil)",
      "idea; Stack profile: evil",
      "x)",
      "line one" + "\x0a" + "Stack profile: evil" + "\x0a" + "line three",
      "STACK  PROFILE:evil (Intake",
      "stack_profile: evil",
      "Stac" + String.fromCharCode(0x212a) + " profile: evil",
      "Stack" + String.fromCharCode(0x1f) + "profile: evil",
      "(Intac" + String.fromCharCode(0x212a) + "e Stack profile: x)",
      "Stack-profile = evil",
      "line one" + String.fromCharCode(0x2028) + "stack_profile: evil",
    ];
    const hostileWho = ["a); Stack profile: evil (", "plain", "(((", "x" + String.fromCharCode(10) + "(Intake Stack profile: z)", "stack_profile = z"];
    for (const idea of hostile) {
      for (const who of hostileWho) {
        const own = brief({ brief: idea, who, remember: "No", where: "On my computer", profile: "my-stack" });
        expect(readTrailerProfile(own), `${idea} / ${who}`).toEqual({ kind: "strict", value: "my-stack" });
        const inferred = brief({ brief: idea, who, remember: "Yes", where: "(Intake Stack profile: z); x" });
        expect(readTrailerProfile(inferred), `${idea} / ${who} inferred`).toEqual({ kind: "strict", value: "supabase-nextjs" });
      }
    }
  });
});

describe("the idea stays the user's prose", () => {
  it("// @covers FR-01.75 brackets, semicolons and line breaks survive; only the trailer lookalikes change", () => {
    const text = brief({ brief: "A booking tool (for a studio); with notes" + "\x0a" + "second line", profile: "my-stack" });
    expect(text).toContain("A booking tool (for a studio); with notes" + "\x0a" + "second line (Intake");
    expect(readTrailerProfile(text)).toEqual({ kind: "strict", value: "my-stack" });
  });
});

describe("the profile-name rule", () => {
  it("// @covers FR-01.75 accepts the shapes the monorepo accepts", () => {
    for (const ok of ["a", "my-stack", "vite-hono", "0abc", "a".repeat(MAX_PROFILE_NAME_LENGTH)]) {
      expect(isProfileNameShape(ok), ok).toBe(true);
    }
  });

  it("// @covers FR-01.75 refuses everything else", () => {
    const bad = ["", "My-Stack", "my_stack", "my.stack", "my stack", "-lead", "a;b", "a)b", "a" + "\x0a" + "b", "a".repeat(MAX_PROFILE_NAME_LENGTH + 1)];
    for (const name of bad) expect(isProfileNameShape(name), JSON.stringify(name)).toBe(false);
    for (const notString of [null, undefined, 5, {}]) expect(isProfileNameShape(notString)).toBe(false);
  });

  it("// @covers FR-01.75 the mirrored pattern carries no stateful flag", () => {
    expect(PROFILE_NAME_RE.flags).toBe("");
  });

  it("// @covers FR-01.75 an unusable name never becomes the profile answer, even when listed valid", () => {
    const listed = ["My_Stack", "ok-name"].map((name) => ({ name, description: "", valid: true, error: null }));
    let s: WizardState = wizardReducer({ ...INITIAL_STATE }, { t: "pickDoor", door: "new" });
    s = wizardReducer(s, { t: "setCustomProfiles", profiles: listed });
    expect(wizardReducer(s, { t: "setProfile", name: "My_Stack" }).answers.profile).toBeUndefined();
    expect(wizardReducer(s, { t: "setProfile", name: "ok-name" }).answers.profile).toBe("ok-name");
  });

  it("// @covers FR-01.75 resolveStackProfile ignores a custom name that fails the rule", () => {
    expect(resolveStackProfile({ profile: "My_Stack", remember: "Yes" }).profile).toBe("supabase-nextjs");
    expect(resolveStackProfile({ profile: "my-stack" }).profile).toBe("my-stack");
  });
});
