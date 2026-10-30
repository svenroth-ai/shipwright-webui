// CLAUDE.md is always-loaded orientation: each numbered rule is ONE line + a
// pointer. Long-form rationale belongs in .shipwright/agent_docs/regression_guards.md.
import { describe, expect, it } from 'vitest';

const MAX_RULE_CHARS = 700;

describe('CLAUDE.md stays lean', () => {
  it('every numbered rule is ≤ MAX_RULE_CHARS and rationale lives in regression_guards.md', async () => {
    const fs = await import('node:fs' as string);
    const path = await import('node:path' as string);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const url = (await import('node:url' as string)) as any;
    const here = path.dirname(url.fileURLToPath((import.meta as any).url));
    const root = path.resolve(here, '../../../');
    const md: string = fs.readFileSync(path.join(root, 'CLAUDE.md'), 'utf8');
    const offenders = md
      .split(/\r?\n/)
      .filter((l) => /^\d+\. /.test(l) && l.length > MAX_RULE_CHARS)
      .map((l) => `${l.slice(0, 50)}… (${l.length} chars)`);
    expect(offenders, 'Move rationale to .shipwright/agent_docs/regression_guards.md').toEqual([]);
    expect(
      fs.existsSync(path.join(root, '.shipwright/agent_docs/regression_guards.md')),
    ).toBe(true);
  });
});
