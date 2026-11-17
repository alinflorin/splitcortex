import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderApp } from '../test/render';
import { Playground } from './Playground';

const stream = (text: string) =>
  new Response(
    new ReadableStream({
      start(c) {
        const enc = new TextEncoder();
        c.enqueue(
          enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`),
        );
        c.enqueue(enc.encode('data: [DONE]\n\n'));
        c.close();
      },
    }),
  );

afterEach(() => vi.unstubAllGlobals());

describe('Playground', () => {
  it('connects with a key, then chats and keeps the history in the next request', async () => {
    const fetchMock = vi.fn((url: string, _init?: RequestInit) =>
      Promise.resolve(
        url.endsWith('/models') ? Response.json({ data: [{ id: 'gemma' }] }) : stream('Hi there'),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    await renderApp(<Playground />);

    expect(screen.queryByLabelText('Message')).not.toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(/API key/), 'sc_secret');
    await userEvent.click(screen.getByRole('button', { name: 'Connect' }));
    expect(await screen.findByLabelText('Message')).toBeInTheDocument();
    expect(fetchMock.mock.calls[0]?.[0]).toBe(`${window.location.origin}/v1/models`);

    await userEvent.type(screen.getByLabelText('Message'), 'Hello{Enter}');
    expect(await screen.findByText('Hi there')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Message'), 'Again{Enter}');
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    const body = JSON.parse(fetchMock.mock.calls[2]?.[1]?.body as string) as {
      messages: { role: string; content: string }[];
    };
    expect(body.messages.map((m) => m.content)).toEqual(['Hello', 'Hi there', 'Again']);
  });

  it('shows the gateway error when the key is rejected', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          Response.json({ error: { message: 'Invalid API key' } }, { status: 401 }),
        ),
    );
    await renderApp(<Playground />);
    await userEvent.type(screen.getByLabelText(/API key/), 'nope');
    await userEvent.click(screen.getByRole('button', { name: 'Connect' }));
    expect(await screen.findByText('Invalid API key')).toBeInTheDocument();
    expect(screen.queryByLabelText('Message')).not.toBeInTheDocument();
  });

  it('attaches a text file and an image and sends them as part of the message', async () => {
    const fetchMock = vi.fn((url: string, _init?: RequestInit) =>
      Promise.resolve(
        url.endsWith('/models')
          ? Response.json({
              data: [{ id: 'gemma', input_modalities: ['text', 'image'] }],
            })
          : stream('A cat'),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    await renderApp(<Playground />);
    await userEvent.type(screen.getByLabelText(/API key/), 'sc_secret');
    await userEvent.click(screen.getByRole('button', { name: 'Connect' }));
    await screen.findByLabelText('Message');

    const input = screen.getByTestId('attachment-input');
    await userEvent.upload(input, [
      new File(['some notes'], 'notes.txt', { type: 'text/plain' }),
      new File([new Uint8Array([1, 2, 3])], 'cat.png', { type: 'image/png' }),
    ]);
    expect(await screen.findByText('cat.png')).toBeInTheDocument();
    expect(screen.queryByText(/may be refused/)).not.toBeInTheDocument();

    // an attachment alone is enough to send
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByText('A cat')).toBeInTheDocument();
    const body = JSON.parse(fetchMock.mock.calls[1]?.[1]?.body as string) as {
      messages: { content: unknown }[];
    };
    expect(body.messages[0]?.content).toEqual([
      { type: 'text', text: '[File: notes.txt]\n```\nsome notes\n```' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,AQID' } },
    ]);
    expect(screen.getByAltText('cat.png')).toBeInTheDocument();
  });

  it('warns when the model reports no input for an attached kind, and rejects unsupported files', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(Response.json({ data: [{ id: 'text-only', input_modalities: ['text'] }] })),
      ),
    );
    await renderApp(<Playground />);
    await userEvent.type(screen.getByLabelText(/API key/), 'sc_secret');
    await userEvent.click(screen.getByRole('button', { name: 'Connect' }));
    await screen.findByLabelText('Message');

    await userEvent.upload(screen.getByTestId('attachment-input'), [
      new File([new Uint8Array([1])], 'doc.pdf', { type: 'application/pdf' }),
    ]);
    expect(await screen.findByText(/can't be attached/)).toBeInTheDocument();

    await userEvent.upload(screen.getByTestId('attachment-input'), [
      new File([new Uint8Array([1])], 'cat.png', { type: 'image/png' }),
    ]);
    expect(
      await screen.findByText(/No node of this model reports image input/),
    ).toBeInTheDocument();
  });
});
