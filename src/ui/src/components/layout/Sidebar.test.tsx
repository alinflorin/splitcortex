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
    expect(screen.getByRole('link', { name: en.nav.organisations })).toHaveAttribute(
      'href',
      '/organisations',
    );
    expect(screen.getByRole('link', { name: en.nav.playground })).toHaveAttribute(
      'href',
      '/playground',
    );
    // the way back to the public site is always in the sidebar
    expect(screen.getByRole('link', { name: en.nav.home })).toHaveAttribute('href', '/');
    expect(screen.getByRole('link', { name: en.nav.about })).toHaveAttribute('href', '/about');
    expect(screen.getByRole('link', { name: en.nav.contact })).toHaveAttribute('href', '/contact');
    expect(screen.queryByRole('link', { name: 'Settings' })).not.toBeInTheDocument();
  });

  it('closes the overlay after navigating', async () => {
    const onOpenChange = vi.fn();
    await renderApp(<Sidebar open overlay onOpenChange={onOpenChange} />);
    await userEvent.click(screen.getByRole('link', { name: en.nav.playground }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('keeps an inline sidebar open after navigating', async () => {
    const onOpenChange = vi.fn();
    await renderApp(<Sidebar open overlay={false} onOpenChange={onOpenChange} />);
    await userEvent.click(screen.getByRole('link', { name: en.nav.playground }));
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('collapses to an icon rail that keeps accessible names, and toggles', async () => {
    const onToggle = vi.fn();
    await renderApp(
      <Sidebar
        open
        overlay={false}
        onOpenChange={vi.fn()}
        collapsed
        onToggleCollapsed={onToggle}
      />,
    );
    expect(screen.queryByText('cortex')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: en.nav.organisations })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: en.nav.expand }));
    expect(onToggle).toHaveBeenCalled();
  });
});
