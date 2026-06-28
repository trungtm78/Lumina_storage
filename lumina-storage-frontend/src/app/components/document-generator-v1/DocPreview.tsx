// @ts-nocheck
import { useRef, useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { FileText, AlertCircle, Check, X, Loader2 } from 'lucide-react';
import { ScrollArea } from '@/app/components/ui/scroll-area';
import { axiosClient } from '@/app/api/client';
import { API_ENDPOINTS } from '@/app/api/endpoints';
import type { PlaceholderField, AiDiffSuggestion } from './types';
import { injectNumberingIntoHtml } from '@/app/utils/doc-review/numbering';

// ─── Formatted (Word) preview qua mammoth — GIỮ bảng/bold/heading/layout ─────

function _escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function _escapeReg(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Thay {key} đã điền → giá trị (highlight xanh); {token} còn lại → vàng (chưa điền). */
function applyFieldHighlight(html: string, values: Record<string, string>): string {
  let out = html;
  for (const [key, val] of Object.entries(values)) {
    if (val && String(val).trim()) {
      out = out.replace(
        new RegExp(`\\{${_escapeReg(key)}\\}`, 'g'),
        `<mark class="bg-blue-100 text-blue-900 rounded px-0.5">${_escapeHtml(String(val))}</mark>`,
      );
    }
  }
  // Mọi {token} còn lại = chưa điền
  out = out.replace(
    /\{([a-zA-Z0-9_]+)\}/g,
    '<mark class="bg-amber-100 text-amber-800 rounded px-0.5">{$1}</mark>',
  );
  return out;
}

/**
 * Hook: fetch docx (kèm token) → mammoth → HTML. Trả null khi documentId rỗng.
 * Tách ra để vừa dùng cho preview vừa SEED nội dung cho TipTap editor.
 */
export function useDocxHtml(documentId: string | null | undefined): {
  html: string | null;
  loading: boolean;
  error: boolean;
} {
  const [html, setHtml] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!documentId) {
      setHtml(null); setLoading(false); setError(false);
      return;
    }
    let cancelled = false;
    setLoading(true); setError(false); setHtml(null);
    Promise.all([
      axiosClient
        .get(API_ENDPOINTS.documents.preview(documentId), { responseType: 'blob' })
        .then((res) => (res.data as Blob).arrayBuffer()),
      axiosClient
        .get(API_ENDPOINTS.review.documentNumbering(documentId))
        .then((res) => res.data?.items ?? [])
        .catch(() => []),
    ])
      .then(([buf, numbering]) =>
        import('mammoth').then(({ default: mammoth }) =>
          mammoth.convertToHtml(
            { arrayBuffer: buf },
            {
              convertImage: mammoth.images.imgElement((image) =>
                image.read('base64').then((data) => ({ src: `data:${image.contentType};base64,${data}` })),
              ),
            },
          ).then(({ value }) => injectNumberingIntoHtml(value, numbering)),
        ),
      )
      .then((html) => { if (!cancelled) { setHtml(html); setLoading(false); } })
      .catch(() => { if (!cancelled) { setError(true); setLoading(false); } });
    return () => { cancelled = true; };
  }, [documentId]);

  return { html, loading, error };
}

/**
 * Preview tài liệu Word GIỮ ĐỊNH DẠNG. Hai chế độ:
 *  - `html` truyền vào (vd nội dung đã sửa tay) → render thẳng.
 *  - chỉ có `documentId` → fetch docx → mammoth → HTML.
 * Sau đó highlight field theo giá trị đang điền.
 */
export function DocxFormattedPreview({
  documentId,
  html,
  fields,
  label,
}: {
  documentId?: string | null;
  html?: string | null;
  fields: PlaceholderField[];
  label?: string;
}) {
  const { t } = useTranslation();
  // Có html truyền vào thì KHÔNG fetch (truyền null cho hook).
  const fetched = useDocxHtml(html != null ? null : documentId);
  const baseHtml = html != null ? html : fetched.html;
  const loading = html != null ? false : fetched.loading;
  const error = html != null ? false : fetched.error;

  const valuesMap = useMemo(
    () => Object.fromEntries((fields ?? []).map((f) => [f.key, f.value ?? ''])),
    [fields],
  );
  const liveHtml = useMemo(
    () => (baseHtml ? applyFieldHighlight(baseHtml, valuesMap) : null),
    [baseHtml, valuesMap],
  );

  return (
    <div className="flex flex-col h-full">
      {label && (
        <div className="flex items-center gap-2 px-4 py-2 border-b border-border bg-muted/40 flex-shrink-0">
          <FileText className="w-3.5 h-3.5 text-muted-foreground" />
          <span className="text-xs text-muted-foreground font-medium flex-1 truncate">{label}</span>
          <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
            <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded bg-blue-200 border border-blue-300" />{t('generatorV1.docPreview.filledLegend')}</span>
            <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded bg-amber-200 border border-amber-300" />{t('generatorV1.docPreview.unfilledLegend')}</span>
          </div>
        </div>
      )}
      <ScrollArea className="flex-1 min-h-0">
        <div className="p-6">
          {loading && (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="w-7 h-7 animate-spin text-muted-foreground" />
            </div>
          )}
          {error && (
            <div className="text-center py-20 text-sm text-muted-foreground">{t('generatorV1.docPreview.wordFormatError')}</div>
          )}
          {liveHtml && (
            <div
              className="docx-html-preview bg-white border border-border rounded-lg shadow-sm p-10 max-w-3xl mx-auto min-h-[600px]"
              dangerouslySetInnerHTML={{ __html: liveHtml }}
            />
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

export function DocPreview({ content, label }: { content: string; label?: string }) {
  return (
    <div className="flex flex-col h-full">
      {label && (
        <div className="flex items-center gap-2 px-4 py-2 border-b border-border bg-muted/40">
          <FileText className="w-3.5 h-3.5 text-muted-foreground" />
          <span className="text-xs text-muted-foreground font-medium">{label}</span>
        </div>
      )}
      <ScrollArea className="flex-1 min-h-0">
        <div className="p-6">
          <div className="bg-white border border-border rounded-lg shadow-sm p-8 min-h-[600px]">
            <pre className="text-sm text-foreground/85 font-mono leading-relaxed whitespace-pre-wrap break-words">
              {content}
            </pre>
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}

// ─── Highlighted Doc Preview ─────────────────────────────────────────────────

export function HighlightedDocPreview({
  template,
  fields,
  label,
  editable = false,
  onContentChange,
  userAddedKeys = new Set(),
}: {
  template: string;
  fields: PlaceholderField[];
  label?: string;
  editable?: boolean;
  onContentChange?: (v: string) => void;
  userAddedKeys?: Set<string>;
}) {
  const { t } = useTranslation();
  const fieldMap = new Map(fields.map(f => [f.key, f.value]));

  // Build React nodes from the template with {key} patterns highlighted
  const buildParts = (src: string): React.ReactNode[] => {
    const nodes: React.ReactNode[] = [];
    const regex = /\{([a-zA-Z_]+)\}/g;
    let lastIdx = 0;
    let m: RegExpExecArray | null;
    while ((m = regex.exec(src)) !== null) {
      if (m.index > lastIdx) nodes.push(src.slice(lastIdx, m.index));
      const key = m[1];
      const val = fieldMap.get(key);
      if (userAddedKeys.has(key)) {
        // User-added param: show value inline, or nothing when empty
        // (the "Label: " prefix is already baked into the template text)
        if (val) nodes.push(<span key={`mk-${m.index}`}>{val}</span>);
      } else if (val) {
        nodes.push(
          <mark key={`mk-${m.index}`} className="bg-blue-100 text-blue-900 rounded px-0.5 not-italic">{val}</mark>
        );
      } else {
        nodes.push(
          <mark key={`mk-${m.index}`} className="bg-amber-100 text-amber-800 rounded px-0.5 not-italic">{m[0]}</mark>
        );
      }
      lastIdx = m.index + m[0].length;
    }
    if (lastIdx < src.length) nodes.push(src.slice(lastIdx));
    return nodes;
  };

  return (
    <div className="flex flex-col h-full">
      {label && (
        <div className="flex items-center gap-2 px-4 py-2 border-b border-border bg-muted/40 flex-shrink-0">
          <FileText className="w-3.5 h-3.5 text-muted-foreground" />
          <span className="text-xs text-muted-foreground font-medium flex-1 truncate">{label}</span>
          <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
            <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded bg-blue-200 border border-blue-300" />{t('generatorV1.docPreview.filledLegend')}</span>
            <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded bg-amber-200 border border-amber-300" />{t('generatorV1.docPreview.unfilledLegend')}</span>
          </div>
        </div>
      )}
      <ScrollArea className="flex-1 min-h-0">
        <div className="p-6">
          <div className={`bg-white border border-border rounded-lg shadow-sm p-8 min-h-[600px] ${editable ? 'ring-2 ring-primary/20' : ''}`}>
            {editable ? (
              <div
                contentEditable
                suppressContentEditableWarning
                onInput={e => onContentChange?.((e.target as HTMLDivElement).innerText)}
                className="text-sm text-foreground/85 font-mono leading-relaxed whitespace-pre-wrap break-words outline-none min-h-[560px] focus:ring-0"
              >
                {template}
              </div>
            ) : (
              <pre className="text-sm text-foreground/85 font-mono leading-relaxed whitespace-pre-wrap break-words">
                {buildParts(template)}
              </pre>
            )}
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}

// ─── Insert Mode Preview ──────────────────────────────────────────────────────

export function InsertModePreview({
  content,
  paramKey,
  onInsert,
  onCancel,
}: {
  content: string;
  paramKey: string;
  onInsert: (pos: number) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const taRef = useRef<HTMLTextAreaElement>(null);

  const handleClick = (e: React.MouseEvent<HTMLTextAreaElement>) => {
    const el = e.currentTarget;
    // Only insert on a clean click, not when user is selecting text
    if (el.selectionStart === el.selectionEnd) {
      onInsert(el.selectionStart);
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Banner */}
      <div className="flex items-center gap-2 px-4 py-2 bg-amber-50 border-b border-amber-200 flex-shrink-0">
        <AlertCircle className="w-3.5 h-3.5 text-amber-600 flex-shrink-0" />
        <p className="text-xs text-amber-800 flex-1 leading-tight">
          {t('generatorV1.docPreview.insertModeBanner')}{' '}
          <span className="font-mono font-semibold bg-amber-100 px-1 rounded border border-amber-300 text-amber-900">
            {`{${paramKey}}`}
          </span>
        </p>
        <button
          onClick={onCancel}
          className="text-xs font-medium text-amber-700 hover:text-amber-900 underline flex-shrink-0 ml-2"
        >
          {t('generatorV1.docPreview.insertModeCancelBtn')}
        </button>
      </div>
      {/* Clickable document */}
      <ScrollArea className="flex-1 min-h-0">
        <div className="p-6">
          <div className="bg-white border-2 border-amber-300 rounded-lg shadow-sm ring-4 ring-amber-50 p-8 min-h-[600px]">
            <textarea
              ref={taRef}
              readOnly
              value={content}
              onClick={handleClick}
              className="w-full min-h-[560px] text-sm text-foreground/85 font-mono leading-relaxed resize-none outline-none bg-transparent cursor-text"
            />
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}

// ─── Diff Preview ─────────────────────────────────────────────────────────────

export function DiffPreview({
  baseDraft,
  suggestions,
  label,
  onAccept,
  onReject,
  onAcceptAll,
  onRejectAll,
}: {
  baseDraft: string;
  suggestions: AiDiffSuggestion[];
  label?: string;
  onAccept: (id: string) => void;
  onReject: (id: string) => void;
  onAcceptAll: () => void;
  onRejectAll: () => void;
}) {
  const { t } = useTranslation();
  const pending = suggestions.filter(s => s.status === 'pending');

  const renderContent = (): React.ReactNode[] => {
    type Slot = { start: number; end: number; sugg: AiDiffSuggestion };
    const slots: Slot[] = [];
    for (const s of pending) {
      const idx = baseDraft.indexOf(s.searchText);
      if (idx !== -1) slots.push({ start: idx, end: idx + s.searchText.length, sugg: s });
    }
    slots.sort((a, b) => a.start - b.start);

    // Remove overlapping slots
    const clean: Slot[] = [];
    let lastEnd = 0;
    for (const sl of slots) {
      if (sl.start >= lastEnd) { clean.push(sl); lastEnd = sl.end; }
    }

    const nodes: React.ReactNode[] = [];
    let pos = 0;
    for (const sl of clean) {
      if (sl.start > pos) nodes.push(<span key={`pre-${sl.start}`}>{baseDraft.slice(pos, sl.start)}</span>);
      nodes.push(
        <span key={sl.sugg.id} className="inline-flex flex-wrap items-baseline gap-x-1 align-baseline">
          <span className="line-through text-red-600 bg-red-50 px-0.5 rounded border-b border-red-200">
            {sl.sugg.searchText}
          </span>
          <span className="text-muted-foreground text-[0.78em]">→</span>
          <span className="text-emerald-700 bg-emerald-50 px-0.5 rounded border-b border-emerald-200">
            {sl.sugg.newText}
          </span>
          <span className="inline-flex gap-0.5 align-middle flex-shrink-0 ml-0.5">
            <button
              onClick={() => onAccept(sl.sugg.id)}
              className="inline-flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 hover:bg-emerald-200 border border-emerald-300 transition-colors"
            >
              <Check className="w-2.5 h-2.5" />Accept
            </button>
            <button
              onClick={() => onReject(sl.sugg.id)}
              className="inline-flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-red-50 text-red-600 hover:bg-red-100 border border-red-200 transition-colors"
            >
              <X className="w-2.5 h-2.5" />Reject
            </button>
          </span>
        </span>,
      );
      pos = sl.end;
    }
    if (pos < baseDraft.length) nodes.push(<span key="tail">{baseDraft.slice(pos)}</span>);
    return nodes;
  };

  return (
    <div className="flex flex-col h-full">
      {label && (
        <div className="flex items-center gap-2 px-4 py-2 border-b border-border bg-muted/40 flex-shrink-0">
          <FileText className="w-3.5 h-3.5 text-muted-foreground" />
          <span className="text-xs text-muted-foreground font-medium flex-1 truncate">{label}</span>
          <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
            <span className="flex items-center gap-1">
              <span className="inline-block w-2.5 h-2.5 rounded bg-red-100 border border-red-300" />{t('generatorV1.docPreview.diffOldLegend')}
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block w-2.5 h-2.5 rounded bg-emerald-100 border border-emerald-300" />{t('generatorV1.docPreview.diffNewLegend')}
            </span>
          </div>
        </div>
      )}
      {/* Diff action bar */}
      <div className="flex items-center gap-2 px-4 py-2 bg-emerald-50/80 border-b border-emerald-200 flex-shrink-0">
        <span className="text-xs text-emerald-800 font-medium flex-1">
          {t('generatorV1.docPreview.diffPendingCount', { count: pending.length })}
        </span>
        <button
          onClick={onAcceptAll}
          disabled={pending.length === 0}
          className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-40 transition-colors"
        >
          <Check className="w-3 h-3" />Accept all
        </button>
        <button
          onClick={onRejectAll}
          disabled={pending.length === 0}
          className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded bg-white text-red-600 hover:bg-red-50 border border-red-200 disabled:opacity-40 transition-colors"
        >
          <X className="w-3 h-3" />Reject all
        </button>
      </div>
      {/* Document body */}
      <ScrollArea className="flex-1 min-h-0">
        <div className="p-6">
          <div className="bg-white border border-border rounded-lg shadow-sm p-8 min-h-[600px]">
            <pre className="text-sm text-foreground/85 font-mono leading-relaxed whitespace-pre-wrap break-words">
              {renderContent()}
            </pre>
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}
