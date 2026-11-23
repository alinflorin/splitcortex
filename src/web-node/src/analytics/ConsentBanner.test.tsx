import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { en, renderApp } from '../test/render';
import { ConsentBanner, privacyUrl } from './ConsentBanner';
import { resetAnalyticsConfigForTests } from './config';
import { getConsent, reopenConsent } from './consent';

const serve = (analyticsId: string) =>
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ analyticsId }), { status: 200 })),
  );

beforeEach(() => resetAnalyticsConfigForTests());
afterEach(() => vi.unstubAllGlobals());

describe('ConsentBanner', () => {
  it('asks nothing where no analytics is configured (local, stg)', async () => {
    serve('');
    await renderApp(<ConsentBanner />);
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('asks once in production and remembers the choice', async () => {
    serve('G-TEST123456');
    await renderApp(<ConsentBanner />);
    expect(await screen.findByRole('dialog', { name: en.consent.title })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: en.consent.accept }));
    expect(getConsent()).toBe('granted');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('opens again from "Cookie settings" and can withdraw', async () => {
    serve('G-TEST123456');
    window.localStorage.setItem('sc-consent', 'granted');
    await renderApp(<ConsentBanner />);
    await new Promise((r) => setTimeout(r, 20));
    act(() => reopenConsent());
    await userEvent.click(await screen.findByRole('button', { name: en.consent.decline }));
    expect(getConsent()).toBe('denied');
  });

  it('links to the privacy policy of the web app', () => {
    expect(privacyUrl('en', 'web-node.splitcortex.com')).toBe('https://splitcortex.com/privacy');
    expect(privacyUrl('ro', 'web-node.stg.splitcortex.com')).toBe(
      'https://stg.splitcortex.com/ro/privacy',
    );
    expect(privacyUrl('en', 'localhost')).toBeNull();
  });
});
