// @ts-nocheck
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Download, FileText, X, Eye, Maximize2,
  ArchiveRestore, RotateCcw, AlertCircle,
  History as HistoryIcon, Package,
} from 'lucide-react';
import { Button } from '@/app/components/ui/button';
import { Badge } from '@/app/components/ui/badge';
import { ScrollArea } from '@/app/components/ui/scroll-area';
import type { DocDetailPanelProps, DetailTab, DocStatus } from './types';
import { STATUS_STYLES } from './constants';
import { getFakeContent } from './utils';

export function DocDetailPanel({ doc, onClose, onResume, onDownload, onOpenPreview }: DocDetailPanelProps) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<DetailTab>('overview');
  const [previewVersion, setPreviewVersion] = useState<string | null>(null);
  const previewContent = getFakeContent(doc);

  const TAB_LABELS: Record<DetailTab, string> = {
    overview: t('generatorV1.docDetail.tabOverview'),
    versions: t('generatorV1.docDetail.tabVersions'),
    activity: t('generatorV1.docDetail.tabActivity'),
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-start justify-between px-5 py-4 border-b border-border">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-foreground truncate">{doc.title}</p>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-xs text-muted-foreground">{doc.type}</span>
            <Badge variant="outline" className={`text-[10px] ${STATUS_STYLES[doc.status]}`}>{doc.status}</Badge>
          </div>
        </div>
        <button onClick={onClose} className="p-1.5 rounded hover:bg-muted transition-colors ml-2 flex-shrink-0">
          <X className="w-4 h-4 text-muted-foreground" />
        </button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-border px-5 flex-shrink-0">
        {(['overview', 'versions', 'activity'] as DetailTab[]).map(tabKey => (
          <button
            key={tabKey}
            onClick={() => setTab(tabKey)}
            className={`px-3 py-2.5 text-xs font-medium border-b-2 transition-colors ${
              tab === tabKey ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {TAB_LABELS[tabKey]}
          </button>
        ))}
      </div>

      {/* Content */}
      <ScrollArea className="flex-1">
        <div className="p-5 space-y-4">

          {/* ── Overview ── */}
          {tab === 'overview' && (
            <div className="space-y-4">
              {/* Metadata */}
              <div className="rounded-lg border border-border overflow-hidden">
                {[
                  { label: t('generatorV1.docDetail.metaTitleLabel'), value: doc.title },
                  { label: t('generatorV1.docDetail.metaTypeLabel'), value: doc.type },
                  { label: t('generatorV1.docDetail.metaStatusLabel'), value: doc.status, isBadge: true },
                  { label: t('generatorV1.docDetail.metaUpdatedLabel'), value: doc.lastEdited },
                  { label: t('generatorV1.docDetail.metaStepLabel'), value: t('generatorV1.docDetail.metaStepValue', { step: doc.currentStep }) },
                ].map(({ label, value, isBadge }, i) => (
                  <div key={label} className={`flex items-center gap-3 px-4 py-2.5 text-xs ${i % 2 === 0 ? 'bg-background' : 'bg-muted/30'}`}>
                    <span className="text-muted-foreground w-24 flex-shrink-0">{label}</span>
                    {isBadge ? (
                      <Badge variant="outline" className={`text-[10px] ${STATUS_STYLES[value as DocStatus]}`}>{value}</Badge>
                    ) : (
                      <span className="text-foreground font-medium truncate">{value}</span>
                    )}
                  </div>
                ))}
              </div>

              {/* Batch-specific result panel */}
              {doc.status === 'Batch Generated' && (
                <div className="rounded-lg border border-violet-200 bg-violet-50 p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <Package className="w-4 h-4 text-violet-600" />
                    <p className="text-xs font-semibold text-violet-800">{t('generatorV1.docDetail.batchResultTitle')}</p>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="bg-white/70 rounded-lg p-2.5 text-center">
                      <p className="text-violet-800 font-bold text-lg">3</p>
                      <p className="text-violet-600 text-[10px]">{t('generatorV1.docDetail.batchTotalRecords')}</p>
                    </div>
                    <div className="bg-white/70 rounded-lg p-2.5 text-center">
                      <p className="text-violet-800 font-bold text-lg">3</p>
                      <p className="text-violet-600 text-[10px]">{t('generatorV1.docDetail.batchCreated')}</p>
                    </div>
                  </div>
                  <div className="text-xs text-violet-700 space-y-0.5">
                    <p>{t('generatorV1.docDetail.batchTypeLabel')} <strong>{doc.type}</strong></p>
                    <p>{t('generatorV1.docDetail.batchFormatLabel')} <strong>DOCX</strong></p>
                  </div>
                </div>
              )}

              {/* Preview snippet */}
              {doc.status !== 'Draft' && (
                <div className="rounded-lg border border-border overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-2.5 bg-muted/40 border-b border-border">
                    <div className="flex items-center gap-1.5">
                      <FileText className="w-3.5 h-3.5 text-muted-foreground" />
                      <span className="text-xs font-medium text-muted-foreground">{t('generatorV1.docDetail.previewTitle')}</span>
                    </div>
                    <button
                      onClick={() => onOpenPreview()}
                      className="flex items-center gap-1 text-[10px] text-primary hover:text-primary/80 transition-colors"
                    >
                      <Maximize2 className="w-3 h-3" />{t('generatorV1.docDetail.previewExpandBtn')}
                    </button>
                  </div>
                  <div className="p-4 bg-white max-h-36 overflow-hidden relative">
                    <pre className="text-[10px] text-foreground/70 font-mono leading-relaxed whitespace-pre-wrap break-words">
                      {previewContent.slice(0, 350)}…
                    </pre>
                    <div className="absolute bottom-0 left-0 right-0 h-8 bg-gradient-to-t from-white to-transparent" />
                  </div>
                </div>
              )}

              {/* Action buttons */}
              <div className="flex flex-col gap-2">
                {doc.status !== 'Completed' && doc.status !== 'Batch Generated' && (
                  <Button size="sm" className="w-full gap-2 h-9 text-xs" onClick={() => onResume(doc)}>
                    <ArchiveRestore className="w-3.5 h-3.5" />
                    {t('generatorV1.docDetail.resumeBtn', {
                      stepLabel: doc.status === 'Draft'
                        ? t('generatorV1.docDetail.resumeStep2Label')
                        : t('generatorV1.docDetail.resumeStep3Label'),
                    })}
                  </Button>
                )}
                <Button size="sm" variant="outline" className="w-full gap-2 h-9 text-xs" onClick={() => onOpenPreview()}>
                  <Eye className="w-3.5 h-3.5" />{t('generatorV1.docDetail.fullscreenBtn')}
                </Button>
                {(doc.status === 'Completed' || doc.status === 'Batch Generated') && (
                  <Button
                    size="sm" variant="outline"
                    className="w-full gap-2 h-9 text-xs border-emerald-300 text-emerald-700 hover:bg-emerald-50"
                    onClick={() => onDownload(doc)}
                  >
                    <Download className="w-3.5 h-3.5" />
                    {doc.status === 'Batch Generated'
                      ? t('generatorV1.docDetail.downloadZipBtn')
                      : t('generatorV1.docDetail.downloadBtn')}
                  </Button>
                )}
              </div>
            </div>
          )}

          {/* ── Versions ── */}
          {tab === 'versions' && (
            <div className="space-y-2">
              {doc.versions.length === 0 ? (
                <div className="text-center py-8 space-y-2">
                  <HistoryIcon className="w-8 h-8 text-muted-foreground/30 mx-auto" />
                  <p className="text-xs text-muted-foreground">{t('generatorV1.docDetail.versionsEmptyTitle')}</p>
                </div>
              ) : (
                <>
                  {/* Current version (last in array) */}
                  {(() => {
                    const latest = doc.versions[doc.versions.length - 1];
                    return (
                      <div className="flex items-center gap-3 px-4 py-3 rounded-lg border-2 border-primary bg-primary/5">
                        <div className="w-9 h-9 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-bold flex-shrink-0">
                          {latest.label}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <p className="text-xs font-semibold text-foreground">{latest.label}</p>
                            <span className="text-[10px] bg-primary text-primary-foreground px-1.5 py-0.5 rounded-full font-medium">{t('generatorV1.docDetail.currentVersionBadge')}</span>
                          </div>
                          <p className="text-[10px] text-muted-foreground">{latest.createdAt}</p>
                        </div>
                        <button
                          onClick={() => onOpenPreview(latest.label)}
                          className="p-1.5 rounded hover:bg-muted/50 transition-colors" title={t('generatorV1.docDetail.previewVersionTitle')}
                        >
                          <Eye className="w-3.5 h-3.5 text-muted-foreground" />
                        </button>
                      </div>
                    );
                  })()}

                  {/* Previous versions */}
                  {doc.versions.slice(0, -1).reverse().map(v => (
                    <div
                      key={v.label}
                      className={`flex items-center gap-3 px-4 py-3 rounded-lg border transition-colors cursor-pointer ${
                        previewVersion === v.label ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/30'
                      }`}
                      onClick={() => { setPreviewVersion(v.label); onOpenPreview(v.label); }}
                    >
                      <div className="w-9 h-9 rounded-full bg-muted text-muted-foreground flex items-center justify-center text-xs font-bold flex-shrink-0">
                        {v.label}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-foreground">{v.label}</p>
                        <p className="text-[10px] text-muted-foreground">{v.createdAt} · {t('generatorV1.docDetail.oldVersionSuffix')}</p>
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <button
                          onClick={e => { e.stopPropagation(); onOpenPreview(v.label); }}
                          className="p-1.5 rounded hover:bg-muted transition-colors" title={t('generatorV1.docDetail.previewVersionTitle')}
                        >
                          <Eye className="w-3.5 h-3.5 text-muted-foreground" />
                        </button>
                        <button
                          onClick={e => { e.stopPropagation(); onDownload(doc); }}
                          className="p-1.5 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-primary" title={t('generatorV1.docDetail.restoreVersionTitle')}
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                  <p className="text-[10px] text-muted-foreground text-center pt-1">{t('generatorV1.docDetail.versionHint')}</p>
                </>
              )}
            </div>
          )}

          {/* ── Activity Log ── */}
          {tab === 'activity' && (
            <div>
              {doc.activity.length === 0 ? (
                <div className="text-center py-8 space-y-2">
                  <AlertCircle className="w-8 h-8 text-muted-foreground/30 mx-auto" />
                  <p className="text-xs text-muted-foreground">{t('generatorV1.docDetail.activityEmptyTitle')}</p>
                </div>
              ) : (
                <div className="relative pl-5">
                  <div className="absolute left-1.5 top-2 bottom-2 w-px bg-border" />
                  <div className="space-y-4">
                    {doc.activity.map((entry, i) => (
                      <div key={entry.id} className="relative flex gap-3">
                        <div className={`absolute -left-3.5 w-3 h-3 rounded-full border-2 border-background flex-shrink-0 mt-0.5 ${
                          i === 0 ? 'bg-primary' : 'bg-muted-foreground/40'
                        }`} />
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium text-foreground">{entry.action}</p>
                          <p className="text-[10px] text-muted-foreground mt-0.5">{entry.timestamp}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
