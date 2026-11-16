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

describe('JoinCard', () => {
  it('shows the code the link carried and joins with it', async () => {
    h.enroll.mockResolvedValue({
      nodeId: 'n1',
      fingerprint: 'AAAA-BBBB-CCCC',
      approved: true,
      gateway: null,
    });
    const onJoined = vi.fn();
    await renderApp(<JoinCard initialCode="K7M2-QX9H4T" onJoined={onJoined} />);
    expect(screen.getByLabelText('Join code')).toHaveValue('K7M2-QX9H4T');
    await userEvent.click(screen.getByRole('button', { name: 'Join' }));
    await waitFor(() => expect(onJoined).toHaveBeenCalled());
    expect(h.enroll).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'K7M2-QX9H4T',
        baseUrl: `${location.origin}/api`,
        device: expect.objectContaining({ platform: 'web' }),
      }),
    );
    // the enrollment is kept for the next visit
    expect(JSON.parse(localStorage.getItem('sc-enrollment')!)).toMatchObject({ nodeId: 'n1' });
  });

  it('rejects a malformed code without calling the server, and explains a rejected one', async () => {
    h.enroll.mockReset();
    await renderApp(<JoinCard initialCode="" onJoined={vi.fn()} />);
    const input = screen.getByLabelText('Join code');
    await userEvent.type(input, 'abc');
    await userEvent.click(screen.getByRole('button', { name: 'Join' }));
    expect(await screen.findByText('Enter the code as XXXX-XXXXXX.')).toBeInTheDocument();
    expect(h.enroll).not.toHaveBeenCalled();

    const { EnrollError } = await import('../enrollment/client');
    h.enroll.mockRejectedValue(new EnrollError('invalidCode'));
    await userEvent.clear(input);
    await userEvent.type(input, 'K7M2QX9H4T');
    await userEvent.click(screen.getByRole('button', { name: 'Join' }));
    expect(await screen.findByText(/not valid, has expired/)).toBeInTheDocument();
  });
});
