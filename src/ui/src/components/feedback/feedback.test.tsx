import { describe, expect, it } from 'vitest';
import { Button } from '@fluentui/react-components';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { renderApp } from '../../test/render';
import { FeedbackProvider } from './FeedbackProvider';
import { useConfirm } from './useConfirm';
import { useToast } from './useToast';

function Demo() {
  const confirm = useConfirm();
  const toast = useToast();
  const [result, setResult] = useState('none');
  return (
    <>
      <Button
        onClick={() =>
          void confirm({
            title: 'Delete pool?',
            message: 'This cannot be undone.',
            destructive: true,
          }).then((ok) => setResult(String(ok)))
        }
      >
        ask
      </Button>
      <Button onClick={() => toast.success('Saved', { body: 'All good' })}>toast</Button>
      <span data-testid="result">{result}</span>
    </>
  );
}

describe('feedback', () => {
  it('resolves true when confirmed', async () => {
    const user = userEvent.setup();
    await renderApp(
      <FeedbackProvider>
        <Demo />
      </FeedbackProvider>,
    );
    await user.click(screen.getByText('ask'));
    expect(await screen.findByText('Delete pool?')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(screen.getByTestId('result')).toHaveTextContent('true'));
  });

  it('resolves false when cancelled', async () => {
    const user = userEvent.setup();
    await renderApp(
      <FeedbackProvider>
        <Demo />
      </FeedbackProvider>,
    );
    await user.click(screen.getByText('ask'));
    await user.click(await screen.findByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.getByTestId('result')).toHaveTextContent('false'));
  });

  it('shows a toast', async () => {
    const user = userEvent.setup();
    await renderApp(
      <FeedbackProvider>
        <Demo />
      </FeedbackProvider>,
    );
    await user.click(screen.getByText('toast'));
    expect(await screen.findByText('Saved')).toBeInTheDocument();
    expect(screen.getByText('All good')).toBeInTheDocument();
  });
});
