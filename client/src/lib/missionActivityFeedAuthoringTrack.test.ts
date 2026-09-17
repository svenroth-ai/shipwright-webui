/*
 * iterate-2026-09-16-mission-feed-render-fidelity — split out of
 * `missionActivityFeedClassify.test.ts` alongside its own source module
 * (4th review round, bloat-ceiling split): TDD authoring-run detection. */
import { describe, expect, it } from "vitest";
import { isTestFilePath, sameTestFilePath, testInvocationTargetPath } from "./missionActivityFeedAuthoringTrack";

describe("isTestFilePath", () => {
  it("matches JS/TS test/spec file shapes", () => {
    expect(isTestFilePath("client/src/lib/foo.test.ts")).toBe(true);
    expect(isTestFilePath("client/src/lib/foo.spec.tsx")).toBe(true);
  });

  // 39th-round catch (openai, medium): a written-then-run `foo.test.mts`
  // wrongly kept the run-wide gate stamp the exemption exists to withhold.
  it("matches the ES/CommonJS module test extensions", () => {
    for (const path of ["src/foo.test.mts", "src/foo.spec.cts", "src/foo.test.mjs", "src/foo.spec.cjs"]) {
      expect(isTestFilePath(path)).toBe(true);
    }
    expect(testInvocationTargetPath("vitest run src/foo.test.mts")).toBe("src/foo.test.mts");
  });

  it("matches Python test file shapes (both naming conventions)", () => {
    expect(isTestFilePath("tests/test_foo.py")).toBe(true);
    expect(isTestFilePath("tests/foo_test.py")).toBe(true);
  });

  it("does not match a non-test file, even one that mentions 'test' in a directory name", () => {
    expect(isTestFilePath("client/src/test-utils/render.ts")).toBe(false);
    expect(isTestFilePath("client/src/lib/foo.ts")).toBe(false);
  });
});

describe("testInvocationTargetPath", () => {
  it("finds the single test-file path a targeted run names", () => {
    expect(testInvocationTargetPath("vitest run src/lib/foo.test.ts")).toBe("src/lib/foo.test.ts");
    expect(testInvocationTargetPath('uv run pytest "tests/test_foo.py"')).toBe("tests/test_foo.py");
  });

  // 55th (glm, low, test): the exclusion-flag set had no test pinning the
  // CONFIG spellings, so an edit could regress either direction silently.
  it("treats a --config / -c value as an excluded option value, never the run's target", () => {
    expect(testInvocationTargetPath("vitest run --config src/lib/foo.test.ts")).toBeNull();
    expect(testInvocationTargetPath("vitest run -c src/lib/foo.test.ts")).toBeNull();
    expect(testInvocationTargetPath("vitest run --config=src/lib/foo.test.ts")).toBeNull();
    expect(testInvocationTargetPath("vitest run -c vitest.config.ts src/lib/foo.test.ts")).toBe("src/lib/foo.test.ts");
  });

  // 58th-round catch (openai, medium): a RELATION/VCS mode selects a whole
  // dependency set, so its argument is never one freshly-written test's own
  // run even when it is spelled as a test path.
  it("treats a --related / --changed run as broad, never as a targeted run", () => {
    expect(testInvocationTargetPath("vitest --related src/lib/foo.test.ts")).toBeNull();
    expect(testInvocationTargetPath("vitest --related=src/lib/foo.test.ts")).toBeNull();
    expect(testInvocationTargetPath("vitest run --changed src/lib/foo.test.ts")).toBeNull();
  });

  // 69th (openai, medium), FIXED: the 58th added Vitest's relation/VCS modes
  // but not JEST's, so `--findRelatedTests <file>` - which runs every test
  // IMPORTING that file - had its value read as the target and wrongly
  // exempted. Falsify by removing either spelling from `BROAD_RUN_FLAGS`.
  it("treats Jest's --findRelatedTests / --onlyChanged run as broad, never as a targeted run", () => {
    expect(testInvocationTargetPath("jest --findRelatedTests src/lib/foo.test.ts")).toBeNull();
    expect(testInvocationTargetPath("jest --findRelatedTests=src/lib/foo.test.ts")).toBeNull();
    expect(testInvocationTargetPath("jest --onlyChanged src/lib/foo.test.ts")).toBeNull();
    // A plain positional Jest run is untouched — the bail is mode-scoped.
    expect(testInvocationTargetPath("jest src/lib/foo.test.ts")).toBe("src/lib/foo.test.ts");
  });

  // 59th (glm, low) asked for the uncovered spellings to be pinned; the 60th
  // (openai, medium) read that pin as locking in a WRONG answer and was right -
  // a `--root` DIRECTORY or `--testMatch` GLOB is never the run's own target,
  // so all three joined `EXCLUSION_FLAGS`. A boolean flag still precedes one.
  it("does not treat a --root / --testMatch / --coverage.include value as the run's target", () => {
    expect(testInvocationTargetPath("jest --testMatch src/lib/foo.test.ts")).toBeNull();
    expect(testInvocationTargetPath("vitest run --root src/__tests__/setup.ts")).toBeNull();
    expect(testInvocationTargetPath("vitest run --coverage.include=src/lib/foo.test.ts")).toBeNull();
    expect(testInvocationTargetPath("vitest run --root packages/api src/lib/foo.test.ts")).toBe("src/lib/foo.test.ts");
  });

  // 67th (glm, low), FIXED: `tokenize` strips no quotes from a `cd` argument —
  // it is a whitespace split — so a quoted directory built the prefix
  // `"client"` and the authoring run stopped being detected. Falsify by
  // dropping the quote strip in `leadingCdPrefix`.
  it("resolves a QUOTED leading cd the same as a bare one, and still bails when the quoted arg contains a space", () => {
    expect(testInvocationTargetPath('cd "client" && vitest run src/foo.test.ts')).toBe("client/src/foo.test.ts");
    expect(testInvocationTargetPath("cd 'client' && vitest run src/foo.test.ts")).toBe("client/src/foo.test.ts");
    expect(testInvocationTargetPath('cd "my dir" && vitest run src/foo.test.ts')).toBe("src/foo.test.ts");
    expect(testInvocationTargetPath('cd "~/client" && vitest run src/foo.test.ts')).toBe("src/foo.test.ts");
  });

  // 75th (openai, medium), FIXED: `--testNamePattern` takes a test NAME regex,
  // never a path, but a path-looking pattern was read as the run's own target —
  // wrongly exempting what may be a whole-suite run. Same shape as
  // `--reporter`/`--config`. Falsify by removing it from `EXCLUSION_FLAGS`.
  it("does not treat a --testNamePattern value as the run's target", () => {
    expect(testInvocationTargetPath("jest --testNamePattern src/lib/foo.test.ts")).toBeNull();
    expect(testInvocationTargetPath("vitest run --testNamePattern=src/lib/foo.test.ts")).toBeNull();
    expect(testInvocationTargetPath("vitest run --testNamePattern renders src/lib/foo.test.ts")).toBe("src/lib/foo.test.ts");
  });

  // 68th/76th (glm, low) ACCEPTED this as detection LOSS; the 80th (openai,
  // medium) re-raised it, the acceptance was FALSIFIED by probe, now FIXED:
  // `"src/my file.test.ts"` shattered, the quote-strip made the TAIL a clean
  // `file.test.ts`, suffix-matching a written `/repo/src/file.test.ts` — a
  // DIFFERENT file. Falsify by dropping the bail: line 1 gives "file.test.ts".
  it("bails entirely on a quoted run target containing a space, instead of matching its tail", () => {
    expect(testInvocationTargetPath('vitest run "src/my file.test.ts"')).toBeNull();
    expect(testInvocationTargetPath("vitest run 'src/my file.test.ts'")).toBeNull();
    // The harmful match the old acceptance could not see.
    expect(sameTestFilePath("/repo/src/file.test.ts", "file.test.ts")).toBe(true);
    // A balanced quoted target with NO space is unaffected — still resolved.
    expect(testInvocationTargetPath('vitest run "src/foo.test.ts"')).toBe("src/foo.test.ts");
    // 81st (glm, low): the round-80 bail was segment-wide, killing an
    // apostrophe in a quoted FILTER too. Falsify by hoisting it back out.
    expect(testInvocationTargetPath(`pytest -k "it's broken" tests/test_foo.py`)).toBe("tests/test_foo.py");
    // 82nd (glm, low): round 81 tested the odd COUNT alone, dropping an
    // apostrophe INSIDE an unquoted filename too. Only a LEADING/TRAILING odd
    // quote is launderable. Falsify by dropping the startsWith/endsWith clause.
    expect(testInvocationTargetPath("vitest run src/it's.test.ts")).toBe("src/it's.test.ts");
  });

  // 64th-round catch (glm, low), FIXED: the flag names are interpolated into
  // `FLAG_EQUALS`, and `--coverage.include`'s unescaped `.` matched ANY
  // character. `--coverage-include=<file>` therefore split, and because the
  // resulting `--coverage-include` token is NOT in `EXCLUSION_FLAGS`, its value
  // fell through to the scan and became the target - a FALSE exemption for a
  // broad coverage run. Falsify by dropping the `.replace(...)` escape.
  it("does not let an unescaped regex metacharacter in a flag name capture a near-miss spelling's value", () => {
    expect(testInvocationTargetPath("vitest run --coverage-include=src/lib/foo.test.ts")).not.toBe("src/lib/foo.test.ts");
  });

  it("returns null for a broad run that names no single test file", () => {
    expect(testInvocationTargetPath("npm test")).toBeNull();
    expect(testInvocationTargetPath("pytest")).toBeNull();
  });

  // External review (both reviewers): first-match-wins mislabeled a multi-file run.
  it("returns null for a multi-file run, even when one of its files is also matched by a single-file run elsewhere", () => {
    expect(testInvocationTargetPath("vitest run src/lib/a.test.ts src/lib/b.test.ts")).toBeNull();
  });

  // 3rd-round catch (glm, low): a deselected/ignored file names one being EXCLUDED, not run.
  it("does not treat a --deselect/--ignore flag's value as the run's target", () => {
    expect(testInvocationTargetPath("pytest tests/ --deselect tests/test_foo.py")).toBeNull();
    expect(testInvocationTargetPath("pytest --ignore tests/test_foo.py tests/test_bar.py")).toBe("tests/test_bar.py");
  });

  // 5th-round catch (openai, medium): `--flag=value` is ONE token, slipping the check above.
  it("does not treat a '--deselect=value'/'--ignore=value' flag's value as the run's target", () => {
    expect(testInvocationTargetPath("pytest tests/ --deselect=tests/test_foo.py")).toBeNull();
    expect(testInvocationTargetPath("pytest --ignore=tests/test_foo.py tests/test_bar.py")).toBe("tests/test_bar.py");
  });

  // 6th-round catch (openai, medium): a chained NON-test segment's mention is not the target.
  it("ignores a test-file mention inside a chained non-test segment", () => {
    expect(testInvocationTargetPath("git diff --check src/foo.test.ts && npm test")).toBeNull();
  });

  // 6th-round catch (glm, medium): a node-id selector defeats the `$`-anchored regex.
  it("recognizes a pytest node-id selector as targeting its own file", () => {
    expect(testInvocationTargetPath("pytest tests/test_foo.py::test_bar")).toBe("tests/test_foo.py");
    expect(testInvocationTargetPath("pytest tests/test_foo.py::TestClass::test_bar")).toBe("tests/test_foo.py");
  });

  // 7th-round catch (openai, medium): targeted + BROAD chained is itself a broader run.
  it("returns null when a targeted run is chained with a broad test invocation in the same command", () => {
    expect(testInvocationTargetPath("vitest run src/lib/foo.test.ts && npm test")).toBeNull();
  });

  // 9th-round catch (openai, medium): Vitest's `--exclude` was missing.
  it("does not treat a '--exclude' flag's value as the run's target", () => {
    expect(testInvocationTargetPath("vitest run --exclude src/lib/foo.test.ts")).toBeNull();
    expect(testInvocationTargetPath("vitest run --exclude=src/lib/foo.test.ts src/lib/bar.test.ts")).toBe("src/lib/bar.test.ts");
  });

  // 44th-round catch (openai, medium): a CONFIG/SETUP option's value is a
  // test-looking path but not a run target, so a BROAD run read as targeted.
  it("does not treat a setup/config/reporter flag's value as the run's target", () => {
    expect(testInvocationTargetPath("vitest run --setupFiles src/__tests__/setup.ts")).toBeNull();
    expect(testInvocationTargetPath("vitest run --setupFiles=src/__tests__/setup.ts")).toBeNull();
    expect(testInvocationTargetPath("jest --config jest.setup.test.ts src/lib/bar.test.ts")).toBe("src/lib/bar.test.ts");
    // A BOOLEAN flag still precedes a genuine target - the deliberate limit.
    expect(testInvocationTargetPath("vitest --run src/lib/foo.test.ts")).toBe("src/lib/foo.test.ts");
  });

  // 42nd-round catch (openai, medium, spec): Jest's `__tests__/` testMatch.
  it("matches a `__tests__/` file at any depth with no test/spec infix", () => {
    expect(isTestFilePath("src/__tests__/login.ts")).toBe(true);
    expect(isTestFilePath("src/__tests__/deep/login.tsx")).toBe(true);
    expect(isTestFilePath("src/__tests__/notes.md")).toBe(false);
  });

  // 10th-round catch (openai, medium): Jest's exclusion flag was missing.
  it("does not treat a '--testPathIgnorePatterns' flag's value as the run's target", () => {
    expect(testInvocationTargetPath("npm test -- --testPathIgnorePatterns src/lib/foo.test.ts")).toBeNull();
    expect(testInvocationTargetPath("jest --testPathIgnorePatterns=src/lib/foo.test.ts src/lib/bar.test.ts")).toBe("src/lib/bar.test.ts");
  });

  // 13th-round catch (glm, low): two spellings of one file must collapse to one match.
  it("collapses two spellings of the same file into a single match", () => {
    expect(testInvocationTargetPath("vitest run src/foo.test.ts ./src/foo.test.ts")).toBe("src/foo.test.ts");
  });

  // 13th-round (openai, medium): a leading `cd <dir>` resolves into the path.
  it("resolves the target path through a leading 'cd <dir>' chained before the test invocation", () => {
    expect(testInvocationTargetPath("cd client && vitest run src/lib/foo.test.ts")).toBe("client/src/lib/foo.test.ts");
    expect(testInvocationTargetPath("cd client && cd src && vitest run lib/foo.test.ts")).toBe("client/src/lib/foo.test.ts");
  });

  it("does not resolve through an absolute or unparseable leading 'cd'", () => {
    expect(testInvocationTargetPath("cd /abs/client && vitest run src/lib/foo.test.ts")).toBe("src/lib/foo.test.ts");
  });

  // 22nd-round catch (openai, medium; corrects a 16th-round premise): `cd` persists.
  it("resolves through every earlier 'cd', not just a chain contiguous with the test invocation", () => {
    expect(testInvocationTargetPath("cd a && npm run build; cd client && vitest run src/foo.test.ts")).toBe("a/client/src/foo.test.ts");
  });

  // 31st-round catch (openai, medium): `cd ..` produced a literal "client/../src/...".
  it("resolves a 'cd ..' that walks back out of an earlier 'cd' to the genuine target path", () => {
    expect(testInvocationTargetPath("cd client && cd .. && vitest run src/foo.test.ts")).toBe("src/foo.test.ts");
  });

  // 32nd-round catch (openai, medium): `||` means the test ran only if `cd` FAILED.
  it("does not resolve through a leading 'cd' joined to what follows by '||'", () => {
    expect(testInvocationTargetPath("cd client || vitest run src/foo.test.ts")).toBe("src/foo.test.ts");
  });

  // Reaching vitest proves the `&&` group failed AS A WHOLE, so even `cd a` is untrustworthy.
  it("also bails through an earlier '&&'-chained 'cd' once the chain as a whole is the uncertain '||' branch", () => {
    expect(testInvocationTargetPath("cd a && cd client || vitest run src/foo.test.ts")).toBe("src/foo.test.ts");
  });

  // 33rd-round catch (openai, medium): `|` and `&` each fork a subshell too.
  it("does not resolve through a leading 'cd' joined to what follows by a pipe (separate subshells)", () => {
    expect(testInvocationTargetPath("cd client | vitest run src/foo.test.ts")).toBe("src/foo.test.ts");
  });

  it("does not resolve through a leading 'cd' backgrounded with '&'", () => {
    expect(testInvocationTargetPath("cd client & vitest run src/foo.test.ts")).toBe("src/foo.test.ts");
  });

  // Guards the bail against widening to `;`, which a review slip lumped in.
  it("still resolves through the same-shell sequencing operators '&&' and ';'", () => {
    expect(testInvocationTargetPath("cd client; vitest run src/foo.test.ts")).toBe("client/src/foo.test.ts");
    expect(testInvocationTargetPath("cd client && vitest run src/foo.test.ts")).toBe("client/src/foo.test.ts");
  });

  // 34th-round catch (glm, low): a deny-list let the mash `&|` through; now an ALLOW-list.
  it("does not resolve through a mashed separator run that is neither '&&' nor ';'", () => {
    expect(testInvocationTargetPath("cd client &| vitest run src/foo.test.ts")).toBe("src/foo.test.ts");
    expect(testInvocationTargetPath("cd client ;& vitest run src/foo.test.ts")).toBe("src/foo.test.ts");
  });

  // 35th-round (glm, low; openai's `||` half medium): the check ran only ADJACENT to each `cd`.
  it("does not resolve through a 'cd' when a LATER operator forks before the test segment", () => {
    expect(testInvocationTargetPath("cd client && npm run build & vitest run src/foo.test.ts")).toBe("src/foo.test.ts");
    expect(testInvocationTargetPath("cd client && npm run build | vitest run src/foo.test.ts")).toBe("src/foo.test.ts");
    // openai's second suggested case, covered by the same walk.
    expect(testInvocationTargetPath("cd client && failing-command || vitest run src/foo.test.ts")).toBe("src/foo.test.ts");
  });

  // 35th-round catch (openai, medium), DECLINED - pins the accepted behaviour:
  // this module assumes steps SUCCEEDED. See the note by `leadingCdPrefix`.
  it("still resolves a 'cd' whose branch is rejoined by ';' (accepted: steps are assumed to have succeeded)", () => {
    expect(testInvocationTargetPath("cd client && true; vitest run src/foo.test.ts")).toBe("client/src/foo.test.ts");
  });

  // 37th-round catch (glm, low): `~`/`$VAR` are SHELL-expanded, `cd a b` is a
  // `cd` ERROR, and `cd --` pins the DECLINED half - it already bailed.
  it.each([
    "cd ~/client && vitest run src/foo.test.ts",
    "cd ~ && vitest run src/foo.test.ts",
    "cd $HOME/client && vitest run src/foo.test.ts",
    "cd a b && vitest run src/foo.test.ts",
    "cd -- client && vitest run src/foo.test.ts",
  ])("declines a 'cd' this module cannot resolve lexically: %s", (shell) => {
    expect(testInvocationTargetPath(shell)).toBe("src/foo.test.ts");
  });

  // 34th-round catch (openai, medium), DECLINED as unreachable - pinned
  // counter-evidence: `Write` REQUIRES an absolute `file_path` to bridge onto.
  it("matches a 'cd'-resolved monorepo target against the ABSOLUTE path a real Write records", () => {
    const target = testInvocationTargetPath("cd client && npx vitest run src/lib/foo.test.ts");
    expect(target).toBe("client/src/lib/foo.test.ts");
    expect(sameTestFilePath("C:\\proj\\client\\src\\lib\\foo.test.ts", target!)).toBe(true);
    expect(sameTestFilePath("/home/u/proj/client/src/lib/foo.test.ts", target!)).toBe(true);
    // ...and still declines a same-named test in a DIFFERENT package.
    expect(sameTestFilePath("/home/u/proj/server/src/lib/foo.test.ts", target!)).toBe(false);
  });

  // 43rd-round catch (openai, medium), DECLINED and re-declined in the 44th —
  // the ACCEPTED false positive in the OTHER direction, pinned so it stays
  // visible. With no cwd in the reducer, the suffix bridge cannot tell a
  // monorepo sibling from the real target. See `sameTestFilePath`'s note.
  it("bridges an absolute monorepo path onto a same-suffix BARE relative target (accepted false positive)", () => {
    expect(sameTestFilePath("/repo/packages/api/src/foo.test.ts", "src/foo.test.ts")).toBe(true);
  });
});
