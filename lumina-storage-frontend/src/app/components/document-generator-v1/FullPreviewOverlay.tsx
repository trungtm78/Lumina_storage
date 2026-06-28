// @ts-nocheck
import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'motion/react';
import {
  Download, X, ZoomIn, ZoomOut,
} from 'lucide-react';
import { Button } from '@/app/components/ui/button';
import { Badge } from '@/app/components/ui/badge';
import type { FullPreviewOverlayProps } from './types';
import { getFakeContent } from './utils';

export function FullPreviewOverlay({ doc, version, onClose, onDownload }: FullPreviewOverlayProps) {
  const [zoom, setZoom] = useState(100);
  const content = getFakeContent(doc);

  // Close on Escape key
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  return createPortal(
    <AnimatePresence>
      {/*
        Single panel layer only — no backdrop onClick.
        Overlay is dismissed ONLY via ✕ button or Escape key.
        This prevents accidental closure when clicking outside the document.
        The panel stops at right: min(520px,100vw) so the Sheet stays fully accessible.
      */}
      {/* Dim backdrop — no pointer events, purely visual */}
      <motion.div
        key="full-preview-backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.18 }}
        className="fixed top-0 bottom-0 left-0 z-[9998]"
        style={{
          right: 'min(520px, 100vw)',
          background: 'rgba(0,0,0,0.72)',
          pointerEvents: 'none',
        }}
      />
      {/* Content panel — same bounds as backdrop, fully interactive */}
      <motion.div
        key="full-preview-content"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.18 }}
        className="fixed top-0 bottom-0 left-0 z-[9999] flex flex-col"
        style={{ right: 'min(520px, 100vw)' }}
      >
        {/* Top bar */}
        <div className="flex items-center gap-3 px-6 py-3 bg-[#1a1a1a]/98 backdrop-blur border-b border-white/10 flex-shrink-0">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-white truncate">{doc.title}</p>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-xs text-white/50">{doc.type}</span>
              {version && (
                <Badge variant="outline" className="text-[10px] border-white/20 text-white/70">{version}</Badge>
              )}
            </div>
          </div>
          {/* Zoom controls */}
          <div className="flex items-center gap-1 bg-white/10 rounded-lg px-2 py-1">
            <button
              onClick={e => { e.stopPropagation(); setZoom(z => Math.max(60, z - 10)); }}
              className="p-1 rounded hover:bg-white/20 transition-colors text-white/70 hover:text-white"
              title="Zoom out"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            <span className="text-xs text-white/70 w-10 text-center font-mono">{zoom}%</span>
            <button
              onClick={e => { e.stopPropagation(); setZoom(z => Math.min(150, z + 10)); }}
              className="p-1 rounded hover:bg-white/20 transition-colors text-white/70 hover:text-white"
              title="Zoom in"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
          </div>
          {(doc.status === 'Completed' || doc.status === 'Batch Generated') && (
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5 text-xs h-8 border-white/20 text-white hover:bg-white/10 hover:text-white bg-transparent"
              onClick={e => { e.stopPropagation(); onDownload(doc); }}
            >
              <Download className="w-3.5 h-3.5" />
              {doc.status === 'Batch Generated' ? 'Download ZIP' : 'Download'}
            </Button>
          )}
          <button
            onClick={e => { e.stopPropagation(); onClose(); }}
            className="p-2 rounded-lg hover:bg-white/15 transition-colors text-white/70 hover:text-white ml-1"
            title="Close (Esc)"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Document canvas — scrollable area */}
        <div className="flex-1 overflow-y-auto py-8 px-6">
          {/* Outer centering wrapper — holds the scaled document */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'center',
              minHeight: `${Math.round(1122 * zoom / 100) + 64}px`,
            }}
          >
          <motion.div
            className="bg-white rounded-lg relative flex-shrink-0"
            style={{
              width: '794px',
              minHeight: '1122px',
              transformOrigin: 'top center',
              boxShadow: '0 8px 40px rgba(0,0,0,0.45), 0 2px 8px rgba(0,0,0,0.25)',
            }}
            animate={{ scale: zoom / 100 }}
            transition={{ type: 'spring', stiffness: 280, damping: 28 }}
          >
            {/* A4 header rule */}
            <div className="h-1.5 bg-primary rounded-t-lg" />
            <div className="px-12 py-10">
              {/* Document letterhead */}
              <div className="flex items-center justify-between mb-8 pb-6 border-b-2 border-gray-100">
                <div>
                  <p className="text-xs font-bold text-gray-800 uppercase tracking-widest">Lumina Storage</p>
                  <p className="text-[10px] text-gray-400 mt-0.5">Confidential — Internal Use</p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-gray-500">Ref: {doc.type.replace(/ /g, '-').toUpperCase()}-2026-{doc.id.padStart(4,'0')}</p>
                  <p className="text-[10px] text-gray-400 mt-0.5">{doc.lastEdited}</p>
                </div>
              </div>
              {/* Title */}
              <h1 className="text-2xl font-bold text-gray-900 mb-1">{doc.title}</h1>
              <p className="text-sm text-gray-500 mb-8">{doc.type}</p>
              {/* Body content */}
              <pre className="text-sm text-gray-700 font-sans leading-loose whitespace-pre-wrap break-words">
                {content}
              </pre>
              {/* Footer */}
              <div className="mt-16 pt-6 border-t border-gray-100 flex items-center justify-between">
                <p className="text-[10px] text-gray-400">© 2026 Lumina Storage · All rights reserved</p>
                <p className="text-[10px] text-gray-400">Page 1 of 1</p>
              </div>
            </div>
          </motion.div>
          </div>{/* end centering wrapper */}
        </div>
      </motion.div>{/* end content panel */}
    </AnimatePresence>,
    document.body
  );
}
