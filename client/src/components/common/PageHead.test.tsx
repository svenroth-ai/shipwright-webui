import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { PageHead } from './PageHead';

/*
 * PageHead structural contract (A05, AC1). jsdom cannot measure the 92px box or
 * the 32px gutter (no layout engine) — that is the Playwright geometry spec
 * (e2e/visual/04-chrome-a05.spec.ts). Here we lock the STRUCTURE the CSS keys
 * off: `.page-head` (block + min-height, NOT flex) with a `.inner`, `.page-title`
 * for the heading, `<small>` + `.page-sub` for the secondary text.
 */
describe('PageHead (AC1 structure)', () => {
  it('renders a `.page-head` header with a `.page-title` heading', () => {
    render(<PageHead title="Settings" testId="settings-header" titleTestId="settings-title" />);
    const header = screen.getByTestId('settings-header');
    expect(header.tagName).toBe('HEADER');
    expect(header.className).toContain('page-head');
    // The OUTER element must NOT be flex (the prototype's do-not-make-it-flex
    // warning — flex breaks the inner max-width/margin:auto centring).
    expect(header.className).not.toMatch(/\bflex\b/);
    expect(header.querySelector('.inner')).not.toBeNull();
    const title = screen.getByTestId('settings-title');
    expect(title.tagName).toBe('H1');
    expect(title.className).toContain('page-title');
    expect(title.textContent).toContain('Settings');
  });

  it('renders `small` inside a <small> and `sub` in a `.page-sub`', () => {
    render(
      <PageHead
        title="Inbox"
        small={<span data-testid="c">(3 open)</span>}
        sub="a sub line"
        testId="inbox-header"
      />,
    );
    const header = screen.getByTestId('inbox-header');
    expect(header.querySelector('small')).not.toBeNull();
    expect(screen.getByTestId('c').textContent).toBe('(3 open)');
    const sub = header.querySelector('.page-sub');
    expect(sub?.textContent).toBe('a sub line');
  });

  it('the `left` slot REPLACES the default title block (board)', () => {
    render(
      <PageHead
        testId="task-board-header"
        left={<div data-testid="board-controls">controls</div>}
        actions={<button>New</button>}
      />,
    );
    const header = screen.getByTestId('task-board-header');
    expect(screen.getByTestId('board-controls')).toBeInTheDocument();
    // No default title heading when `left` is used.
    expect(header.querySelector('.page-title')).toBeNull();
    expect(screen.getByRole('button', { name: 'New' })).toBeInTheDocument();
  });

  it('board `wide` widens the inner box (1600 gutter)', () => {
    render(<PageHead testId="h" wide left={<span>x</span>} />);
    const inner = screen.getByTestId('h').querySelector('.inner');
    expect(inner?.className).toContain('wide');
  });
});
