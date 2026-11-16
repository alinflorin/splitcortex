import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderWithApi } from '../test/renderWithApi';
import { AppDownloads, DESKTOP_RELEASES_URL, MOBILE_RELEASES_URL } from './AppDownloads';

afterEach(() => vi.unstubAllGlobals());

describe('AppDownloads', () => {
  it('shows the mobile, desktop and web node apps', async () => {
    await renderWithApi(<AppDownloads />);
    expect(screen.getByText('Mobile app')).toBeInTheDocument();
    expect(screen.getByText('Desktop app')).toBeInTheDocument();
    expect(screen.getByText('Web node')).toBeInTheDocument();
  });

  it('links each app to its own release stream, and leaves the store badges inert', async () => {
    await renderWithApi(<AppDownloads />);
    const apk = screen.getByAltText('Download the APK from GitHub Releases').closest('a');
    expect(apk).toHaveAttribute('href', MOBILE_RELEASES_URL);
    expect(MOBILE_RELEASES_URL).toBe(
      'https://github.com/alinflorin/splitcortex/releases?q=mobile-node-v&expanded=true',
    );
    expect(apk).toHaveAttribute('target', '_blank');
    expect(screen.getByAltText('Get it on Google Play').closest('a')).toBeNull();
    expect(screen.getByAltText('Download on the App Store').closest('a')).toBeNull();

    const open = vi.fn();
    vi.stubGlobal('open', open);
    await userEvent.click(screen.getByRole('button', { name: 'Download for desktop' }));
    expect(open).toHaveBeenCalledWith(DESKTOP_RELEASES_URL, '_blank', 'noopener,noreferrer');
    expect(DESKTOP_RELEASES_URL).toContain('q=desktop-node-v');
  });

  it('opens the web node in a new tab without a code', async () => {
    const open = vi.fn();
    vi.stubGlobal('open', open);
    await renderWithApi(<AppDownloads />);
    await userEvent.click(screen.getByRole('button', { name: 'Open web node' }));
    const [url, target] = open.mock.calls[0] as [string, string];
    expect(url).toMatch(/^https:\/\//);
    expect(url).not.toContain('code');
    expect(target).toBe('_blank');
  });

  it('shares the web node link, or copies it when the browser cannot share', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'share', { value: share, configurable: true });
    await renderWithApi(<AppDownloads />);
    await userEvent.click(screen.getByRole('button', { name: 'Share link' }));
    await waitFor(() =>
      expect(share).toHaveBeenCalledWith(
        expect.objectContaining({ url: expect.stringMatching(/^https:\/\//) }),
      ),
    );

    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'share', { value: undefined, configurable: true });
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    await userEvent.click(screen.getByRole('button', { name: 'Share link' }));
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    expect(await screen.findByText('Web node link copied')).toBeInTheDocument();
  });
});
