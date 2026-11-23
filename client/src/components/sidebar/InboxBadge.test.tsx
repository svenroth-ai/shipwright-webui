import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { InboxBadge } from './InboxBadge';

describe('InboxBadge', () => {
  it('renders nothing when count is 0', () => {
    const { container } = render(<InboxBadge count={0} />);
    expect(container.firstChild).toBeNull();
  });

  it('shows count for values 1-99', () => {
    render(<InboxBadge count={5} />);
    expect(screen.getByText('5')).toBeInTheDocument();
  });

  it('shows 99+ when count exceeds 99', () => {
    render(<InboxBadge count={100} />);
    expect(screen.getByText('99+')).toBeInTheDocument();
  });

  it('shows exact count at boundary 99', () => {
    render(<InboxBadge count={99} />);
    expect(screen.getByText('99')).toBeInTheDocument();
  });

  // @covers FR-01.76
  it('with a problem and nothing counted shows the "!" alone, never an empty inbox', () => {
    render(<InboxBadge count={0} problem />);
    const badge = screen.getByTestId('inbox-badge-problem');
    expect(badge).toHaveTextContent('!');
    expect(badge).toHaveTextContent('some reminders could not be read');
  });

  // @covers FR-01.76
  it('with a problem and a count shows both, and says so to a screen reader', () => {
    render(<InboxBadge count={3} problem />);
    const badge = screen.getByTestId('inbox-badge-problem');
    expect(badge).toHaveTextContent('3!');
    expect(badge).toHaveTextContent('3!, some reminders could not be read');
    expect(badge).not.toHaveAttribute('aria-label');
  });

  // @covers FR-01.76
  it('without a problem there is no marker', () => {
    render(<InboxBadge count={2} />);
    expect(screen.queryByTestId('inbox-badge-problem')).toBeNull();
    expect(screen.getByText('2')).toBeInTheDocument();
  });
});
