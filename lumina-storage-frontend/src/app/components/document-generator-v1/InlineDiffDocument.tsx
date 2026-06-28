import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, X, Loader2, AlertTriangle } from 'lucide-react';
import { ScrollArea } from '@/app/components/ui/scroll-area';
import type { BlockOpSuggestion } from './types';

interface InlineDiffDocumentProps {
  diffHtml: string;
  suggestions: BlockOpSuggestion[];
  warnings?: string[];
  applying?: boolean;
  label?: string;
  onAccept: (id: string) => void;
  onReject: (id: string) => void;
  onAcceptAll: () => void;
  onRejectAll: () => void;
}

export function InlineDiffDocument({
  diffHtml,
  suggestions,
  warnings = [],
  applying = false,
  label,
  onAccept,
  onReject,
  onAcceptAll,
  onRejectAll,
}: InlineDiffDocumentProps) {
  const { t } = useTranslation();
  const rootRef = useRef<HTMLDivElement>(null);
  const included = suggestions.filter((s) => s.status !== 'rejected');

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    for (const s of suggestions) {
      const block = root.querySelector<HTMLElement>(`.dg-diff-block[data-op="${s.id}"]`);
      if (!block) continue;
      block.classList.toggle('dg-accepted', s.status === 'accepted');
      block.classList.toggle('dg-rejected', s.status === 'rejected');
    }
  }, [suggestions, diffHtml]);

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    const btn = target.closest<HTMLElement>('[data-act]');
    if (!btn) return;
    const opId = btn.getAttribute('data-op');
    const act = btn.getAttribute('data-act');
    if (!opId) return;
    if (act === 'accept') onAccept(opId);
    else if (act === 'reject') onReject(opId);
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-shrink-0 items-center gap-2 border-b border-emerald-200 bg-emerald-50/80 px-4 py-2">
        {applying && <Loader2 className="h-3.5 w-3.5 flex-shrink-0 animate-spin text-emerald-600" />}
        <span className="flex-1 text-xs font-medium text-emerald-800">
          {label ? `${label} · ` : ''}{t('generatorV1.inlineDiff.statusLine', { count: suggestions.length, included: included.length })}
        </span>
        <button
          onClick={onAcceptAll}
          disabled={included.length === 0 || applying}
          className="inline-flex items-center gap-1 rounded bg-emerald-600 px-2.5 py-1 text-xs font-semibold text-white transition-colors hover:bg-emerald-700 disabled:opacity-40"
        >
          <Check className="h-3 w-3" />
          {t('generatorV1.inlineDiff.applyCountBtn', { count: included.length })}
        </button>
        <button
          onClick={onRejectAll}
          disabled={suggestions.length === 0 || applying}
          className="inline-flex items-center gap-1 rounded border border-red-200 bg-white px-2.5 py-1 text-xs font-semibold text-red-600 transition-colors hover:bg-red-50 disabled:opacity-40"
        >
          <X className="h-3 w-3" />
          {t('generatorV1.inlineDiff.discardAllBtn')}
        </button>
      </div>

      {warnings.length > 0 && (
        <div className="flex-shrink-0 space-y-1 border-b border-amber-200 bg-amber-50/70 px-4 py-2">
          {warnings.map((w, i) => (
            <div key={i} className="flex items-start gap-1.5 text-[11px] text-amber-800">
              <AlertTriangle className="mt-0.5 h-3 w-3 flex-shrink-0" />
              <span>{w}</span>
            </div>
          ))}
        </div>
      )}

      <ScrollArea className="min-h-0 flex-1">
        <div className="p-6">
          <div className="mx-auto min-h-[600px] max-w-[820px] rounded-lg border border-border bg-white p-8 shadow-sm">
            <div
              ref={rootRef}
              className="docx-html-preview dg-diff-root"
              onClick={handleClick}
              dangerouslySetInnerHTML={{ __html: diffHtml }}
            />
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}
