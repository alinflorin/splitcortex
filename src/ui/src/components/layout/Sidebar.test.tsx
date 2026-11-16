import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { en, renderApp } from '../../test/render';
import { Sidebar } from './Sidebar';

describe('Sidebar', () => {
  it('renders the brand and navigation links', async () => {
    await renderApp(<Sidebar open overlay={false} onOpenChange={vi.fn()} />);
    expect(screen.getByText('split')).toBeInTheDocument();
    expect(screen.getByText('cortex')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: en.nav.home })).toHaveAttribute('href', '/');
    expect(screen.getByRole('link', { name: en.nav.about })).toHaveAttribute('href', '/about');
    expect(screen.getByRole('link', { name: en.nav.settings })).toHaveAttribute(
      'href',
      '/settings',
    );
  });

  it('closes the overlay after navigating', async () => {
    const onOpenChange = vi.fn();
    await renderApp(<Sidebar open overlay onOpenChange={onOpenChange} />);
    await userEvent.click(screen.getByRole('link', { name: en.nav.about }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('keeps an inline sidebar open after navigating', async () => {
    const onOpenChange = vi.fn();
    await renderApp(<Sidebar open overlay={false} onOpenChange={onOpenChange} />);
    await userEvent.click(screen.getByRole('link', { name: en.nav.about }));
    expect(onOpenChange).not.toHaveBeenCalled();
  });
});
