import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderWithApi } from '../test/renderWithApi';
import {
  AppDownloads,
  CLI_INSTALL_PS1,
  CLI_INSTALL_SH,
  CLI_RELEASES_URL,
  DESKTOP_RELEASES_URL,
  MOBILE_RELEASES_URL,
} from './AppDownloads';

afterEach(() => vi.unstubAllGlobals());

describe('AppDownloads', () => {
  it('shows the mobile, desktop, command line and web node apps', async () => {
    await renderWithApi(<AppDownloads />);
    expect(screen.getByText('Mobile app')).toBeInTheDocument();
    expect(screen.getByText('Desktop app')).toBeInTheDocument();
    expect(screen.getByText('Command line')).toBeInTheDocument();
    expect(screen.getByText('Web node')).toBeInTheDocument();
  });

  it('links each app to its own release stream, and leaves the store buttons inert', async () => {
    await renderWithApi(<AppDownloads />);
    const open = vi.fn();
    vi.stubGlobal('open', open);
    await userEvent.click(screen.getByRole('button', { name: 'Download APK' }));
    expect(open).toHaveBeenCalledWith(MOBILE_RELEASES_URL, '_blank', 'noopener,noreferrer');
    expect(MOBILE_RELEASES_URL).toBe(
      'https://github.com/alinflorin/splitcortex/releases/tag/mobile-node-latest',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Google Play' }));
    await userEvent.click(screen.getByRole('button', { name: 'App Store' }));
    expect(open).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByRole('button', { name: 'Download for desktop' }));
    expect(open).toHaveBeenCalledWith(DESKTOP_RELEASES_URL, '_blank', 'noopener,noreferrer');
    expect(DESKTOP_RELEASES_URL).toContain('/tag/desktop-node-latest');
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

  it('offers the command line install commands, copies them and links its releases', async () => {
    expect(CLI_INSTALL_SH).toBe(
      'curl -fsSL https://raw.githubusercontent.com/alinflorin/splitcortex/main/src/cli-node/install.sh | sh',
    );
    expect(CLI_INSTALL_PS1).toContain('install.ps1 | iex');
    expect(CLI_RELEASES_URL).toContain('/tag/cli-node-latest');
    await renderWithApi(<AppDownloads />);
    expect(screen.getByText(CLI_INSTALL_SH)).toBeInTheDocument();
    expect(screen.getByText(CLI_INSTALL_PS1)).toBeInTheDocument();

    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    await userEvent.click(screen.getByRole('button', { name: 'Copy: Windows (PowerShell)' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(CLI_INSTALL_PS1));
    expect(await screen.findByText('Command copied')).toBeInTheDocument();

    const open = vi.fn();
    vi.stubGlobal('open', open);
    await userEvent.click(screen.getByRole('button', { name: 'All command line downloads' }));
    expect(open).toHaveBeenCalledWith(CLI_RELEASES_URL, '_blank', 'noopener,noreferrer');
  });
});
