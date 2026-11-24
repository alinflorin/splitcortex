import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import ro from '../../public/locales/ro/translation.json';
import { FeedbackProvider } from '../components/feedback/FeedbackProvider';
import { en, renderApp } from '../test/render';
import { Help } from './Help';

describe('Help', () => {
  it('renders every section, the Quick start link and the troubleshooting cards', async () => {
    await renderApp(
      <FeedbackProvider>
        <Help />
      </FeedbackProvider>,
    );
    expect(screen.getByRole('heading', { level: 1, name: en.help.title })).toBeInTheDocument();
    for (const [id, label] of Object.entries(en.help.sections)) {
      expect(screen.getByRole('link', { name: label })).toHaveAttribute('href', `#${id}`);
      expect(document.getElementById(id)).not.toBeNull();
    }
    expect(screen.getByRole('link', { name: en.help.quickstart.button })).toHaveAttribute(
      'href',
      '/quick-start',
    );
    for (const item of en.help.troubleshoot.items) {
      expect(screen.getByText(item.title)).toBeInTheDocument();
    }
  });

  it('has the same structure in Romanian as in English', () => {
    const shape = (v: unknown): unknown =>
      Array.isArray(v)
        ? v.map(shape)
        : v && typeof v === 'object'
          ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, shape(x)]))
          : typeof v;
    expect(shape(ro.help)).toEqual(shape(en.help));
    expect(ro.seo.help.title.length).toBeLessThanOrEqual(65);
    expect(ro.seo.help.description.length).toBeLessThanOrEqual(170);
  });
});
