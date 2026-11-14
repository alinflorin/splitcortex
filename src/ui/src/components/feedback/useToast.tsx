import {
  Toast,
  ToastBody,
  ToastTitle,
  Toaster,
  useId,
  useToastController,
} from '@fluentui/react-components';
import type { ToastIntent } from '@fluentui/react-components';
import { createContext, useContext, useMemo } from 'react';
import type { ReactNode } from 'react';

export interface ToastOptions {
  /** Optional secondary line under the title. */
  body?: ReactNode;
  /** Milliseconds before auto-dismiss; `-1` keeps it until dismissed. Default 4000. */
  timeout?: number;
}

export interface ToastApi {
  success: (title: ReactNode, options?: ToastOptions) => void;
  error: (title: ReactNode, options?: ToastOptions) => void;
  warning: (title: ReactNode, options?: ToastOptions) => void;
  info: (title: ReactNode, options?: ToastOptions) => void;
  dismissAll: () => void;
}

const ToastContext = createContext<ToastApi | null>(null);

const DEFAULT_TIMEOUT = 4000;

/** Mounts the Fluent `Toaster` and provides `useToast()`. Must be inside a FluentProvider. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const toasterId = useId('toaster');
  const { dispatchToast, dismissAllToasts } = useToastController(toasterId);

  const api = useMemo<ToastApi>(() => {
    const show =
      (intent: ToastIntent) =>
      (title: ReactNode, { body, timeout = DEFAULT_TIMEOUT }: ToastOptions = {}) =>
        dispatchToast(
          <Toast>
            <ToastTitle>{title}</ToastTitle>
            {body && <ToastBody>{body}</ToastBody>}
          </Toast>,
          { intent, timeout },
        );
    return {
      success: show('success'),
      error: show('error'),
      warning: show('warning'),
      info: show('info'),
      dismissAll: dismissAllToasts,
    };
  }, [dispatchToast, dismissAllToasts]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <Toaster toasterId={toasterId} position="bottom-end" limit={5} />
    </ToastContext.Provider>
  );
}

/**
 * `const toast = useToast(); toast.success(t('settings.saved'));`
 * Also `error`, `warning`, `info` and `dismissAll`.
 */
export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}
