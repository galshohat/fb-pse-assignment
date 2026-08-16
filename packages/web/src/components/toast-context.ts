import { createContext, useContext } from 'react';

/**
 * Kept apart from the provider component so that a file exports either
 * components or plain values, which is what Fast Refresh needs to work.
 */

export type ToastTone = 'ok' | 'warn' | 'danger';

export interface Toast {
  readonly id: number;
  readonly tone: ToastTone;
  readonly title: string;
  readonly body?: string;
  readonly link?: { readonly href: string; readonly label: string };
  /**
   * Sticky toasts are never dismissed on a timer. Used for anything the user
   * still needs — a transaction hash for a write that has not confirmed is the
   * only handle they have on it, so it stays until they close it.
   */
  readonly sticky?: boolean;
}

export type PushToast = (toast: Omit<Toast, 'id'>) => void;

export const ToastContext = createContext<PushToast | null>(null);

export function useToasts(): PushToast {
  const push = useContext(ToastContext);

  if (!push) {
    throw new Error('useToasts must be used inside <ToastProvider>');
  }

  return push;
}
