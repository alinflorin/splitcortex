import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderWithApi } from '../test/renderWithApi';
import { Endpoints } from './Endpoints';

afterEach(() => vi.unstubAllGlobals());

describe('Endpoints', () => {
  it('shows the gateway and API addresses and copies them', async () => {
    await renderWithApi(<Endpoints />);
    expect(screen.getByText('Gateway (OpenAI API)')).toBeInTheDocument();
    expect(screen.getByText('Control plane API')).toBeInTheDocument();
    expect(screen.getByText(`${window.location.origin}/api`)).toBeInTheDocument();
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    await userEvent.click(screen.getByRole('button', { name: 'Copy: Control plane API' }));
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/api`);
  });
});
