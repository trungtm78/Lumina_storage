// @ts-nocheck
import { useState } from 'react';
import type { ToastState } from './types';

export function useToast() {
  const [toasts, setToasts] = useState<ToastState[]>([]);
  const push = (message: string, type: ToastState['type'] = 'info', duration = 2200) => {
    const id = Date.now();
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), duration);
  };
  return { toasts, push };
}
