// @ts-nocheck
import { useState, useRef, useEffect } from 'react';
import { motion } from 'motion/react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format as fmtDate, parseISO } from 'date-fns';
import { useTranslation } from 'react-i18next';
import {
  ChevronRight, Clock, FileSearch, FileText, FolderOpen,
  Loader2, MoreHorizontal, Package, Pencil, Search, Send, Trash2, Upload, CheckCircle2,
} from 'lucide-react';
import { Button } from '@/app/components/ui/button';
import { Input } from '@/app/components/ui/input';
import { Label } from '@/app/components/ui/label';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/app/components/ui/dialog';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/app/components/ui/dropdown-menu';
import type { SavedTemplatesPanelProps, SavedTplCard, KhoTriThucFileTab } from './types';
import { templatesApi } from '@/app/api/endpoints/templates';
import { documentsApi } from '@/app/api/endpoints/documents';
import { generatorDocToTemplateApi } from '@/app/api/endpoints/generator';

// Fake template content used in the template editor preview
const FAKE_TEMPLATE_CONTENT = `HỢP ĐỒNG DỊCH VỤ

Số hợp đồng: HD-2026-{contract_number}

Giữa:
  BÊN A (Bên cung cấp dịch vụ):
    Công ty: {company_name}
    Địa chỉ: {company_address}
    Mã số thuế: {tax_code}
    Đại diện: {legal_representative}

  BÊN B (Bên sử dụng dịch vụ):
    Tên khách hàng: {customer_name}
    Giá trị hợp đồng: {contract_value}
    Ngày hiệu lực: {effective_date}
    Thời hạn hợp đồng: {contract_duration}

ĐIỀU KHOẢN THANH TOÁN:
  {payment_terms}

ĐIỀU KHOẢN THƯƠNG MẠI:
  {commercial_terms}

Hợp đồng này có hiệu lực kể từ ngày {effective_date} và được ký bởi đại diện
hợp pháp của cả hai bên.`;

const FAKE_DETECTED_PARAMS = [
  { key: 'contract_number',  label: 'Số hợp đồng' },
  { key: 'company_name',     label: 'Tên công ty' },
  { key: 'company_address',  label: 'Địa chỉ công ty' },
  { key: 'tax_code',         label: 'Mã số thuế' },
  { key: 'legal_representative', label: 'Đại diện pháp lý' },
  { key: 'customer_name',    label: 'Tên khách hàng' },
  { key: 'contract_value',   label: 'Giá trị hợp đồng' },
  { key: 'effective_date',   label: 'Ngày hiệu lực' },
  { key: 'contract_duration',label: 'Thời hạn hợp đồng' },
  { key: 'payment_terms',    label: 'Điều khoản thanh toán' },
  { key: 'commercial_terms', label: 'Điều khoản thương mại' },
];

export function SavedTemplatesPanel({ onPick, pushToast }: SavedTemplatesPanelProps) {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const [extraCards, setExtraCards] = useState<SavedTplCard[]>([]);

  // Kho Tri Thuc file picker modal state
  const [khoTriThucOpen, setKhoTriThucOpen] = useState(false);
  const [khoSearch, setKhoSearch] = useState('');
  const [khoTab, setKhoTab] = useState<KhoTriThucFileTab | 'upload'>('recent');
  const [khoSelected, setKhoSelected] = useState<Set<string>>(new Set());
  const [khoSelecting, setKhoSelecting] = useState(false);

  // Phase A — real template list from backend
  const { data: templatesData, isLoading: templatesLoading } = useQuery({
    queryKey: ['generator-templates', search],
    queryFn: () => templatesApi.list({ q: search || undefined, limit: 50 }),
    staleTime: 30_000,
  });

  const apiCards: SavedTplCard[] = (templatesData?.items ?? []).map(t => ({
    id: t.id,
    name: t.title,
    tag: 'Template',
    description: t.description ?? '',
    type: 'Sales Contract', // fallback; type is not stored on backend template
    updatedAt: t.updated_at ? fmtDate(parseISO(t.updated_at), 'dd/MM/yyyy') : undefined,
  }));

  // Phase A2/K — real Kho Tri Thức file list
  const { data: khoData, isLoading: khoLoading } = useQuery({
    queryKey: ['kho-tri-thuc', khoTab, khoSearch],
    queryFn: () => documentsApi.list({
      q: khoSearch || undefined,
      page_size: 30,
      ...(khoTab === 'shared' ? { shared_with_me: true } : {}),
    }),
    enabled: khoTriThucOpen && khoTab !== 'upload',
    staleTime: 15_000,
  });

  const khoFiltered = (khoData?.items ?? [])
    .filter(d => !khoSearch || (d.title || d.original_filename || '').toLowerCase().includes(khoSearch.toLowerCase()));

  // Upload tab state
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadAbortRef = useRef<AbortController | null>(null);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadDragging, setUploadDragging] = useState(false);
  const [uploadState, setUploadState] = useState<'idle' | 'uploading' | 'converting' | 'done'>('idle');
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadSecondsLeft, setUploadSecondsLeft] = useState(0);

  // Animate progress bar during AI analysis (converting phase)
  useEffect(() => {
    if (uploadState === 'uploading') {
      setUploadProgress(0);
      setUploadSecondsLeft(45);
      return;
    }
    if (uploadState !== 'converting') {
      if (uploadState === 'done') setUploadProgress(100);
      return;
    }
    // Simulate: 0→88% over 40s, then stall until done
    const TOTAL_FAKE_S = 40;
    setUploadProgress(5);
    setUploadSecondsLeft(TOTAL_FAKE_S);
    const tick = setInterval(() => {
      setUploadProgress(prev => {
        if (prev >= 88) { clearInterval(tick); return 88; }
        return prev + (83 / (TOTAL_FAKE_S * 2)); // step every 500ms
      });
      setUploadSecondsLeft(prev => Math.max(1, prev - 0.5));
    }, 500);
    return () => clearInterval(tick);
  }, [uploadState]);

  // Merge: extra locally-created cards (from upload/kho flow) + real API cards
  const allCards = [...extraCards, ...apiCards];
  const filtered = allCards.filter(c =>
    !search || c.name.toLowerCase().includes(search.toLowerCase()) || c.tag.toLowerCase().includes(search.toLowerCase())
  );

  const closeKhoModal = () => {
    uploadAbortRef.current?.abort();
    uploadAbortRef.current = null;
    setKhoTriThucOpen(false);
    setKhoSearch('');
    setKhoSelected(new Set());
    setKhoTab('recent');
    setUploadFile(null);
    setUploadState('idle');
    setUploadDragging(false);
    setUploadProgress(0);
    setUploadSecondsLeft(0);
  };

  // Click an existing template card — card.id is now a real template UUID
  const handleOpenCard = (c: SavedTplCard) => {
    onPick(c); // page uses card.id as selectedTemplateId; Step2 fetches real fields
  };

  // Toggle file selection in Kho modal
  const toggleKhoFile = (id: string) => {
    setKhoSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  // "Chọn file" → convert selected document to template via AI, then open editor
  const handleConfirmKhoSelection = async () => {
    if (khoSelected.size === 0) return;
    setKhoSelecting(true);
    try {
      const docId = [...khoSelected][0];
      const selectedDoc = khoFiltered.find(d => d.id === docId);
      const docName = selectedDoc?.title || selectedDoc?.original_filename || 'Template';

      const result = await generatorDocToTemplateApi.convert({
        document_id: docId,
        title: docName.replace(/\.[^.]+$/, ''),
      });

      const card: SavedTplCard = {
        id: result.template_id,
        name: result.title,
        tag: 'Template',
        description: `Template từ Kho tri thức — ${docName}`,
        type: 'Sales Contract',
        updatedAt: fmtDate(new Date(), 'dd/MM/yyyy'),
      };
      setExtraCards(prev => [card, ...prev]);
      queryClient.invalidateQueries({ queryKey: ['generator-templates'] });
      closeKhoModal();
      const _detected = result.detected_count ?? result.field_count;
      pushToast?.(t('generatorV1.savedTemplates.toast.templateCreated', { field_count: result.field_count, detected: _detected }), 'success', 2600);
      onPick(card); // page sets selectedTemplateId = card.id
    } catch {
      pushToast?.(t('generatorV1.savedTemplates.toast.processFail'), 'error', 2500);
    } finally {
      setKhoSelecting(false);
    }
  };

  // ── Template CRUD ──────────────────────────────────────────────────────────
  const queryClient = useQueryClient();
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<SavedTplCard | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<SavedTplCard | null>(null);

  const { data: templateUsageData } = useQuery({
    queryKey: ['template-usage', deleteTarget?.id],
    queryFn: () => documentsApi.templateUsage(deleteTarget!.id),
    enabled: !!deleteTarget?.id && deleteOpen,
  });
  const draftSessionCount = templateUsageData?.draft_session_count ?? 0;

  const renameMutation = useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) =>
      documentsApi.update(id, { title }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['generator-templates'] });
      setExtraCards(prev => prev.map(c => c.id === renameTarget?.id ? { ...c, name: renameValue.trim() } : c));
      pushToast?.(t('generatorV1.savedTemplates.toast.renamed'), 'success', 1800);
      setRenameOpen(false);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => documentsApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['generator-templates'] });
      setExtraCards(prev => prev.filter(c => c.id !== deleteTarget?.id));
      pushToast?.(t('generatorV1.savedTemplates.toast.deleted'), 'success', 1800);
      setDeleteOpen(false);
    },
  });

  const openRename = (e: React.MouseEvent, card: SavedTplCard) => {
    e.stopPropagation();
    setRenameTarget(card);
    setRenameValue(card.name);
    setRenameOpen(true);
  };
  const openDelete = (e: React.MouseEvent, card: SavedTplCard) => {
    e.stopPropagation();
    setDeleteTarget(card);
    setDeleteOpen(true);
  };
  const confirmRename = () => {
    if (!renameTarget || !renameValue.trim()) return;
    renameMutation.mutate({ id: renameTarget.id, title: renameValue.trim() });
  };
  const confirmDelete = () => {
    if (!deleteTarget) return;
    deleteMutation.mutate(deleteTarget.id);
  };

  const fileIconColor = (type: string) =>
    type === 'DOCX' ? 'bg-blue-50 text-blue-600' : type === 'PDF' ? 'bg-red-50 text-red-600' : 'bg-green-50 text-green-600';

  const ACCEPTED_EXTS = ['.docx', '.doc', '.pdf'];

  const handleUploadFilePick = (file: File) => {
    const ext = '.' + (file.name.split('.').pop() ?? '').toLowerCase();
    if (!ACCEPTED_EXTS.includes(ext)) {
      pushToast?.(t('generatorV1.savedTemplates.toast.uploadBadExt'), 'error', 2500);
      return;
    }
    setUploadFile(file);
    setUploadState('idle');
  };

  const handleUploadConfirm = async () => {
    if (!uploadFile) return;
    const controller = new AbortController();
    uploadAbortRef.current = controller;
    try {
      // Step 1: Upload file lên server
      setUploadState('uploading');
      const formData = new FormData();
      formData.append('files', uploadFile);
      const uploaded = await documentsApi.upload(formData, { signal: controller.signal });

      const docId = Array.isArray(uploaded) ? uploaded[0]?.id : (uploaded as any)?.id;
      if (!docId) throw new Error('Upload failed');

      // Step 2: AI extract → tạo template mới
      setUploadState('converting');
      const result = await generatorDocToTemplateApi.convert(
        { document_id: docId, title: uploadFile.name.replace(/\.[^.]+$/, '') },
        { signal: controller.signal }
      );

      setUploadState('done');

      const card: SavedTplCard = {
        id: result.template_id,
        name: result.title,
        tag: 'Template',
        description: `Template từ file: ${uploadFile.name}`,
        type: 'Sales Contract',
        folder: '',
        updatedAt: new Date().toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' }),
      };
      setExtraCards(prev => [card, ...prev]);
      queryClient.invalidateQueries({ queryKey: ['generator-templates'] });
      const _detected = result.detected_count ?? result.field_count;
      pushToast?.(t('generatorV1.savedTemplates.toast.templateCreated', { field_count: result.field_count, detected: _detected }), 'success', 2600);

      setTimeout(() => {
        closeKhoModal();
        onPick(card);
      }, 800);
    } catch (err: any) {
      if (err?.code === 'ERR_CANCELED' || err?.name === 'CanceledError' || err?.name === 'AbortError') {
        pushToast?.(t('generatorV1.savedTemplates.toast.uploadCanceled'), 'info', 2000);
        return;
      }
      setUploadState('idle');
      pushToast?.(t('generatorV1.savedTemplates.toast.processFail'), 'error', 2500);
    } finally {
      uploadAbortRef.current = null;
    }
  };

  // ── Library view ──────────────────────────────────────────────────────────────
  return (
    <div className="h-full min-h-0 flex flex-col">
      {/* Sticky header */}
      <div className="flex-shrink-0 px-8 pt-8 pb-4 max-w-6xl w-full mx-auto">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-foreground">{t('generatorV1.savedTemplates.panelTitle')}</h2>
            <p className="text-xs text-muted-foreground mt-1">{t('generatorV1.savedTemplates.panelSubtitle')}</p>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative w-56">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input value={search} onChange={e => setSearch(e.target.value)} placeholder={t('generatorV1.savedTemplates.searchPlaceholder')} className="pl-8 h-8 text-xs" />
            </div>
            <Button size="sm" className="h-8 gap-1.5 text-xs" onClick={() => setKhoTriThucOpen(true)}>
              <Upload className="w-3.5 h-3.5" />{t('generatorV1.savedTemplates.uploadBtn')}
            </Button>
          </div>
        </div>
      </div>

      {/* Scrollable grid */}
      <div className="flex-1 min-h-0 overflow-y-auto px-8 pb-8">
        <div className="max-w-6xl mx-auto">
      {templatesLoading ? (
        <div className="flex items-center justify-center py-20 gap-2 text-muted-foreground">
          <Loader2 className="w-5 h-5 animate-spin" /><span className="text-sm">{t('generatorV1.savedTemplates.loadingTemplates')}</span>
        </div>
      ) : filtered.length === 0 ? (
        <div className="border-2 border-dashed border-border rounded-xl py-16 flex flex-col items-center gap-2">
          <FileText className="w-7 h-7 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">{search ? t('generatorV1.savedTemplates.emptySearch') : t('generatorV1.savedTemplates.emptyAll')}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 pt-2">
          {filtered.map(c => (
            <motion.div
              key={c.id}
              whileHover={{ y: -2 }}
              className="relative p-4 rounded-xl border border-border bg-card hover:border-primary/50 hover:shadow-sm transition-all flex flex-col gap-3 group cursor-pointer"
              onClick={() => handleOpenCard(c)}
            >
              {/* Header row: icon + action menu */}
              <div className="flex items-start justify-between">
                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <FileText className="w-5 h-5 text-primary" />
                </div>
                {/* ··· menu — only for backend templates (UUID ids) */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      onClick={e => e.stopPropagation()}
                      className="opacity-0 group-hover:opacity-100 data-[state=open]:opacity-100 p-1.5 rounded-lg hover:bg-muted transition-opacity flex-shrink-0"
                      aria-label={t('generatorV1.savedTemplates.cardOptionsAriaLabel')}
                    >
                      <MoreHorizontal className="w-4 h-4 text-muted-foreground" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-40" onClick={e => e.stopPropagation()}>
                    <DropdownMenuItem className="text-xs gap-2" onClick={e => openRename(e, c)}>
                      <Pencil className="w-3.5 h-3.5" />{t('generatorV1.savedTemplates.cardRenameItem')}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      className="text-xs gap-2 text-destructive focus:text-destructive"
                      onClick={e => openDelete(e, c)}
                    >
                      <Trash2 className="w-3.5 h-3.5" />{t('generatorV1.savedTemplates.cardDeleteItem')}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>

              {/* Name + date */}
              <div className="flex-1">
                <p className="text-sm font-semibold text-foreground">{c.name}</p>
                {c.updatedAt && (
                  <p className="text-[10px] text-muted-foreground mt-1 flex items-center gap-1">
                    <Clock className="w-2.5 h-2.5" />{t('generatorV1.savedTemplates.cardUpdatedAt', { date: c.updatedAt })}
                  </p>
                )}
              </div>

              {/* Hover CTA */}
              <div className="flex items-center gap-1 text-xs font-medium text-primary opacity-0 group-hover:opacity-100 transition-opacity">
                {t('generatorV1.savedTemplates.cardUseCta')} <ChevronRight className="w-3 h-3" />
              </div>
            </motion.div>
          ))}
        </div>
      )}
        </div>
      </div>

      {/* ── Kho Tri Thuc File Picker Modal (Document Review style) ── */}
      <Dialog open={khoTriThucOpen} onOpenChange={o => { if (!o) closeKhoModal(); }}>
        <DialogContent className="max-w-2xl p-0 gap-0 flex flex-col overflow-hidden" style={{ maxHeight: '82vh' }}>
          {/* Header */}
          <div className="px-6 pt-5 pb-4 border-b border-border flex-shrink-0">
            <h2 className="text-base font-semibold text-foreground">{t('generatorV1.savedTemplates.khoModalTitle')}</h2>
          </div>

          {/* Search bar */}
          <div className="px-6 py-3 border-b border-border flex-shrink-0">
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={khoSearch}
                onChange={e => setKhoSearch(e.target.value)}
                placeholder={t('generatorV1.savedTemplates.khoSearchPlaceholder')}
                className="pl-10 h-10 text-sm border-primary/40 focus-visible:ring-primary/50"
                autoFocus
              />
            </div>
          </div>

          {/* Tab bar */}
          <div className="px-6 py-2.5 border-b border-border flex-shrink-0 flex items-center gap-1.5">
            {([
              { id: 'recent' as const, labelKey: 'generatorV1.savedTemplates.khoTabRecent', icon: Clock },
              { id: 'mine' as const, labelKey: 'generatorV1.savedTemplates.khoTabMine', icon: Package },
              { id: 'shared' as const, labelKey: 'generatorV1.savedTemplates.khoTabShared', icon: Send },
              { id: 'upload' as const, labelKey: 'generatorV1.savedTemplates.khoTabUpload', icon: Upload },
            ] as { id: KhoTriThucFileTab | 'upload'; labelKey: string; icon: typeof Clock }[]).map(tab => {
              const Icon = tab.icon;
              const active = khoTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setKhoTab(tab.id)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                    active ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />{t(tab.labelKey)}
                </button>
              );
            })}
          </div>

          {/* File list / Upload zone */}
          <div className="flex-1 overflow-y-auto px-6 py-3 space-y-0.5 min-h-0">
            {khoTab === 'upload' ? (
              <div className="flex flex-col items-center py-6 gap-4">
                {/* Hidden file input */}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".docx,.doc,.pdf"
                  className="hidden"
                  onChange={e => { const f = e.target.files?.[0]; if (f) handleUploadFilePick(f); e.target.value = ''; }}
                />

                {uploadFile ? (
                  /* File đã chọn — preview + progress */
                  <div className="w-full space-y-3">
                    {/* File card */}
                    <div className="border border-border rounded-xl p-4 flex items-center gap-3 bg-muted/30">
                      <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center flex-shrink-0">
                        {uploadState === 'uploading' || uploadState === 'converting'
                          ? <Loader2 className="w-5 h-5 text-blue-600 animate-spin" />
                          : uploadState === 'done'
                            ? <CheckCircle2 className="w-5 h-5 text-green-500" />
                            : <FileText className="w-5 h-5 text-blue-600" />
                        }
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">{uploadFile.name}</p>
                        <p className="text-xs text-muted-foreground">{(uploadFile.size / 1024).toFixed(0)} KB</p>
                      </div>
                      {uploadState === 'idle' && (
                        <button onClick={() => { setUploadFile(null); setUploadState('idle'); }} className="text-xs text-muted-foreground hover:text-foreground">✕</button>
                      )}
                    </div>

                    {/* Progress area — chỉ hiện khi đang xử lý */}
                    {(uploadState === 'uploading' || uploadState === 'converting') && (
                      <div className="border border-border rounded-xl p-4 space-y-3 bg-background">
                        {/* Steps */}
                        <div className="flex items-center gap-0">
                          {[
                            { labelKey: 'generatorV1.savedTemplates.uploadStepUpload', done: uploadState === 'converting' || uploadState === 'done', active: uploadState === 'uploading' },
                            { labelKey: 'generatorV1.savedTemplates.uploadStepAnalyze', done: uploadState === 'done', active: uploadState === 'converting' },
                            { labelKey: 'generatorV1.savedTemplates.uploadStepDone', done: uploadState === 'done', active: false },
                          ].map((step, i) => (
                            <div key={step.labelKey} className="flex items-center flex-1 last:flex-none">
                              <div className="flex items-center gap-1.5">
                                <div className={`w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 text-[10px] font-bold transition-colors ${
                                  step.done ? 'bg-green-500 text-white' : step.active ? 'bg-primary text-white' : 'bg-muted text-muted-foreground'
                                }`}>
                                  {step.done ? '✓' : i + 1}
                                </div>
                                <span className={`text-xs font-medium ${step.active ? 'text-foreground' : step.done ? 'text-green-600' : 'text-muted-foreground'}`}>
                                  {t(step.labelKey)}
                                </span>
                              </div>
                              {i < 2 && <div className={`flex-1 h-px mx-2 ${step.done ? 'bg-green-400' : 'bg-border'}`} />}
                            </div>
                          ))}
                        </div>

                        {/* Progress bar */}
                        <div className="space-y-1.5">
                          <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
                            <motion.div
                              className="h-full bg-primary rounded-full"
                              initial={{ width: 0 }}
                              animate={{ width: `${uploadProgress}%` }}
                              transition={{ duration: 0.5, ease: 'linear' }}
                            />
                          </div>
                          <div className="flex items-center justify-between">
                            <p className="text-xs text-muted-foreground">
                              {uploadState === 'uploading' ? t('generatorV1.savedTemplates.uploadProgressUpload') : t('generatorV1.savedTemplates.uploadProgressAnalyze')}
                            </p>
                            <p className="text-xs text-muted-foreground tabular-nums">
                              ~{Math.ceil(uploadSecondsLeft)}s
                            </p>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Done state */}
                    {uploadState === 'done' && (
                      <div className="flex items-center gap-2 text-green-600 text-sm font-medium px-1">
                        <CheckCircle2 className="w-4 h-4" />{t('generatorV1.savedTemplates.uploadDoneMsg')}
                      </div>
                    )}
                  </div>
                ) : (
                  /* Drop zone */
                  <div
                    onDragOver={e => { e.preventDefault(); setUploadDragging(true); }}
                    onDragLeave={() => setUploadDragging(false)}
                    onDrop={e => {
                      e.preventDefault();
                      setUploadDragging(false);
                      const f = e.dataTransfer.files[0];
                      if (f) handleUploadFilePick(f);
                    }}
                    className={`w-full border-2 border-dashed rounded-xl py-10 flex flex-col items-center gap-3 transition-colors cursor-pointer ${
                      uploadDragging ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50 hover:bg-muted/30'
                    }`}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <Upload className={`w-8 h-8 ${uploadDragging ? 'text-primary' : 'text-muted-foreground'}`} />
                    <div className="text-center">
                      <p className="text-sm font-medium text-foreground">{t('generatorV1.savedTemplates.uploadDropTitle')}</p>
                      <p className="text-xs text-muted-foreground mt-1">{t('generatorV1.savedTemplates.uploadDropOr')} <span className="text-primary underline underline-offset-2">{t('generatorV1.savedTemplates.uploadDropBrowse')}</span></p>
                    </div>
                    <p className="text-[11px] text-muted-foreground">{t('generatorV1.savedTemplates.uploadFormats')}</p>
                  </div>
                )}

              </div>
            ) : khoLoading ? (
              <div className="flex items-center justify-center py-12 gap-2 text-muted-foreground">
                <Loader2 className="w-5 h-5 animate-spin" /><span className="text-sm">{t('generatorV1.savedTemplates.khoLoading')}</span>
              </div>
            ) : khoFiltered.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 gap-2 text-muted-foreground">
                <FileSearch className="w-8 h-8 opacity-30" />
                <p className="text-sm">{t('generatorV1.savedTemplates.khoEmpty')}</p>
              </div>
            ) : khoFiltered.map(f => {
              const ext = (f.extension ?? '').toUpperCase();
              const displayName = f.title || f.original_filename || 'Untitled';
              const isSelected = khoSelected.has(f.id);
              const iconCls = fileIconColor(ext);
              return (
                <div
                  key={f.id}
                  onClick={() => toggleKhoFile(f.id)}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors ${
                    isSelected
                      ? 'bg-primary/8 border border-primary/25'
                      : 'hover:bg-muted/40 border border-transparent'
                  }`}
                >
                  <div className={`w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0 transition-all ${
                    isSelected ? 'bg-primary border-primary' : 'border-muted-foreground/30 bg-background'
                  }`}>
                    {isSelected && (
                      <svg width="9" height="7" viewBox="0 0 9 7" fill="none">
                        <path d="M1 3.5L3 5.5L8 1" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </div>
                  <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${iconCls.split(' ')[0]}`}>
                    <FileText className={`w-4 h-4 ${iconCls.split(' ')[1]}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{displayName}</p>
                    <p className="text-xs text-muted-foreground">{ext}{f.file_size ? ` · ${(f.file_size / 1024).toFixed(0)} KB` : ''}</p>
                  </div>
                  <p className="text-xs text-muted-foreground flex-shrink-0">
                    {f.created_at ? fmtDate(parseISO(f.created_at), 'dd/MM/yyyy') : ''}
                  </p>
                </div>
              );
            })}
          </div>

          {/* Footer */}
          <div className="px-6 py-4 border-t border-border flex-shrink-0 flex items-center justify-between bg-card">
            <span className="text-sm text-muted-foreground">
              {t('generatorV1.savedTemplates.khoFooterSelected', { count: khoTab === 'upload' ? (uploadFile ? 1 : 0) : khoSelected.size })}
            </span>
            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={closeKhoModal}>{t('generatorV1.savedTemplates.khoFooterCancelBtn')}</Button>
              {khoTab === 'upload' ? (
                <Button
                  onClick={handleUploadConfirm}
                  disabled={!uploadFile || uploadState !== 'idle'}
                  className="gap-2 min-w-[96px]"
                >
                  {uploadState === 'uploading' && <><Loader2 className="w-4 h-4 animate-spin" />{t('generatorV1.savedTemplates.khoUploadingBtn')}</>}
                  {uploadState === 'converting' && <><Loader2 className="w-4 h-4 animate-spin" />{t('generatorV1.savedTemplates.khoAnalyzingBtn')}</>}
                  {uploadState === 'idle' && <><Upload className="w-4 h-4" />{t('generatorV1.savedTemplates.khoSelectFileBtn')}</>}
                </Button>
              ) : (
                <Button
                  onClick={handleConfirmKhoSelection}
                  disabled={khoSelected.size === 0 || khoSelecting}
                  className="gap-2 min-w-[96px]"
                >
                  {khoSelecting ? <><Loader2 className="w-4 h-4 animate-spin" />{t('generatorV1.savedTemplates.khoProcessingBtn')}</> : t('generatorV1.savedTemplates.khoSelectFileBtn')}
                </Button>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Rename Template Dialog ── */}
      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent className="max-w-sm" onClick={e => e.stopPropagation()}>
          <DialogHeader>
            <DialogTitle>{t('generatorV1.savedTemplates.renameModalTitle')}</DialogTitle>
            <DialogDescription className="text-xs">{t('generatorV1.savedTemplates.renameModalDesc')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">{t('generatorV1.savedTemplates.renameNameLabel')}</Label>
            <Input
              autoFocus
              value={renameValue}
              onChange={e => setRenameValue(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') confirmRename(); }}
              className="text-sm"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameOpen(false)}>{t('generatorV1.savedTemplates.renameCancelBtn')}</Button>
            <Button
              onClick={confirmRename}
              disabled={!renameValue.trim() || renameMutation.isPending}
              className="gap-1.5"
            >
              {renameMutation.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {t('generatorV1.savedTemplates.renameSaveBtn')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete Template Dialog ── */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="max-w-sm" onClick={e => e.stopPropagation()}>
          <DialogHeader>
            <DialogTitle>{t('generatorV1.savedTemplates.deleteModalTitle')}</DialogTitle>
            <DialogDescription asChild>
              <div className="text-xs text-gray-500 space-y-1.5">
                <p>{t('generatorV1.savedTemplates.deleteModalDesc', { name: deleteTarget?.name })}</p>
                {draftSessionCount > 0 && (
                  <p className="rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-amber-800">
                    {t('generatorV1.savedTemplates.deleteModalDraftWarning_before')}{' '}
                    <span className="font-semibold">{draftSessionCount} {t('generatorV1.savedTemplates.deleteModalDraftWarning_count')}</span>{' '}
                    {t('generatorV1.savedTemplates.deleteModalDraftWarning_after')}
                  </p>
                )}
              </div>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>{t('generatorV1.savedTemplates.deleteCancelBtn')}</Button>
            <Button
              variant="destructive"
              onClick={confirmDelete}
              disabled={deleteMutation.isPending}
              className="gap-1.5"
            >
              {deleteMutation.isPending
                ? <><Loader2 className="w-3.5 h-3.5 animate-spin" />{t('generatorV1.savedTemplates.deletingBtn')}</>
                : <><Trash2 className="w-3.5 h-3.5" />{t('generatorV1.savedTemplates.deleteConfirmBtn')}</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
