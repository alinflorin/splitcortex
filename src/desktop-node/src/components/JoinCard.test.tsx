import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderApp } from '../test/render';
import { JoinCard } from './JoinCard';

const h = vi.hoisted(() => ({ enroll: vi.fn() }));
vi.mock('../enrollment/client', async (orig) => ({
  ...(await orig<typeof import('../enrollment/client')>()),
  enroll: h.enroll,
}));
vi.mock('../lib/device', () => ({
  desktopDeviceInfo: async () => ({ name: 'Studio PC', platform: 'desktop' }),
}));

describe('JoinCard', () => {
  it('joins with the typed address and code', async () => {
    h.enroll.mockResolvedValue({
      nodeId: 'n1',
      fingerprint: 'AAAA-BBBB-CCCC',
      approved: true,
      gateway: null,
    });
    const onJoined = vi.fn();
    await renderApp(<JoinCard onJoined={onJoined} />);
    await userEvent.clear(screen.getByLabelText('Control plane address'));
    await userEvent.type(
      screen.getByLabelText('Control plane address'),
      'https://app.example.com/api/',
    );
    await userEvent.type(screen.getByLabelText('Join code'), 'K7M2QX9H4T');
    await userEvent.click(screen.getByRole('button', { name: 'Join' }));
    await waitFor(() => expect(onJoined).toHaveBeenCalled());
    expect(h.enroll).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'K7M2QX9H4T',
        baseUrl: 'https://app.example.com/api',
        device: expect.objectContaining({ platform: 'desktop' }),
      }),
    );
    // the enrollment is kept for the next start
    expect(JSON.parse(localStorage.getItem('sc-enrollment')!)).toMatchObject({
      nodeId: 'n1',
      enrollmentUrl: 'https://app.example.com/api',
    });
  });

  it('rejects a malformed address or code without calling the server, and explains a rejected one', async () => {
    h.enroll.mockReset();
    await renderApp(<JoinCard onJoined={vi.fn()} />);
    const url = screen.getByLabelText('Control plane address');
    const input = screen.getByLabelText('Join code');
    await userEvent.clear(url);
    await userEvent.type(url, 'not a url');
    await userEvent.type(input, 'abc');
    await userEvent.click(screen.getByRole('button', { name: 'Join' }));
    expect(await screen.findByText('Enter the code as XXXX-XXXXXX.')).toBeInTheDocument();
    expect(await screen.findByText(/Enter a full address/)).toBeInTheDocument();
    expect(h.enroll).not.toHaveBeenCalled();

    const { EnrollError } = await import('../enrollment/client');
    h.enroll.mockRejectedValue(new EnrollError('invalidCode'));
    await userEvent.clear(url);
    await userEvent.type(url, 'https://app.example.com/api');
    await userEvent.clear(input);
    await userEvent.type(input, 'K7M2QX9H4T');
    await userEvent.click(screen.getByRole('button', { name: 'Join' }));
    expect(await screen.findByText(/not valid, has expired/)).toBeInTheDocument();
  });
});
