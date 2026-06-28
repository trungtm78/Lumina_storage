// @ts-nocheck
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'motion/react';
import { useNavigate } from 'react-router';
import {
  FileText, Loader2, Sparkles, Check, X, Download, Upload,
  AlertCircle, CheckCircle2, Package, TableProperties, Send, FileDown, FileSearch,
  ChevronDown,
} from 'lucide-react';
import { Button } from '@/app/components/ui/button';
import { Input } from '@/app/components/ui/input';
import { Label } from '@/app/components/ui/label';
import { Textarea } from '@/app/components/ui/textarea';
import { Badge } from '@/app/components/ui/badge';
import { ScrollArea } from '@/app/components/ui/scroll-area';
import { Separator } from '@/app/components/ui/separator';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/app/components/ui/select';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/app/components/ui/dialog';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator,
} from '@/app/components/ui/dropdown-menu';
import type { Step3Props, PlaceholderField, HistoryItem } from './types';
import { FIELDS_BY_TYPE, FAKE_BATCH_ROWS, COLUMN_MAPPING, PLACEHOLDER_FIELDS, SMART_SUGGESTION_DATA, ROUTE_PATHS } from './constants';
import { generatorApi } from '@/app/api/endpoints/generator';
import { applyPlaceholders, applyRevision } from './utils';
import { DocPreview } from './DocPreview';

export function Step3({ docType, templateContent, savedHistory, onSavedHistoryChange }: Step3Props) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [mode, setMode] = useState<'manual' | 'ai' | 'batch'>('manual');
  const [fields, setFields] = useState<PlaceholderField[]>((FIELDS_BY_TYPE[docType] ?? PLACEHOLDER_FIELDS).map(f => ({ ...f })));
  const [autoFilledKeys, setAutoFilledKeys] = useState<Set<string>>(new Set());
  const [hoveredFieldKey, setHoveredFieldKey] = useState<string | null>(null);

  // Batch mode
  const [uploadedFile, setUploadedFile] = useState<string | null>(null);
  const [aiInstruction, setAiInstruction] = useState('');
  const [mappingVisible, setMappingVisible] = useState(false);
  const [batchGenerated, setBatchGenerated] = useState(false);
  const [generating, setGenerating] = useState(false);

  // AI extract mode
  const [aiExtractTab3, setAiExtractTab3] = useState<'paste' | 'upload'>('paste');
  const [aiExtractText3, setAiExtractText3] = useState('');
  const [aiExtractFile3, setAiExtractFile3] = useState<File | null>(null);
  const [aiExtractAnalyzing3, setAiExtractAnalyzing3] = useState(false);
  const [aiExtractBanner3, setAiExtractBanner3] = useState<{ found: number; total: number; missing: string[] } | null>(null);

  // Preview
  const [aiEditText, setAiEditText] = useState('');
  const [previewOverride, setPreviewOverride] = useState<string | null>(null);
  const [applyingEdit, setApplyingEdit] = useState(false);
  const [downloaded, setDownloaded] = useState(false);

  // Approval modal
  const [approvalOpen, setApprovalOpen] = useState(false);
  const [approver, setApprover] = useState<'Legal' | 'Manager'>('Legal');
  const [approvalComment, setApprovalComment] = useState('');
  const [approvalSent, setApprovalSent] = useState(false);

  const previewContent = previewOverride ?? applyPlaceholders(templateContent, fields);

  const updateField = (key: string, value: string) => {
    setFields(prev => prev.map(f => f.key === key ? { ...f, value } : f));
    setAutoFilledKeys(prev => { const next = new Set(prev); next.delete(key); return next; });
    setPreviewOverride(null);
  };

  const handleFakeUpload = () => {
    setUploadedFile('customer_list.xlsx');
    setMappingVisible(false);
    setBatchGenerated(false);
    setPreviewOverride(null);
  };

  const handleShowMapping = () => {
    setGenerating(true);
    setTimeout(() => { setMappingVisible(true); setGenerating(false); }, 1400);
  };

  const handleBatchGenerate = () => {
    setGenerating(true);
    setTimeout(() => {
      setBatchGenerated(true);
      setGenerating(false);
      const newItem: HistoryItem = {
        id: `h-${Date.now()}`,
        title: `Batch ${docType} — ${FAKE_BATCH_ROWS.length} documents`,
        type: docType,
        lastEdited: new Date().toLocaleDateString('en-US', { year: 'numeric', month: '2-digit', day: '2-digit' }),
        status: 'Batch Generated',
        currentStep: 3,
        versions: [{ label: 'Final', createdAt: new Date().toLocaleDateString() }],
        activity: [
          { id: 'a1', action: 'Created', timestamp: new Date().toLocaleString() },
          { id: 'a2', action: `Batch generated (${FAKE_BATCH_ROWS.length} records)`, timestamp: new Date().toLocaleString() },
        ],
      };
      onSavedHistoryChange([newItem, ...savedHistory]);
    }, 1800);
  };

  const handleAiExtract3 = async () => {
    setAiExtractAnalyzing3(true);
    setAiExtractBanner3(null);
    try {
      let result;
      const fieldHints = fields.map(f => ({ placeholder: f.key, label: f.label }));
      if (aiExtractTab3 === 'paste') {
        result = await generatorApi.extractFromText({ field_hints: fieldHints, text: aiExtractText3 });
      } else {
        if (!aiExtractFile3) return;
        result = await generatorApi.extractFromFile({ template_id: '', files: [aiExtractFile3] });
      }
      const foundKeys = new Set<string>();
      setFields(prev => prev.map(f => {
        const val = result.field_values[f.key] ?? result.field_values[`{${f.key}}`];
        if (val) { foundKeys.add(f.key); return { ...f, value: val }; }
        return f;
      }));
      setAutoFilledKeys(prev => new Set([...prev, ...foundKeys]));
      setPreviewOverride(null);
      const missingLabels = fields.filter(f => !foundKeys.has(f.key) && !f.value).map(f => f.label);
      setAiExtractBanner3({ found: foundKeys.size, total: fields.length, missing: missingLabels });
    } catch {
      // silent fail — user sees empty fields
    } finally {
      setAiExtractAnalyzing3(false);
    }
  };

  const handleManualDownload = () => {
    const customerName = fields.find(f => f.key === 'customer_name')?.value;
    const newItem: HistoryItem = {
      id: `h-${Date.now()}`,
      title: customerName ? `${docType} — ${customerName}` : `${docType} Document`,
      type: docType,
      lastEdited: new Date().toLocaleDateString('en-US', { year: 'numeric', month: '2-digit', day: '2-digit' }),
      status: 'Completed',
      currentStep: 3,
      versions: [{ label: 'Final', createdAt: new Date().toLocaleDateString() }],
      activity: [
        { id: 'a1', action: 'Created', timestamp: new Date().toLocaleString() },
        { id: 'a2', action: 'Placeholder fill completed', timestamp: new Date().toLocaleString() },
        { id: 'a3', action: 'Downloaded', timestamp: new Date().toLocaleString() },
      ],
    };
    onSavedHistoryChange([newItem, ...savedHistory]);
    setDownloaded(true);
    setTimeout(() => setDownloaded(false), 3000);
  };

  const handleAiEdit = () => {
    if (!aiEditText.trim()) return;
    setApplyingEdit(true);
    setTimeout(() => {
      const updated = applyRevision(previewContent, aiEditText, 1);
      setPreviewOverride(updated);
      setAiEditText('');
      setApplyingEdit(false);
    }, 1000);
  };

  const filledCount = fields.filter(f => f.value.trim() !== '').length;

  return (
    <div className="flex h-full">
      {/* ── LEFT: live preview ── */}
      <div className="flex-1 flex flex-col border-r border-border min-w-0">
        <div className="px-5 py-2.5 border-b border-border bg-card flex items-center gap-3 flex-shrink-0">
          <FileText className="w-4 h-4 text-muted-foreground" />
          <span className="text-sm font-medium text-foreground">{t('generatorV1.step3.previewHeaderPrefix')} {t(`generatorV1.docType.${docType}.label`, { defaultValue: docType })}</span>
          {mode === 'manual' && filledCount > 0 && (
            <span className="text-xs text-muted-foreground ml-1">{t('generatorV1.step3.filledCount', { filled: filledCount, total: fields.length })}</span>
          )}
          <Badge variant="outline" className="ml-auto text-xs text-emerald-700 border-emerald-300 bg-emerald-50">
            {t('generatorV1.step3.completedBadge')}
          </Badge>
        </div>

        <div className="flex-1 min-h-0 flex flex-col">
          <DocPreview content={previewContent} />
          {/* AI correction bar */}
          <div className="border-t border-border px-4 py-2.5 flex-shrink-0 bg-card">
            <div className="flex items-center gap-2">
              <div className="flex-1 flex items-center gap-2 bg-muted/50 rounded-lg border border-border px-3 py-2">
                <Sparkles className="w-3.5 h-3.5 text-primary flex-shrink-0" />
                <input
                  className="flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
                  placeholder={t('generatorV1.step3.aiEditPlaceholder')}
                  value={aiEditText}
                  onChange={e => setAiEditText(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleAiEdit(); } }}
                />
              </div>
              <Button size="sm" variant="outline" onClick={handleAiEdit} disabled={!aiEditText.trim() || applyingEdit} className="flex-shrink-0 h-8 gap-1.5 text-xs">
                {applyingEdit ? <><Loader2 className="w-3.5 h-3.5 animate-spin" />{t('generatorV1.step3.applyingBtn')}</> : <><Sparkles className="w-3.5 h-3.5" />{t('generatorV1.step3.applyBtn')}</>}
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* ── RIGHT: data fill panel ── */}
      <div className="w-[310px] flex-shrink-0 flex flex-col bg-background">
        {/* Smart Suggestion box */}
        <div className="px-4 pt-4 pb-3 border-b border-border flex-shrink-0">
          <div className="rounded-xl border border-primary/25 bg-primary/5 p-3 space-y-2">
            <div className="flex items-start gap-2">
              <div className="w-7 h-7 rounded-lg bg-primary/15 flex items-center justify-center flex-shrink-0">
                <Sparkles className="w-3.5 h-3.5 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-primary/80">{t('generatorV1.step3.smartSuggestionLabel')}</p>
                <p className="text-xs text-foreground mt-0.5 leading-relaxed">Bạn có muốn lấy thông tin từ báo giá <span className="font-semibold">#BG-123</span> vừa tạo sáng nay không?</p>
              </div>
            </div>
            <Button
              size="sm"
              className="w-full h-7 text-[11px] gap-1.5"
              onClick={() => {
                const data = SMART_SUGGESTION_DATA[docType] ?? {};
                const filledKeys = new Set<string>();
                setFields(prev => prev.map(f => {
                  const v = data[f.key];
                  if (v) { filledKeys.add(f.key); return { ...f, value: v }; }
                  return f;
                }));
                setAutoFilledKeys(filledKeys);
                setPreviewOverride(null);
                setMode('manual');
              }}
            >
              <Sparkles className="w-3 h-3" />Dùng gợi ý thông minh
            </Button>
          </div>
        </div>

        {/* Mode selector — 3 tabs */}
        <div className="px-4 py-3 border-b border-border flex-shrink-0 space-y-2">
          <p className="text-xs font-semibold text-foreground">{t('generatorV1.step3.fillModeTitle')}</p>
          <div className="flex rounded-lg border border-border overflow-hidden">
            <button onClick={() => setMode('manual')} className={`flex-1 py-1.5 text-xs font-medium transition-colors ${mode === 'manual' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'}`}>{t('generatorV1.step3.fillModeManual')}</button>
            <button onClick={() => setMode('ai')} className={`flex-1 py-1.5 text-xs font-medium transition-colors ${mode === 'ai' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'}`}>{t('generatorV1.step3.fillModeAi')}</button>
            <button onClick={() => setMode('batch')} className={`flex-1 py-1.5 text-xs font-medium transition-colors ${mode === 'batch' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'}`}>{t('generatorV1.step3.fillModeBatch')}</button>
          </div>
        </div>


        <ScrollArea className="flex-1">
          <AnimatePresence mode="wait">

            {/* ── Mode A: Manual Fill ── */}
            {mode === 'manual' && (
              <motion.div key="manual" initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 8 }} transition={{ duration: 0.15 }} className="p-5 space-y-5">
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">{t('generatorV1.step3.placeholderFieldsLabel')}</span>
                    <span className="font-medium text-foreground">{filledCount} / {fields.length}</span>
                  </div>
                  <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
                    <motion.div className="h-full bg-primary rounded-full" animate={{ width: `${(filledCount / fields.length) * 100}%` }} transition={{ duration: 0.3 }} />
                  </div>
                  <p className="text-[10px] text-muted-foreground">{t('generatorV1.step3.previewUpdateHint')}</p>
                </div>
                <Separator />
                <div className="space-y-4">
                  {fields.map(field => {
                    const isAuto = autoFilledKeys.has(field.key);
                    const isHovered = hoveredFieldKey === field.key;
                    return (
                      <div
                        key={field.key}
                        className="space-y-1.5"
                        onMouseEnter={() => setHoveredFieldKey(field.key)}
                        onMouseLeave={() => setHoveredFieldKey(null)}
                      >
                        <Label className="text-xs font-medium text-foreground flex items-center gap-1.5">
                          {field.label}
                          <span className="text-muted-foreground font-normal font-mono text-[10px]">{`{${field.key}}`}</span>
                          {isAuto && <span className="inline-flex items-center gap-0.5 text-[9px] text-amber-700 bg-amber-100 px-1 py-0.5 rounded font-medium"><Sparkles className="w-2.5 h-2.5" />AI auto-fill</span>}
                          {field.value && <Check className="w-3 h-3 text-emerald-500 ml-auto" />}
                        </Label>
                        {field.key === 'effective_date' ? (
                          <Input type="date" className={`text-xs h-8 transition-colors ${isAuto ? 'bg-amber-50 border-amber-200' : ''} ${isHovered ? 'ring-2 ring-primary/30' : ''}`} value={field.value} onChange={e => updateField(field.key, e.target.value)} />
                        ) : (
                          <Input className={`text-xs h-8 transition-colors ${isAuto ? 'bg-amber-50 border-amber-200' : ''} ${isHovered ? 'ring-2 ring-primary/30' : ''}`} placeholder={`Nhập ${field.label.toLowerCase()}…`} value={field.value} onChange={e => updateField(field.key, e.target.value)} />
                        )}
                      </div>
                    );
                  })}
                </div>
                <Separator />
                <AnimatePresence>
                  {downloaded ? (
                    <motion.div initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} className="flex items-center gap-2 text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2.5">
                      <Check className="w-3.5 h-3.5 flex-shrink-0" />
                      {t('generatorV1.step3.savedToMyDocs')}
                    </motion.div>
                  ) : (
                    <div className="space-y-2">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button className="w-full gap-2">
                            <Download className="w-4 h-4" />{t('generatorV1.step3.exportCreateBtn')}
                            <ChevronDown className="w-3.5 h-3.5 ml-auto opacity-70" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-56">
                          <DropdownMenuItem onClick={handleManualDownload} className="text-xs gap-2">
                            <FileDown className="w-3.5 h-3.5" />{t('generatorV1.step3.exportDocx')}
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={handleManualDownload} className="text-xs gap-2">
                            <FileDown className="w-3.5 h-3.5" />{t('generatorV1.step3.exportPdf')}
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            onClick={() => navigate(ROUTE_PATHS.DOCUMENT_REVIEW)}
                            className="text-xs gap-2"
                          >
                            <FileSearch className="w-3.5 h-3.5" />{t('generatorV1.step3.sendToReview')}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                      <Button variant="outline" className="w-full gap-2 h-9 text-xs" onClick={() => setApprovalOpen(true)}>
                        <Send className="w-3.5 h-3.5" />{t('generatorV1.step3.sendForApprovalBtn')}
                      </Button>
                      <Button variant="ghost" className="w-full gap-2 h-8 text-xs text-muted-foreground" onClick={() => navigate(ROUTE_PATHS.DOCUMENT_REVIEW)}>
                        <FileSearch className="w-3.5 h-3.5" />{t('generatorV1.step3.analyzeBtn')}
                      </Button>
                    </div>
                  )}
                </AnimatePresence>
              </motion.div>
            )}

            {/* ── Mode B: AI Trích xuất ── */}
            {mode === 'ai' && (
              <motion.div key="ai" initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 8 }} transition={{ duration: 0.15 }} className="p-5 space-y-4">
                {/* Sub-tabs */}
                <div className="flex rounded-md border border-border overflow-hidden">
                  <button onClick={() => setAiExtractTab3('paste')} className={`flex-1 py-1 text-xs font-normal transition-colors ${aiExtractTab3 === 'paste' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'}`}>{t('generatorV1.step2.aiExtract.tabPaste')}</button>
                  <button onClick={() => setAiExtractTab3('upload')} className={`flex-1 py-1 text-xs font-normal transition-colors ${aiExtractTab3 === 'upload' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'}`}>{t('generatorV1.step2.aiExtract.tabUpload')}</button>
                </div>

                {/* Paste tab */}
                {aiExtractTab3 === 'paste' && (
                  <div className="space-y-2">
                    <Textarea
                      value={aiExtractText3}
                      onChange={e => setAiExtractText3(e.target.value)}
                      placeholder={t('generatorV1.step2.aiExtract.pastePlaceholder')}
                      className="text-[11px] md:text-[11px] min-h-[140px] resize-none leading-relaxed"
                      disabled={aiExtractAnalyzing3}
                    />
                    <Button size="sm" className="w-full h-9 text-xs gap-1.5" onClick={handleAiExtract3} disabled={aiExtractAnalyzing3 || !aiExtractText3.trim()}>
                      {aiExtractAnalyzing3 ? <><Loader2 className="w-3.5 h-3.5 animate-spin" />{t('generatorV1.step2.aiExtract.analyzing')}</> : <><Sparkles className="w-3.5 h-3.5" />{t('generatorV1.step2.aiExtract.analyzeBtn')}</>}
                    </Button>
                  </div>
                )}

                {/* Upload tab */}
                {aiExtractTab3 === 'upload' && (
                  <div className="space-y-2">
                    <label className="block cursor-pointer">
                      <div className={`border-2 border-dashed rounded-lg p-5 text-center transition-colors ${aiExtractFile3 ? 'border-primary/40 bg-primary/5' : 'border-border hover:border-primary/40'}`}>
                        {aiExtractFile3 ? (
                          <div className="flex items-center justify-center gap-2">
                            <FileText className="w-4 h-4 text-primary flex-shrink-0" />
                            <span className="text-xs font-medium text-primary truncate max-w-[160px]">{aiExtractFile3.name}</span>
                            <button type="button" onClick={e => { e.preventDefault(); setAiExtractFile3(null); }} className="text-muted-foreground hover:text-destructive flex-shrink-0"><X className="w-3.5 h-3.5" /></button>
                          </div>
                        ) : (
                          <>
                            <Upload className="w-6 h-6 text-muted-foreground mx-auto mb-2" />
                            <p className="text-xs text-foreground/75 font-medium">{t('generatorV1.step2.aiExtract.uploadHint')}</p>
                            <p className="text-[10px] text-muted-foreground mt-1">PDF, DOCX, TXT</p>
                          </>
                        )}
                      </div>
                      <input type="file" accept=".pdf,.docx,.doc,.txt" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) setAiExtractFile3(f); e.target.value = ''; }} />
                    </label>
                    <Button size="sm" className="w-full h-9 text-xs gap-1.5" onClick={handleAiExtract3} disabled={aiExtractAnalyzing3 || !aiExtractFile3}>
                      {aiExtractAnalyzing3 ? <><Loader2 className="w-3.5 h-3.5 animate-spin" />{t('generatorV1.step2.aiExtract.analyzing')}</> : <><Sparkles className="w-3.5 h-3.5" />{t('generatorV1.step2.aiExtract.analyzeBtn')}</>}
                    </Button>
                  </div>
                )}

                {/* Result banner */}
                {aiExtractBanner3 && (
                  <div className={`rounded-lg border px-3 py-2.5 space-y-1 ${aiExtractBanner3.missing.length === 0 ? 'bg-emerald-50 border-emerald-200' : 'bg-amber-50 border-amber-200'}`}>
                    <div className="flex items-center gap-1.5">
                      {aiExtractBanner3.missing.length === 0 ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 flex-shrink-0" /> : <AlertCircle className="w-3.5 h-3.5 text-amber-600 flex-shrink-0" />}
                      <p className={`text-[11px] font-semibold ${aiExtractBanner3.missing.length === 0 ? 'text-emerald-800' : 'text-amber-800'}`}>
                        {t('generatorV1.step2.aiExtract.bannerFound', { found: aiExtractBanner3.found, total: aiExtractBanner3.total })}
                      </p>
                    </div>
                    {aiExtractBanner3.missing.length > 0 && (
                      <p className="text-[10px] text-amber-700 leading-relaxed pl-5">
                        {t('generatorV1.step2.aiExtract.bannerMissing', { count: aiExtractBanner3.missing.length, fields: aiExtractBanner3.missing.join(', ') })}
                      </p>
                    )}
                  </div>
                )}

                {/* Fields display after extract */}
                {aiExtractBanner3 && (
                  <div className="space-y-3">
                    <Separator />
                    <p className="text-xs font-semibold text-foreground">{t('generatorV1.step3.placeholderFieldsLabel')}</p>
                    <div className="space-y-3">
                      {fields.map(field => {
                        const isAuto = autoFilledKeys.has(field.key);
                        return (
                          <div key={field.key} className="space-y-1.5">
                            <Label className="text-xs font-medium text-foreground flex items-center gap-1.5">
                              {field.label}
                              {isAuto && <span className="inline-flex items-center gap-0.5 text-[9px] text-amber-700 bg-amber-100 px-1 py-0.5 rounded font-medium"><Sparkles className="w-2.5 h-2.5" />AI</span>}
                              {field.value && <Check className="w-3 h-3 text-emerald-500 ml-auto" />}
                            </Label>
                            <Input className={`text-xs h-8 transition-colors ${isAuto ? 'bg-amber-50 border-amber-200' : ''}`} placeholder={`Nhập ${field.label.toLowerCase()}…`} value={field.value} onChange={e => updateField(field.key, e.target.value)} />
                          </div>
                        );
                      })}
                    </div>
                    <Button className="w-full gap-2 h-9 text-xs" onClick={handleManualDownload}>
                      <Download className="w-4 h-4" />{t('generatorV1.step3.exportCreateBtn')}
                    </Button>
                  </div>
                )}
              </motion.div>
            )}

            {/* ── Mode C: Batch Upload ── */}
            {mode === 'batch' && (
              <motion.div key="batch" initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -8 }} transition={{ duration: 0.15 }} className="p-5 space-y-5">
                <p className="text-xs text-muted-foreground leading-relaxed">{t('generatorV1.step3.batchDesc')}</p>

                {/* Upload zone */}
                {!uploadedFile ? (
                  <button onClick={handleFakeUpload} className="w-full border-2 border-dashed border-border rounded-xl py-6 flex flex-col items-center gap-2 text-xs text-muted-foreground hover:border-primary/50 hover:text-primary hover:bg-primary/3 transition-all">
                    <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center">
                      <Upload className="w-5 h-5" />
                    </div>
                    <span className="font-medium">{t('generatorV1.step3.batchUploadBtn')}</span>
                    <span className="text-[10px] text-muted-foreground/70">{t('generatorV1.step3.batchUploadHint')}</span>
                  </button>
                ) : (
                  <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5 flex items-center gap-2 text-xs text-emerald-700">
                    <Check className="w-3.5 h-3.5 flex-shrink-0" />
                    <span className="flex-1 truncate font-medium">{uploadedFile}</span>
                    <span className="text-emerald-600 opacity-70">{t('generatorV1.step3.batchRowCount', { n: 3 })}</span>
                    <button onClick={() => { setUploadedFile(null); setMappingVisible(false); setBatchGenerated(false); }} className="opacity-60 hover:opacity-100"><X className="w-3 h-3" /></button>
                  </div>
                )}

                {/* AI instruction + run mapping */}
                {uploadedFile && !mappingVisible && (
                  <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-2.5">
                    <div className="space-y-1.5">
                      <Label className="text-xs font-medium flex items-center gap-1.5">
                        <Sparkles className="w-3 h-3 text-primary" />
                        {t('generatorV1.step3.batchAiInstructionLabel')}
                      </Label>
                      <Textarea
                        rows={3}
                        className="text-xs resize-none"
                        placeholder={t('generatorV1.step3.batchAiInstructionPlaceholder')}
                        value={aiInstruction}
                        onChange={e => setAiInstruction(e.target.value)}
                      />
                    </div>
                    <Button variant="outline" className="w-full text-xs gap-1.5 h-8 border-primary/30 text-primary hover:bg-primary/5" onClick={handleShowMapping} disabled={generating}>
                      {generating ? <><Loader2 className="w-3.5 h-3.5 animate-spin" />{t('generatorV1.step3.batchAnalyzingBtn')}</> : <><TableProperties className="w-3.5 h-3.5" />{t('generatorV1.step3.batchRunMappingBtn')}</>}
                    </Button>
                  </motion.div>
                )}

                {/* Mapping result */}
                <AnimatePresence>
                  {mappingVisible && (
                    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-4">
                      <div className="space-y-2">
                        <div className="flex items-center gap-1.5">
                          <Check className="w-3.5 h-3.5 text-emerald-600" />
                          <p className="text-xs font-semibold text-emerald-700">{t('generatorV1.step3.batchMappingDoneTitle')}</p>
                        </div>
                        <div className="rounded-lg border border-border overflow-hidden text-xs w-full">
                          <div className="grid grid-cols-2 bg-muted/60 px-3 py-1.5 font-medium text-muted-foreground text-[10px] uppercase tracking-wide">
                            <span>{t('generatorV1.step3.batchColumnHeader')}</span><span>{t('generatorV1.step3.batchPlaceholderHeader')}</span>
                          </div>
                          {COLUMN_MAPPING.map((m, i) => (
                            <div key={i} className={`grid grid-cols-2 px-3 py-2 items-center min-w-0 ${i % 2 === 0 ? 'bg-background' : 'bg-muted/20'}`}>
                              <span className="text-foreground/80 truncate min-w-0">{m.column}</span>
                              <span className="font-mono text-primary/80 text-[10px] truncate min-w-0 break-all">{m.placeholder}</span>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Sample row */}
                      <div className="rounded-lg border border-border bg-muted/20 p-3 space-y-1.5 w-full overflow-hidden">
                        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">{t('generatorV1.step3.batchPreviewRowTitle')}</p>
                        {FAKE_BATCH_ROWS[0] && Object.entries(FAKE_BATCH_ROWS[0]).map(([k, v]) => (
                          <div key={k} className="flex gap-2 text-xs min-w-0">
                            <span className="text-muted-foreground w-20 flex-shrink-0 truncate">{k.replace(/_/g, ' ')}</span>
                            <span className="text-foreground font-medium truncate flex-1 min-w-0">{v}</span>
                          </div>
                        ))}
                      </div>

                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground bg-muted/40 rounded-lg px-3 py-2">
                        <Package className="w-3.5 h-3.5 flex-shrink-0" />
                        <span><strong className="text-foreground">{t('generatorV1.step3.batchRecordCount', { n: FAKE_BATCH_ROWS.length })}</strong> {t('generatorV1.step3.batchArrow', { n: FAKE_BATCH_ROWS.length })}</span>
                      </div>

                      {!batchGenerated ? (
                        <Button className="w-full gap-1.5 text-xs h-9" onClick={handleBatchGenerate} disabled={generating}>
                          {generating ? <><Loader2 className="w-3.5 h-3.5 animate-spin" />{t('generatorV1.step3.batchGeneratingBtn')}</> : <><Package className="w-3.5 h-3.5" />{t('generatorV1.step3.batchGenerateBtn')}</>}
                        </Button>
                      ) : (
                        <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="space-y-3">
                          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 space-y-3">
                            <div className="flex items-center gap-2">
                              <div className="w-7 h-7 rounded-full bg-emerald-100 flex items-center justify-center">
                                <Check className="w-4 h-4 text-emerald-600" />
                              </div>
                              <p className="text-sm font-semibold text-emerald-800">{t('generatorV1.step3.batchDoneTitle')}</p>
                            </div>
                            <div className="grid grid-cols-2 gap-2 text-xs">
                              <div className="bg-white/70 rounded-lg p-2 text-center">
                                <p className="text-emerald-800 font-bold text-base">{FAKE_BATCH_ROWS.length}</p>
                                <p className="text-emerald-600">{t('generatorV1.step3.batchTotalRecords')}</p>
                              </div>
                              <div className="bg-white/70 rounded-lg p-2 text-center">
                                <p className="text-emerald-800 font-bold text-base">{FAKE_BATCH_ROWS.length}</p>
                                <p className="text-emerald-600">{t('generatorV1.step3.batchCreated')}</p>
                              </div>
                            </div>
                            <div className="text-xs text-emerald-700 space-y-0.5">
                              <p>Loại: <strong>{docType}</strong></p>
                              <p>{t('generatorV1.step3.batchFormatLabel')} <strong>DOCX</strong></p>
                            </div>
                          </div>
                          <Button className="w-full gap-2 text-xs h-9" variant="outline">
                            <Download className="w-3.5 h-3.5" />{t('generatorV1.step3.batchDownloadZipBtn', { n: FAKE_BATCH_ROWS.length })}
                          </Button>
                        </motion.div>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            )}

          </AnimatePresence>
        </ScrollArea>

        {/* Sticky bottom CTAs */}
        <div className="border-t border-border bg-card px-4 py-3 flex-shrink-0 space-y-2">
          <Button
            variant="outline"
            className="w-full gap-2 h-9 text-xs"
            onClick={() => {
              setApplyingEdit(true);
              setTimeout(() => {
                const refreshed = applyRevision(applyPlaceholders(templateContent, fields), 'Cải thiện nháp', 1);
                setPreviewOverride(refreshed);
                setApplyingEdit(false);
              }, 900);
            }}
            disabled={applyingEdit}
          >
            {applyingEdit ? <><Loader2 className="w-3.5 h-3.5 animate-spin" />{t('generatorV1.step3.bottomGeneratingBtn')}</> : <><Sparkles className="w-3.5 h-3.5" />{t('generatorV1.step3.bottomGenerateDraftBtn')}</>}
          </Button>
          <Button className="w-full gap-2 h-10 text-sm font-semibold" onClick={handleManualDownload}>
            <Check className="w-4 h-4" />Create Document
          </Button>
        </div>
      </div>


      {/* ── Approval Modal ── */}
      <Dialog open={approvalOpen} onOpenChange={setApprovalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t('generatorV1.step3.approvalModalTitle')}</DialogTitle>
            <DialogDescription className="text-xs">{t('generatorV1.step3.approvalModalDesc')}</DialogDescription>
          </DialogHeader>
          {approvalSent ? (
            <div className="flex items-center gap-2 text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-3">
              <Check className="w-4 h-4" /> {t('generatorV1.step3.approvalSentMsg', { approver })}
            </div>
          ) : (
            <div className="space-y-4 py-1">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">{t('generatorV1.step3.approverLabel')}</Label>
                <Select value={approver} onValueChange={v => setApprover(v as 'Legal' | 'Manager')}>
                  <SelectTrigger className="text-xs h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Legal" className="text-xs">Legal</SelectItem>
                    <SelectItem value="Manager" className="text-xs">Manager</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">{t('generatorV1.step3.approvalNoteLabel')}</Label>
                <Textarea rows={3} className="text-xs resize-none" placeholder={t('generatorV1.step3.approvalNotePlaceholder')} value={approvalComment} onChange={e => setApprovalComment(e.target.value)} />
              </div>
            </div>
          )}
          <DialogFooter>
            {!approvalSent && (
              <>
                <Button variant="outline" onClick={() => setApprovalOpen(false)}>{t('generatorV1.step3.approvalCancelBtn')}</Button>
                <Button onClick={() => { setApprovalSent(true); setTimeout(() => { setApprovalOpen(false); setApprovalSent(false); setApprovalComment(''); }, 1500); }} className="gap-1.5">
                  <Send className="w-3.5 h-3.5" />{t('generatorV1.step3.approvalSendBtn')}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
