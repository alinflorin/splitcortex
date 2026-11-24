import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import ro from '../../public/locales/ro/translation.json';
import { FeedbackProvider } from '../components/feedback/FeedbackProvider';
import { en, renderApp } from '../test/render';
import { QuickStart } from './QuickStart';

describe('QuickStart', () => {
  it('lists the six steps in order, the example software and the agents section', async () => {
    await renderApp(
      <FeedbackProvider>
        <QuickStart />
      </FeedbackProvider>,
    );
    expect(
      screen.getByRole('heading', { level: 1, name: en.quickstart.title }),
    ).toBeInTheDocument();
    const steps = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(steps).toEqual(en.quickstart.steps.map((s) => s.title));
    expect(en.quickstart.steps).toHaveLength(6);
    expect(screen.getByText('Cherry Studio')).toBeInTheDocument();
    expect(screen.getByText('Jan')).toBeInTheDocument();
    expect(screen.getByText(en.quickstart.agents.title)).toBeInTheDocument();
    expect(screen.getAllByText(/sc_…/).length).toBeGreaterThan(0);
  });

  it('has the same structure in Romanian as in English', () => {
    const shape = (v: unknown): unknown =>
      Array.isArray(v)
        ? v.map(shape)
        : v && typeof v === 'object'
          ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, shape(x)]))
          : typeof v;
    expect(shape(ro.quickstart)).toEqual(shape(en.quickstart));
    expect(shape(ro.help)).toEqual(shape(en.help));
  });
});
