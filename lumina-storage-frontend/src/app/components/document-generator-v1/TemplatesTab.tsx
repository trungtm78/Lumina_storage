// @ts-nocheck
import { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useTranslation } from 'react-i18next';
import {
  ArrowLeft, Check, FileText, Loader2, Search, Sparkles, Upload, X,
} from 'lucide-react';
import { Button } from '@/app/components/ui/button';
import { Input } from '@/app/components/ui/input';
import { Label } from '@/app/components/ui/label';
import { Textarea } from '@/app/components/ui/textarea';
import { Badge } from '@/app/components/ui/badge';
import { ScrollArea } from '@/app/components/ui/scroll-area';
import type { TemplateItem } from './types';
import { DETECTED_PLACEHOLDERS } from './constants';

export function TemplatesTab() {
  const { t } = useTranslation();
  const [templates, setTemplates] = useState<TemplateItem[]>([]);
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [uploadMode, setUploadMode] = useState(false);

  // upload form
  const [file, setFile] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [extracting, setExtracting] = useState(false);
  const [extracted, setExtracted] = useState<string[] | null>(null);

  const filtered = templates.filter(t => t.name.toLowerCase().includes(search.toLowerCase()));
  const selected = templates.find(t => t.id === selectedId) ?? null;

  const resetUpload = () => {
    setFile(null); setName(''); setDesc(''); setExtracted(null); setExtracting(false);
  };

  const handleExtract = () => {
    if (!file || !name.trim()) return;
    setExtracting(true);
    setTimeout(() => {
      setExtracted(DETECTED_PLACEHOLDERS);
      setExtracting(false);
    }, 1400);
  };

  const handleSave = () => {
    if (!extracted) return;
    const newT: TemplateItem = {
      id: `t-${Date.now()}`,
      name: name.trim(),
      description: desc.trim() || undefined,
      status: 'Active',
      updatedAt: new Date().toLocaleDateString('vi-VN'),
      placeholders: extracted,
      version: 'V1',
    };
    setTemplates(prev => [newT, ...prev]);
    setSelectedId(newT.id);
    setUploadMode(false);
    resetUpload();
  };

  return (
    <div className="flex h-full">
      {/* ── Left sidebar ── */}
      <div className="w-[340px] flex-shrink-0 border-r border-border bg-card flex flex-col">
        <div className="p-4 space-y-2.5 border-b border-border flex-shrink-0">
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input value={search} onChange={e => setSearch(e.target.value)} className="pl-8 h-8 text-xs" placeholder={t('generatorV1.templatesTab.searchPlaceholder')} />
          </div>
          <Button
            className="w-full gap-2 h-9 text-xs bg-foreground text-background hover:bg-foreground/90"
            onClick={() => { setUploadMode(true); setSelectedId(null); resetUpload(); }}
          >
            <Upload className="w-3.5 h-3.5" />{t('generatorV1.templatesTab.uploadNewBtn')}
          </Button>
        </div>
        <ScrollArea className="flex-1">
          {filtered.length === 0 ? (
            <div className="p-8 text-center space-y-1">
              <p className="text-xs text-muted-foreground">{t('generatorV1.templatesTab.emptyLine1')}</p>
              <p className="text-xs text-muted-foreground">{t('generatorV1.templatesTab.emptyLine2')}</p>
            </div>
          ) : (
            <div className="p-2 space-y-1">
              {filtered.map(t => (
                <button
                  key={t.id}
                  onClick={() => { setSelectedId(t.id); setUploadMode(false); }}
                  className={`w-full text-left p-3 rounded-lg border transition-colors ${
                    selectedId === t.id ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/50'
                  }`}
                >
                  <div className="flex items-start gap-2">
                    <FileText className="w-4 h-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-foreground truncate">{t.name}</p>
                      <div className="flex items-center gap-1.5 mt-1">
                        <Badge variant="outline" className={`text-[9px] ${t.status === 'Active' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-amber-50 text-amber-700 border-amber-200'}`}>{t.status}</Badge>
                        <span className="text-[10px] text-muted-foreground">{t.version}</span>
                      </div>
                      <div className="flex items-center justify-between mt-1.5 text-[10px] text-muted-foreground">
                        <span>{t.placeholders.length} placeholder</span>
                        <span>{t.updatedAt}</span>
                      </div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </ScrollArea>
      </div>

      {/* ── Main content ── */}
      <div className="flex-1 min-w-0 overflow-hidden">
        <ScrollArea className="h-full">
          {uploadMode ? (
            <div className="p-8 max-w-2xl">
              <div className="flex items-center gap-2 mb-1">
                <button onClick={() => { setUploadMode(false); resetUpload(); }} className="text-muted-foreground hover:text-foreground transition-colors">
                  <ArrowLeft className="w-4 h-4" />
                </button>
                <h2 className="text-lg font-semibold text-foreground">{t('generatorV1.templatesTab.uploadTitle')}</h2>
              </div>
              <p className="text-xs text-muted-foreground mb-6 ml-6">
                {t('generatorV1.templatesTab.uploadSubtitle')}
              </p>

              <div className="space-y-5">
                {/* File dropzone */}
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">{t('generatorV1.templatesTab.fileLabel')} <span className="text-primary">*</span></Label>
                  {file ? (
                    <div className="flex items-center gap-2 text-xs bg-emerald-50 text-emerald-700 rounded-lg px-3 py-2.5 border border-emerald-200">
                      <Check className="w-3.5 h-3.5 flex-shrink-0" />
                      <span className="truncate flex-1 font-medium">{file}</span>
                      <button onClick={() => { setFile(null); setExtracted(null); }}><X className="w-3.5 h-3.5" /></button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setFile('hop_dong_mau.docx')}
                      className="w-full border-2 border-dashed border-border rounded-xl py-10 flex flex-col items-center gap-2 text-muted-foreground hover:border-primary/50 hover:text-primary hover:bg-primary/3 transition-all"
                    >
                      <Upload className="w-6 h-6" />
                      <span className="text-sm font-medium">{t('generatorV1.templatesTab.dropzoneText')}</span>
                      <span className="text-[10px] text-muted-foreground/80">{t('generatorV1.templatesTab.dropzoneHint')}</span>
                    </button>
                  )}
                </div>

                {/* Name */}
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">{t('generatorV1.templatesTab.nameLabel')} <span className="text-primary">*</span></Label>
                  <Input value={name} onChange={e => setName(e.target.value)} className="h-9 text-xs" placeholder={t('generatorV1.templatesTab.namePlaceholder')} />
                </div>

                {/* Description */}
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">{t('generatorV1.templatesTab.descLabel')}</Label>
                  <Textarea value={desc} onChange={e => setDesc(e.target.value)} rows={3} className="text-xs resize-none" placeholder={t('generatorV1.templatesTab.descPlaceholder')} />
                </div>

                {/* Detected placeholders preview */}
                <AnimatePresence>
                  {extracted && (
                    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="rounded-lg border border-primary/30 bg-primary/5 p-4 space-y-2.5">
                      <div className="flex items-center gap-2">
                        <Sparkles className="w-4 h-4 text-primary" />
                        <p className="text-xs font-semibold text-foreground">{t('generatorV1.templatesTab.aiDetectedTitle', { count: extracted.length })}</p>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {extracted.map(p => (
                          <span key={p} className="text-[11px] font-mono px-2 py-1 rounded bg-white border border-primary/20 text-primary">{p}</span>
                        ))}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Actions */}
                <div className="flex gap-2 pt-2">
                  {!extracted ? (
                    <Button
                      onClick={handleExtract}
                      disabled={!file || !name.trim() || extracting}
                      className="flex-1 gap-2 h-10 bg-foreground text-background hover:bg-foreground/90"
                    >
                      {extracting
                        ? <><Loader2 className="w-4 h-4 animate-spin" />{t('generatorV1.templatesTab.extractingBtn')}</>
                        : <><Sparkles className="w-4 h-4" />{t('generatorV1.templatesTab.extractBtn')}</>}
                    </Button>
                  ) : (
                    <Button onClick={handleSave} className="flex-1 gap-2 h-10">
                      <Check className="w-4 h-4" />{t('generatorV1.templatesTab.saveBtn')}
                    </Button>
                  )}
                  <Button variant="outline" onClick={() => { setUploadMode(false); resetUpload(); }}>{t('generatorV1.templatesTab.cancelBtn')}</Button>
                </div>
              </div>
            </div>
          ) : selected ? (
            <div className="p-8 max-w-3xl">
              <div className="flex items-start justify-between mb-6">
                <div>
                  <h2 className="text-lg font-semibold text-foreground">{selected.name}</h2>
                  {selected.description && <p className="text-xs text-muted-foreground mt-1">{selected.description}</p>}
                  <div className="flex items-center gap-2 mt-2">
                    <Badge variant="outline" className={`text-[10px] ${selected.status === 'Active' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-amber-50 text-amber-700 border-amber-200'}`}>{selected.status}</Badge>
                    <span className="text-[10px] text-muted-foreground">{t('generatorV1.templatesTab.detailVersionLabel', { version: selected.version })}</span>
                    <span className="text-[10px] text-muted-foreground">· {t('generatorV1.templatesTab.detailUpdatedAt', { date: selected.updatedAt })}</span>
                  </div>
                </div>
              </div>
              <div className="rounded-lg border border-border p-5 space-y-3">
                <div className="flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-primary" />
                  <p className="text-sm font-semibold text-foreground">Placeholder ({selected.placeholders.length})</p>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {selected.placeholders.map(p => (
                    <span key={p} className="text-xs font-mono px-2 py-1 rounded bg-primary/10 border border-primary/20 text-primary">{p}</span>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="h-full flex items-center justify-center p-8">
              <div className="text-center space-y-4 max-w-sm">
                <div className="w-16 h-16 rounded-2xl bg-muted mx-auto flex items-center justify-center relative">
                  <FileText className="w-7 h-7 text-muted-foreground" />
                  <Sparkles className="w-3.5 h-3.5 text-primary absolute -top-1 -right-1" />
                </div>
                <div className="space-y-1.5">
                  <p className="text-base font-semibold text-foreground">{t('generatorV1.templatesTab.emptyStateTitle')}</p>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    {t('generatorV1.templatesTab.emptyStateDesc')}
                  </p>
                </div>
                <Button onClick={() => { setUploadMode(true); setSelectedId(null); resetUpload(); }} className="gap-2 bg-foreground text-background hover:bg-foreground/90">
                  <Upload className="w-4 h-4" />{t('generatorV1.templatesTab.emptyStateUploadBtn')}
                </Button>
              </div>
            </div>
          )}
        </ScrollArea>
      </div>
    </div>
  );
}
