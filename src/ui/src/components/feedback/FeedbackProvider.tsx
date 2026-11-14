import type { ReactNode } from 'react';
import { ConfirmProvider } from './useConfirm';
import { ToastProvider } from './useToast';

/** Wraps the app with the confirmation dialog and toast providers (inside the FluentProvider). */
export function FeedbackProvider({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      <ConfirmProvider>{children}</ConfirmProvider>
    </ToastProvider>
  );
}
