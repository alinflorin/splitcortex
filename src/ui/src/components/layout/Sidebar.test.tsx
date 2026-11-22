import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { en, renderApp } from '../../test/render';
import { Sidebar } from './Sidebar';

describe('Sidebar', () => {
  it('lists the top-level pages in order outside an organisation', async () => {
    await renderApp(<Sidebar open overlay={false} onOpenChange={vi.fn()} />);
    const names = screen.getAllByRole('link').map((l) => l.textContent);
    expect(names).toEqual([
      en.nav.home,
      en.nav.organisations,
      en.nav.playground,
      en.nav.about,
      en.nav.contact,
    ]);
    expect(screen.getByRole('link', { name: en.nav.organisations })).toHaveAttribute(
      'href',
      '/organisations',
    );
    expect(screen.getByRole('link', { name: en.nav.playground })).toHaveAttribute(
      'href',
      '/playground',
    );
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
    expect(screen.getByRole('link', { name: en.nav.organisations })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: en.nav.expand }));
    expect(onToggle).toHaveBeenCalled();
  });
});
