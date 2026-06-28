// @ts-nocheck
import { motion, AnimatePresence } from 'motion/react';
import { CheckCircle2, Loader2 } from 'lucide-react';
import type { ToastState } from './types';

export function Toast({ toasts }: { toasts: ToastState[] }) {
  return (
    <div className="fixed bottom-6 right-6 z-[200] flex flex-col gap-2 pointer-events-none">
      <AnimatePresence>
        {toasts.map(t => (
          <motion.div
            key={t.id}
            initial={{ opacity: 0, y: 12, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.97 }}
            transition={{ duration: 0.2 }}
            className={`flex items-center gap-2.5 px-4 py-3 rounded-xl shadow-lg border text-sm font-medium pointer-events-auto ${
              t.type === 'success'
                ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                : 'bg-card border-border text-foreground'
            }`}
          >
            {t.type === 'success'
              ? <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0" />
              : <Loader2 className="w-4 h-4 text-primary animate-spin flex-shrink-0" />}
            {t.message}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
