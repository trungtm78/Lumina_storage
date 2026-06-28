// @ts-nocheck
import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { diffWords } from 'diff';
import { format as fmtDate } from 'date-fns';
import { motion, AnimatePresence } from 'motion/react';
import {
  FileText, Loader2, Sparkles, Pencil, Save, Check, X, Plus,
  AlertCircle, RotateCcw, History as HistoryIcon, Upload,
  FileDown, FolderOpen, MoreHorizontal, Trash2, CheckCircle2,
} from 'lucide-react';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/app/components/ui/dropdown-menu';
import { Button } from '@/app/components/ui/button';
import { Input } from '@/app/components/ui/input';
import { Label } from '@/app/components/ui/label';
import { Textarea } from '@/app/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/app/components/ui/select';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/app/components/ui/dialog';
import type { Step2Props, PlaceholderField, AiDiffSuggestion, BlockOpSuggestion, MockVersion, Step2Tab, Step2FillMode } from './types';
import { FIELDS_BY_TYPE, PLACEHOLDER_FIELDS } from './constants';
import { applyPlaceholders, generateDraftV1 } from './utils';
import { generatorApi, generatorSessionsApi, generatorSessionVersionsApi, generatorAiReviseApi } from '@/app/api/endpoints/generator';
import type { BlockEditOp } from '@/app/api/endpoints/generator';
import { templatesApi } from '@/app/api/endpoints/templates';
import { reviewApi } from '@/app/api/endpoints/review';
import { DocPreview, HighlightedDocPreview, InsertModePreview, DiffPreview, DocxFormattedPreview, useDocxHtml } from './DocPreview';
import { InlineDiffDocument } from './InlineDiffDocument';
import { TipTapDocxEditor } from './TipTapDocxEditor';

export function Step2({ docType, templateId, versions, onVersionsChange, onApproveDraft, initialPrefill, pushToast, editMode, initialContent, onSave, folders, onFinalize, customParams, baseTemplate, onFieldsChange, sessionId, onSessionCreated, triggerHighlightEmpty }: Step2Props) {
  const { t } = useTranslation();

  // Phase B — fetch real template fields when templateId provided
  const { data: templateData } = useQuery({
    queryKey: ['template-fields', templateId],
    queryFn: () => templatesApi.get(templateId!),
    enabled: !!templateId && !customParams,
    staleTime: 60_000,
  });

  // Lấy NỘI DUNG GỐC đầy đủ của template (text có chứa các {placeholder}) để
  // preview hiển thị đúng tài liệu thật + highlight field tại đúng vị trí.
  const { data: templateTextData } = useQuery({
    queryKey: ['template-text', templateId],
    queryFn: () => reviewApi.getDocumentText(templateId!),
    enabled: !!templateId && !customParams,
    staleTime: 60_000,
  });

  const buildInitFields = (type, prefill?: Record<string, string>): PlaceholderField[] => {
    if (customParams) {
      return customParams.map(p => ({ key: p.key, label: p.label, value: prefill?.[p.key] ?? '' }));
    }
    if (templateData?.template_fields?.length) {
      return templateData.template_fields.map(f => ({
        key: f.placeholder.replace(/[{}]/g, ''),
        label: f.label,
        value: prefill?.[f.placeholder.replace(/[{}]/g, '')] ?? '',
      }));
    }
    return (FIELDS_BY_TYPE[type] ?? PLACEHOLDER_FIELDS).map(f => ({
      ...f,
      value: prefill && prefill[f.key] !== undefined ? prefill[f.key] : '',
    }));
  };

  const [fields, setFields] = useState<PlaceholderField[]>(buildInitFields(docType, initialPrefill));
  const [autoFilledKeys, setAutoFilledKeys] = useState<Set<string>>(
    new Set(initialPrefill ? Object.keys(initialPrefill) : [])
  );
  const [emptyFieldKeys, setEmptyFieldKeys] = useState<Set<string>>(new Set());
  const [tab, setTab] = useState<Step2Tab>('edit');

  // Khi page (exit dialog flow) yêu cầu highlight empty fields
  useEffect(() => {
    if (!triggerHighlightEmpty) return;
    const emptyFields = fields.filter(f => !(f.value ?? '').trim());
    if (emptyFields.length > 0) {
      setEmptyFieldKeys(new Set(emptyFields.map(f => f.key)));
      setTab('edit');
      setFillMode('manual');
    }
  }, [triggerHighlightEmpty]);
  const [generating, setGenerating] = useState(false);
  const [hasDraft, setHasDraft] = useState(versions.length > 0 || !!initialPrefill || !!editMode || !!baseTemplate);
  const [baseDraft, setBaseDraft] = useState<string>(
    editMode && initialContent
      ? initialContent
      : baseTemplate
      ? baseTemplate
      : versions[0]?.content ?? (initialPrefill ? generateDraftV1(docType, '') : '')
  );
  const [aiInstruction, setAiInstruction] = useState('');
  // Param CRUD (when customParams provided)
  const [newParamLabel, setNewParamLabel] = useState('');
  const [pendingParam, setPendingParam] = useState<{ label: string; key: string } | null>(null);
  const [userAddedKeys, setUserAddedKeys] = useState<Set<string>>(new Set());
  const [aiSuggestions, setAiSuggestions] = useState<AiDiffSuggestion[]>([]);
  const [generatingDiff, setGeneratingDiff] = useState(false);
  const [aiInstructionError, setAiInstructionError] = useState('');
  // ── AI đề xuất block-based (mức a, chạy trên HTML) ──────────────────────────
  const [blockOps, setBlockOps] = useState<BlockOpSuggestion[]>([]);
  const [reviseWarnings, setReviseWarnings] = useState<string[]>([]);
  const [reviseSourceHtml, setReviseSourceHtml] = useState<string>('');  // HTML gốc lúc đề xuất (dùng cho apply)
  const [diffHtml, setDiffHtml] = useState<string>('');                  // nguyên tài liệu + diff inline
  const [applyingRevise, setApplyingRevise] = useState(false);

  // (saveAsTemplate removed — use Create Document flow directly)

  // Export popup (Create Document)
  const [exportOpen, setExportOpen] = useState(false);
  const [confirmSkipOpen, setConfirmSkipOpen] = useState(false);
  const [skipFieldValidation, setSkipFieldValidation] = useState(false);
  const [exportFormat, setExportFormat] = useState<'PDF' | 'DOCX' | 'Excel'>('PDF');
  const [exportFolderId, setExportFolderId] = useState<string>(folders?.[0]?.id ?? '__none__');
  useEffect(() => {
    if (folders && folders.length && exportFolderId !== '__none__' && !folders.find(f => f.id === exportFolderId)) {
      setExportFolderId(folders[0].id);
    }
  }, [folders, exportFolderId]);

  // Fill mode (Điền tay / AI trích xuất)
  const [fillMode, setFillMode] = useState<Step2FillMode>('manual');
  const [aiExtractTab, setAiExtractTab] = useState<'paste' | 'upload'>('paste');
  const [aiExtractText, setAiExtractText] = useState('');
  const [aiExtractFile, setAiExtractFile] = useState<File | null>(null);
  const [aiExtractAnalyzing, setAiExtractAnalyzing] = useState(false);
  const [aiExtractBanner, setAiExtractBanner] = useState<{ found: number; total: number; missing: string[] } | null>(null);
  const aiExtractFileRef = useRef<HTMLInputElement>(null);

  // Preview direct-edit mode
  const [previewEditMode, setPreviewEditMode] = useState(false);
  const [previewEditContent, setPreviewEditContent] = useState('');

  const handleSavePreviewEdit = () => {
    setBaseDraft(previewEditContent || baseDraft);
    setPreviewEditMode(false);
    pushToast?.(t('generatorV1.step2.toast.savedEdit'), 'success', 2000);
  };

  // ── Phase 2: chỉnh sửa WYSIWYG (TipTap) + versioning ─────────────────────
  // HTML gốc của template (mammoth) — seed cho editor + view khi chưa sửa tay.
  const templateMammoth = useDocxHtml(templateId && !customParams ? templateId : null);
  const [editedHtml, setEditedHtml] = useState<string | null>(null);  // nội dung sửa tay đang làm việc
  const [editorSeed, setEditorSeed] = useState<string>('');           // seed mở editor (cố định trong lúc sửa)
  const [activeVersionId, setActiveVersionId] = useState<string | null>(null);
  const [localSessionId, setLocalSessionId] = useState<string | null>(sessionId ?? null);
  const [savingVersion, setSavingVersion] = useState(false);
  useEffect(() => { setLocalSessionId(sessionId ?? null); }, [sessionId]);

  // Danh sách version THẬT (khi đã có session)
  const { data: versionsData, refetch: refetchVersions } = useQuery({
    queryKey: ['gen-session-versions', localSessionId],
    queryFn: () => generatorSessionVersionsApi.list(localSessionId!),
    enabled: !!localSessionId,
    staleTime: 10_000,
  });
  const sessionVersions = versionsData?.items ?? [];

  // Tạo session nếu chưa có (cần cho lưu version / generate từ bản sửa)
  const ensureSession = async (): Promise<string> => {
    if (localSessionId) return localSessionId;
    const fv = Object.fromEntries(fields.map(f => [f.key, f.value]));
    const s = await generatorSessionsApi.create({
      template_id: templateId ?? undefined,
      doc_type: docType,
      field_values: fv,
      title: templateData?.title || t(`generatorV1.docType.${docType}.label`, { defaultValue: docType }),
    });
    setLocalSessionId(s.id);
    onSessionCreated?.(s.id);
    return s.id;
  };

  // Mở editor sửa tay: seed = bản đã sửa (nếu có) hoặc HTML gốc từ template
  const openManualEdit = () => {
    const seed = editedHtml ?? templateMammoth.html ?? '';
    if (!seed) {
      pushToast?.(t('generatorV1.step2.toast.loadingContent'), 'info', 2000);
      return;
    }
    setEditorSeed(seed);
    setPreviewEditMode(true);
  };

  // Lưu bản sửa tay → tạo VERSION + cập nhật nội dung đang làm việc
  const handleSaveManualEdit = async () => {
    const html = editedHtml ?? editorSeed;
    if (!html) { setPreviewEditMode(false); return; }
    setSavingVersion(true);
    try {
      const sid = await ensureSession();
      // Tạo VERSION MỚI (kèm snapshot "Bản gốc" nếu là lần đầu) — không ghi đè.
      const ver = await saveEditedAsNewVersion(sid, originalTemplateHtml || editorSeed, html);
      setActiveVersionId(ver.id);
      setEditedHtml(html);
      await refetchVersions();
      pushToast?.(t('generatorV1.step2.toast.savedVersion', { label: ver.label ?? t('generatorV1.step2.internalVersionLabelOriginal') }), 'success', 2200);
      setPreviewEditMode(false);
    } catch {
      pushToast?.(t('generatorV1.step2.toast.saveVersionFail'), 'info', 2400);
    } finally {
      setSavingVersion(false);
    }
  };

  // Chọn 1 version → nạp làm nội dung đang preview/sửa (version = template đang preview)
  const handleSelectVersion = (v: any) => {
    setEditedHtml(v.edited_html);
    setActiveVersionId(v.id);
    if (v.field_values) {
      setFields(prev => prev.map(f => ({ ...f, value: v.field_values[f.key] ?? f.value })));
    }
    setTab('edit');
    pushToast?.(t('generatorV1.step2.toast.usingVersion', { label: v.label ?? 'V' + v.version_no }), 'info', 1800);
  };

  // CRUD version: đổi tên / xoá
  const [renameVerTarget, setRenameVerTarget] = useState<any>(null);
  const [renameVerValue, setRenameVerValue] = useState('');
  const [deleteVerTarget, setDeleteVerTarget] = useState<any>(null);
  const [verActionBusy, setVerActionBusy] = useState(false);

  const handleRenameVersion = async () => {
    if (!localSessionId || !renameVerTarget || !renameVerValue.trim()) return;
    setVerActionBusy(true);
    try {
      await generatorSessionVersionsApi.update(localSessionId, renameVerTarget.id, { label: renameVerValue.trim() });
      await refetchVersions();
      setRenameVerTarget(null);
      pushToast?.(t('generatorV1.step2.toast.renamedVersion'), 'success', 1800);
    } catch {
      pushToast?.(t('generatorV1.step2.toast.renameFail'), 'info', 2200);
    } finally {
      setVerActionBusy(false);
    }
  };

  const handleDeleteVersion = async () => {
    if (!localSessionId || !deleteVerTarget) return;
    setVerActionBusy(true);
    try {
      await generatorSessionVersionsApi.delete(localSessionId, deleteVerTarget.id);
      // Nếu xoá version đang dùng → bỏ tham chiếu active (giữ nội dung đang làm việc)
      if (activeVersionId === deleteVerTarget.id) setActiveVersionId(null);
      await refetchVersions();
      setDeleteVerTarget(null);
      pushToast?.(t('generatorV1.step2.toast.deletedVersion'), 'success', 1800);
    } catch {
      pushToast?.(t('generatorV1.step2.toast.deleteFail'), 'info', 2200);
    } finally {
      setVerActionBusy(false);
    }
  };

  // Versions (mock)
  const [versionList, setVersionList] = useState<MockVersion[]>([]);
  const [currentVersionId, setCurrentVersionId] = useState<string | null>(null);
  const [viewingVersionId, setViewingVersionId] = useState<string | null>(null);

  // Reset on doc type / prefill / edit / template change
  useEffect(() => {
    setFields(buildInitFields(docType, initialPrefill));
    setAutoFilledKeys(new Set(initialPrefill ? Object.keys(initialPrefill) : []));
    setAiInstruction('');
    setNewParamLabel('');
    if (editMode && initialContent) {
      setBaseDraft(initialContent);
      setHasDraft(true);
    } else if (baseTemplate) {
      setBaseDraft(baseTemplate);
      setHasDraft(true);
    } else if (initialPrefill && !templateId) {
      // Chỉ dùng draft mock khi KHÔNG có template thật (fallback theo loại tài liệu).
      // Có templateId → nội dung gốc sẽ được nạp từ document-text (effect bên dưới).
      setBaseDraft(generateDraftV1(docType, ''));
      setHasDraft(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docType, initialPrefill, editMode, initialContent, baseTemplate, customParams]);

  // Live preview: substitute placeholders into the base draft when present
  const livePreview = hasDraft ? applyPlaceholders(baseDraft, fields) : '';
  const viewingVersion = viewingVersionId ? versionList.find(v => v.id === viewingVersionId) : null;
  const previewContent = viewingVersion ? viewingVersion.content : livePreview;

  // Phase B — rebuild fields + đặt baseDraft = NỘI DUNG GỐC template
  // Ưu tiên text thật (document-text) → preview là tài liệu thật với field tại
  // đúng vị trí. Chỉ áp dụng MỘT LẦN mỗi template để không đè lên chỉnh sửa tay/AI.
  const realDraftAppliedFor = useRef<string | null>(null);
  useEffect(() => {
    if (customParams || editMode) return;

    // Cập nhật danh sách field khi có template
    if (templateData?.template_fields?.length) {
      setFields(buildInitFields(docType, initialPrefill));
    }

    const tid = templateId ?? '';
    const realText = templateTextData?.text?.trim();

    if (realText && realDraftAppliedFor.current !== tid) {
      // Nội dung gốc đầy đủ (có {placeholder}) — nguồn chuẩn cho preview
      realDraftAppliedFor.current = tid;
      setBaseDraft(realText);
      setHasDraft(true);
    } else if (!hasDraft && !templateTextData && templateData?.template_fields?.length) {
      // Chưa lấy được text gốc → tạm hiện danh sách field để không trống
      const newFields = buildInitFields(docType, initialPrefill);
      const lines: string[] = [templateData.title, '', ...newFields.map(f => `${f.label}: {${f.key}}`)];
      setBaseDraft(lines.join('\n'));
      setHasDraft(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templateData, templateTextData, templateId]);

  // Emit field values to parent whenever they change (for generate/session APIs)
  useEffect(() => {
    onFieldsChange?.(Object.fromEntries(fields.map(f => [f.key, f.value])));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fields]);

  // Keep parent in sync
  useEffect(() => {
    if (!hasDraft) return;
    onVersionsChange([{ version: 1, label: 'V1', content: livePreview }]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [livePreview, hasDraft]);

  // Seed V1 when draft first appears (real timestamp, no fake data)
  useEffect(() => {
    if (hasDraft && versionList.length === 0) {
      const now = fmtDate(new Date(), 'dd/MM/yyyy HH:mm');
      const seed: MockVersion = { id: 'v1', label: 'V1', time: now, content: livePreview };
      setVersionList([seed]);
      setCurrentVersionId('v1');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasDraft]);

  const updateField = (key: string, value: string) => {
    setFields(prev => prev.map(f => f.key === key ? { ...f, value } : f));
    setAutoFilledKeys(prev => {
      if (!prev.has(key)) return prev;
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
    if (value.trim()) {
      setEmptyFieldKeys(prev => {
        if (!prev.has(key)) return prev;
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
    setViewingVersionId(null);
  };

  const handleDeleteField = (key: string) => {
    const fieldToDelete = fields.find(f => f.key === key);
    setFields(prev => prev.filter(f => f.key !== key));
    setBaseDraft(prev => {
      if (userAddedKeys.has(key) && fieldToDelete) {
        // Remove the whole "Label: {key}" segment inserted by the user
        const escaped = fieldToDelete.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return prev.replace(new RegExp(escaped + ':\\s*\\{' + key + '\\}', 'g'), '');
      }
      return prev.replace(new RegExp(`\\{${key}\\}`, 'g'), '');
    });
    setUserAddedKeys(prev => { const n = new Set(prev); n.delete(key); return n; });
    pushToast?.(t('generatorV1.step2.toast.deletedParam'), 'success', 2000);
  };

  const handleAddField = () => {
    const label = newParamLabel.trim();
    if (!label) return;
    const key = label.toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/đ/g, 'd').replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
    if (!key || fields.some(f => f.key === key)) return;
    // Enter "choose position" mode — don't insert into fields yet
    setPendingParam({ label, key });
    setNewParamLabel('');
  };

  const handleInsertAtPosition = (pos: number) => {
    if (!pendingParam) return;
    // Insert "Label: {key}" so preview always shows the label, and value fills in after it
    const insertText = `${pendingParam.label}: {${pendingParam.key}}`;
    const newDraft = baseDraft.slice(0, pos) + insertText + baseDraft.slice(pos);
    setBaseDraft(newDraft);
    setHasDraft(true);
    setFields(prev => [...prev, { key: pendingParam.key, label: pendingParam.label, value: '' }]);
    setUserAddedKeys(prev => new Set([...prev, pendingParam.key]));
    setViewingVersionId(null);
    pushToast?.(t('generatorV1.step2.toast.addedParam', { label: pendingParam.label }), 'success', 2000);
    setPendingParam(null);
  };

  const handleCancelInsert = () => setPendingParam(null);

  // ── AI diff handlers ──────────────────────────────────────────────────────

  const handleGenerateDiff = async () => {
    if (!aiInstruction.trim()) {
      setAiInstructionError(t('generatorV1.step2.aiInstructionError'));
      return;
    }
    setAiInstructionError('');
    // Có nội dung HTML (template thật / đã sửa tay) → luồng block-based mức (a):
    // AI sửa trên tài liệu thật, kết quả thành VERSION và vào tài liệu cuối.
    if (hasHtmlSource) {
      await handleGenerateBlockRevise(htmlSource);
      return;
    }
    // Không có HTML (soạn mới từ text) → giữ luồng /revise + diff text cũ.
    setGeneratingDiff(true);
    setAiSuggestions([]);
    try {
      const result = await generatorApi.revise({
        content: baseDraft,
        instruction: aiInstruction,
        version: versionList.length + 1,
      });
      // Compute local diff between old and new content
      const changes = diffWords(baseDraft, result.content);
      const suggestions: AiDiffSuggestion[] = [];
      let i = 0;
      changes.forEach(part => {
        if (part.removed) {
          const nextPart = changes[changes.indexOf(part) + 1];
          suggestions.push({
            id: `diff-${i++}`,
            searchText: part.value,
            newText: nextPart?.added ? nextPart.value : '',
            status: 'pending',
          });
        } else if (part.added && (i === 0 || !changes[changes.indexOf(part) - 1]?.removed)) {
          suggestions.push({
            id: `diff-${i++}`,
            searchText: '',
            newText: part.value,
            status: 'pending',
          });
        }
      });
      if (suggestions.length > 0) {
        setAiSuggestions(suggestions);
      } else {
        // No diff — just apply directly
        setBaseDraft(result.content);
        setVersionList(prev => {
          const nextNum = prev.length + 1;
          const newId = `v${nextNum}`;
          setCurrentVersionId(newId);
          return [...prev, { id: newId, label: result.label || `V${nextNum}`, time: fmtDate(new Date(), 'dd/MM/yyyy HH:mm'), content: applyPlaceholders(result.content, fields) }];
        });
        pushToast?.(t('generatorV1.step2.toast.appliedAiEdit'), 'success', 2000);
      }
    } catch {
      pushToast?.(t('generatorV1.step2.toast.aiConnectFail'), 'info', 2000);
    } finally {
      setGeneratingDiff(false);
    }
  };

  const handleAcceptSuggestion = (id: string) => {
    const sugg = aiSuggestions.find(s => s.id === id);
    if (!sugg) return;
    setBaseDraft(prev => {
      const idx = prev.indexOf(sugg.searchText);
      if (idx === -1) return prev;
      return prev.slice(0, idx) + sugg.newText + prev.slice(idx + sugg.searchText.length);
    });
    setAiSuggestions(prev => prev.map(s => s.id === id ? { ...s, status: 'accepted' as const } : s));
    setViewingVersionId(null);
  };

  const handleRejectSuggestion = (id: string) => {
    setAiSuggestions(prev => prev.map(s => s.id === id ? { ...s, status: 'rejected' as const } : s));
  };

  const handleAcceptAll = () => {
    const pending = aiSuggestions.filter(s => s.status === 'pending');
    let draft = baseDraft;
    for (const s of pending) {
      const idx = draft.indexOf(s.searchText);
      if (idx !== -1) draft = draft.slice(0, idx) + s.newText + draft.slice(idx + s.searchText.length);
    }
    setBaseDraft(draft);
    setAiSuggestions(prev => prev.map(s => ({ ...s, status: s.status === 'pending' ? 'accepted' as const : s.status })));
    setViewingVersionId(null);
    setVersionList(prev => {
      const nextNum = prev.length + 1;
      const newId = `v${nextNum}`;
      setCurrentVersionId(newId);
      return [...prev, { id: newId, label: `V${nextNum}`, time: fmtDate(new Date(), 'dd/MM/yyyy HH:mm'), content: applyPlaceholders(draft, fields) }];
    });
    pushToast?.(t('generatorV1.step2.toast.acceptedAllAi'), 'success', 2500);
  };

  const handleRejectAll = () => setAiSuggestions([]);

  // ── AI đề xuất block-based (mức a) ──────────────────────────────────────────
  // Nguồn HTML đang làm việc: bản đã sửa tay > HTML gốc template (mammoth).
  const htmlSource = editedHtml ?? templateMammoth.html ?? '';
  const hasHtmlSource = !!htmlSource;
  // HTML nguyên bản của template (để snapshot "Bản gốc" lần đầu lưu version).
  const originalTemplateHtml = templateMammoth.html ?? '';

  // Lưu một bản sửa thành VERSION MỚI (KHÔNG ghi đè). Lần đầu tiên có sửa đổi:
  // tự snapshot "Bản gốc" trước để luôn quay lại được; các bản sau là "Phiên bản 1, 2, …".
  const saveEditedAsNewVersion = async (sid: string, baseHtml: string, edited: string) => {
    const fv = Object.fromEntries(fields.map(f => [f.key, f.value]));
    let items = (await generatorSessionVersionsApi.list(sid)).items;
    if (items.length === 0 && baseHtml) {
      await generatorSessionVersionsApi.create(sid, {
        edited_html: baseHtml,
        field_values: fv,
        label: t('generatorV1.step2.internalVersionLabelOriginal'),
      });
      items = [...items, { label: t('generatorV1.step2.internalVersionLabelOriginal') } as any];
    }
    const label = t('generatorV1.step2.internalVersionLabelVersion', { n: items.length || 1 });
    return generatorSessionVersionsApi.create(sid, {
      edited_html: edited,
      field_values: fv,
      label,
    });
  };

  const handleGenerateBlockRevise = async (sourceHtml: string) => {
    setGeneratingDiff(true);
    setBlockOps([]);
    setReviseWarnings([]);
    try {
      const sid = await ensureSession();
      const instructions = aiInstruction.split('\n').map(s => s.trim()).filter(Boolean);
      const res = await generatorAiReviseApi.propose(sid, { html: sourceHtml, instructions });
      if (!res.ops.length) {
        setReviseWarnings(res.warnings ?? []);
        pushToast?.(t('generatorV1.step2.toast.aiNoSuggestions'), 'info', 2200);
        return;
      }
      const sugg: BlockOpSuggestion[] = res.ops.map((o, i) => ({
        id: `op-${i}`,
        op: o.op,
        block_id: o.block_id,
        kind: o.kind,
        beforeText: o.before_text ?? '',
        afterText: o.op === 'delete' ? '' : (o.new_text ?? o.text ?? ''),
        status: 'pending' as const,
      }));
      setReviseSourceHtml(sourceHtml);
      setDiffHtml(res.diff_html ?? '');
      setBlockOps(sugg);
      setReviseWarnings(res.warnings ?? []);
    } catch {
      pushToast?.(t('generatorV1.step2.toast.aiConnectFail'), 'info', 2000);
    } finally {
      setGeneratingDiff(false);
    }
  };

  const _buildOpPayload = (s: BlockOpSuggestion): BlockEditOp => ({
    op: s.op,
    block_id: s.block_id,
    new_text: s.op === 'replace' ? s.afterText : undefined,
    text: s.op === 'insert_after' ? s.afterText : undefined,
    kind: s.kind,
  });

  // Áp dụng các op (không bị bỏ) → tạo VERSION thật → đặt làm nội dung đang làm việc.
  const applyOpsAndSaveVersion = async (ops: BlockOpSuggestion[]) => {
    if (!ops.length) {
      pushToast?.(t('generatorV1.step2.toast.noOpsToApply'), 'info', 2000);
      return;
    }
    setApplyingRevise(true);
    try {
      const sid = await ensureSession();
      const res = await generatorAiReviseApi.apply(sid, {
        html: reviseSourceHtml,
        ops: ops.map(_buildOpPayload),
      });
      // Tạo VERSION MỚI (kèm snapshot "Bản gốc" nếu là lần đầu) — không ghi đè.
      const ver = await saveEditedAsNewVersion(sid, originalTemplateHtml || reviseSourceHtml, res.revised_html);
      setEditedHtml(res.revised_html);
      setActiveVersionId(ver.id);
      await refetchVersions();
      setBlockOps([]);
      setReviseWarnings([]);
      setDiffHtml('');
      setReviseSourceHtml('');
      setAiInstruction('');
      const extra = res.warnings?.length ? ` (${res.warnings.length} ${t('generatorV1.step2.warningsSuffix')})` : '';
      pushToast?.(t('generatorV1.step2.toast.appliedAndSaved', { label: ver.label ?? t('generatorV1.step2.internalVersionLabelOriginal'), extra }), 'success', 2600);
    } catch {
      pushToast?.(t('generatorV1.step2.toast.applyFail'), 'info', 2400);
    } finally {
      setApplyingRevise(false);
    }
  };

  const handleAcceptAllBlock = () => applyOpsAndSaveVersion(blockOps.filter(s => s.status !== 'rejected'));
  const handleAcceptBlockOp = (id: string) =>
    setBlockOps(prev => prev.map(s => (s.id === id ? { ...s, status: 'accepted' as const } : s)));
  const handleRejectBlockOp = (id: string) =>
    setBlockOps(prev => prev.map(s => (s.id === id ? { ...s, status: 'rejected' as const } : s)));
  const handleRejectAllBlock = () => {
    setBlockOps([]);
    setReviseWarnings([]);
    setDiffHtml('');
    setReviseSourceHtml('');
  };

  const handleSmartSuggestion = async () => {
    try {
      const presets = await generatorApi.fieldPresets();
      const filled = new Set<string>();
      setFields(prev => prev.map(f => {
        const vals = presets[f.key] ?? presets[`{${f.key}}`];
        if (vals?.length) {
          filled.add(f.key);
          return { ...f, value: vals[0] };
        }
        return f;
      }));
      setAutoFilledKeys(filled);
      if (filled.size === 0) pushToast?.(t('generatorV1.step2.toast.noSmartSuggestions'), 'info', 2000);
    } catch {
      // ignore
    }
  };

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      // Khi có templateId, dùng tên template làm doc_type context cho AI
      const effectiveDocType = templateId && templateData?.title
        ? templateData.title
        : docType;
      const result = await generatorApi.draft({
        doc_type: effectiveDocType,
        description: aiInstruction || undefined,
      });
      setBaseDraft(result.content);
      setHasDraft(true);
      setVersionList(prev => {
        const nextNum = prev.length + 1;
        const newId = `v${nextNum}`;
        setCurrentVersionId(newId);
        return [...prev, { id: newId, label: result.label || `V${nextNum}`, time: fmtDate(new Date(), 'dd/MM/yyyy HH:mm'), content: applyPlaceholders(result.content, fields) }];
      });
    } catch {
      // fallback to local generation
      const draft = generateDraftV1(docType, aiInstruction);
      setBaseDraft(draft);
      setHasDraft(true);
      pushToast?.(t('generatorV1.step2.toast.aiDraftFallback'), 'info', 2000);
    } finally {
      setGenerating(false);
    }
  };

  const handleAiExtract2 = async () => {
    setAiExtractAnalyzing(true);
    setAiExtractBanner(null);
    try {
      let result;
      const fieldHints = fields.map(f => ({ placeholder: f.key, label: f.label }));
      if (aiExtractTab === 'paste') {
        result = await generatorApi.extractFromText({
          template_id: templateId || undefined,
          field_hints: templateId ? undefined : fieldHints,
          text: aiExtractText,
        });
      } else {
        if (!aiExtractFile) return;
        result = await generatorApi.extractFromFile({
          template_id: templateId || (fields.length > 0 ? '' : ''),
          files: [aiExtractFile],
        });
      }
      const foundKeys = new Set<string>();
      setFields(prev => prev.map(f => {
        const val = result.field_values[f.key] ?? result.field_values[`{${f.key}}`];
        if (val) { foundKeys.add(f.key); return { ...f, value: val }; }
        return f;
      }));
      // Tích lũy highlight qua nhiều lần extract, không reset lần trước
      setAutoFilledKeys(prev => new Set([...prev, ...foundKeys]));
      // Missing = chưa fill sau lần này (kể cả đã có từ lần trước)
      const missingLabels = fields.filter(f => !foundKeys.has(f.key) && !f.value).map(f => f.label);
      setAiExtractBanner({ found: foundKeys.size, total: fields.length, missing: missingLabels });
      setViewingVersionId(null);
    } catch {
      pushToast?.(t('generatorV1.step2.aiExtract.errorToast'), 'info', 2500);
    } finally {
      setAiExtractAnalyzing(false);
    }
  };

  const handleViewVersion = (v: MockVersion) => {
    setViewingVersionId(v.id);
    pushToast?.(t('generatorV1.step2.toast.viewingVersion', { label: v.label }), 'info', 1800);
  };

  const handleRestoreVersion = (v: MockVersion) => {
    setBaseDraft(v.content);
    setCurrentVersionId(v.id);
    setViewingVersionId(null);
    pushToast?.(t('generatorV1.step2.toast.restoredVersion', { label: v.label }), 'success', 2200);
  };


  const proceedToExport = () => {
    const content = hasDraft ? previewContent : applyPlaceholders(generateDraftV1(docType, aiInstruction), fields);
    if (onFinalize) {
      setExportOpen(true);
      return;
    }
    onApproveDraft(content, false, '');
  };

  const handleCreate = () => {
    const content = hasDraft ? previewContent : applyPlaceholders(generateDraftV1(docType, aiInstruction), fields);
    if (editMode && onSave) {
      onSave(content);
      return;
    }
    if (fields.length > 0) {
      const emptyFields = fields.filter(f => !(f.value ?? '').trim());
      if (emptyFields.length > 0) {
        setEmptyFieldKeys(new Set(emptyFields.map(f => f.key)));
        setTab('edit');
        setFillMode('manual');
        setConfirmSkipOpen(true);
        return;
      }
    }
    setEmptyFieldKeys(new Set());
    setSkipFieldValidation(false);
    proceedToExport();
  };

  const handleConfirmSkip = () => {
    setConfirmSkipOpen(false);
    setSkipFieldValidation(true);
    proceedToExport();
  };

  const handleConfirmExport = () => {
    const content = hasDraft ? previewContent : applyPlaceholders(generateDraftV1(docType, aiInstruction), fields);
    const fieldValues = Object.fromEntries(fields.map(f => [f.key, f.value]));
    // Có nội dung sửa tay → generate từ HTML đã sửa; kèm session đã tạo (nếu có).
    onFinalize?.(content, exportFormat, exportFolderId !== '__none__' ? exportFolderId : '', fieldValues, {
      editedHtml: editedHtml || undefined,
      sessionId: localSessionId || undefined,
      skipValidation: skipFieldValidation || undefined,
    });
    setSkipFieldValidation(false);
    setExportOpen(false);
  };

  // Tên template THẬT (từ backend) để hiển thị header — không dùng nhãn loại DOC_TYPE_VN.
  const templateName =
    (templateData?.title ?? '').replace(/\.(docx?|pdf|xlsx?|pptx?)$/i, '').trim() ||
    (docType ? t(`generatorV1.docType.${docType}.label`, { defaultValue: docType }) : t('generatorV1.step2.exportModalTitle'));

  // Guard: docType có thể null trong exit animation của AnimatePresence
  if (!docType) return null;

  return (
    <div className="flex h-full overflow-hidden">
      {/* ── LEFT: preview pane ── */}
      <div className="flex-1 flex flex-col border-r border-border min-w-0">
        <div className="px-5 py-2.5 border-b border-border bg-card flex items-center gap-3 flex-shrink-0">
          <FileText className="w-4 h-4 text-muted-foreground" />
          <span className="text-sm font-medium text-foreground">{templateName} — {t('generatorV1.step2.previewHeaderSuffix')}</span>
          {hasDraft && !previewEditMode && (
            <Button
              size="sm"
              variant="outline"
              className="ml-auto h-7 gap-1.5 text-xs"
              onClick={openManualEdit}
            >
              <Pencil className="w-3 h-3" />{t('generatorV1.step2.editManuallyBtn')}
            </Button>
          )}
          {previewEditMode && (
            <div className="ml-auto flex items-center gap-2">
              <Button
                size="sm"
                className="h-7 gap-1.5 text-xs"
                onClick={handleSaveManualEdit}
                disabled={savingVersion}
              >
                {savingVersion ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}{t('generatorV1.step2.saveVersionBtn')}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs text-muted-foreground"
                onClick={() => setPreviewEditMode(false)}
                disabled={savingVersion}
              >
                {t('generatorV1.step2.cancelBtn')}
              </Button>
            </div>
          )}
        </div>

        <div className="flex-1 min-h-0 flex flex-col">
          {generating ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-5">
              <div className="relative">
                <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center">
                  <Sparkles className="w-7 h-7 text-primary" />
                </div>
                <Loader2 className="w-5 h-5 text-primary animate-spin absolute -bottom-1 -right-1" />
              </div>
              <div className="text-center space-y-1">
                <p className="text-sm font-semibold text-foreground">{t('generatorV1.step2.generatingTitle')}</p>
                <p className="text-xs text-muted-foreground">{t('generatorV1.step2.generatingSubtitle')}</p>
              </div>
            </div>
          ) : !hasDraft ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-4 relative">
              <div className="absolute inset-0 pointer-events-none opacity-60" style={{ background: 'radial-gradient(circle at 50% 40%, hsl(var(--primary)/0.05), transparent 60%)' }} />
              <div className="w-16 h-16 rounded-2xl bg-muted flex items-center justify-center relative">
                <FileText className="w-7 h-7 text-muted-foreground" />
                <Sparkles className="w-3.5 h-3.5 text-primary absolute -top-1 -right-1" />
              </div>
              <div className="text-center space-y-1.5 relative">
                <p className="text-sm font-semibold text-foreground">{t('generatorV1.step2.emptyDraftTitle')}</p>
                <p className="text-xs text-muted-foreground max-w-xs text-center leading-relaxed">
                  {t('generatorV1.step2.emptyDraftDesc')} <span className="text-primary font-medium">{t('generatorV1.step2.emptyDraftCta')}</span> {t('generatorV1.step2.emptyDraftDescSuffix')}
                </p>
              </div>
            </div>
          ) : (
            <AnimatePresence mode="wait">
              <motion.div key="draft" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }} className="flex-1 min-h-0 flex flex-col">
                {previewEditMode ? (
                  // CHỈNH SỬA TAY: trình soạn thảo TipTap giữ định dạng Word
                  <TipTapDocxEditor initialHtml={editorSeed} onChange={setEditedHtml} />
                ) : viewingVersion ? (
                  <DocPreview content={viewingVersion.content} label={t('generatorV1.step2.versionLabelFallback', { n: viewingVersion.label })} />
                ) : pendingParam ? (
                  <InsertModePreview
                    content={baseDraft}
                    paramKey={pendingParam.key}
                    onInsert={handleInsertAtPosition}
                    onCancel={handleCancelInsert}
                  />
                ) : blockOps.length > 0 ? (
                  // AI đề xuất block-based (mức a) — diff INLINE trên nguyên tài liệu
                  <InlineDiffDocument
                    diffHtml={diffHtml}
                    suggestions={blockOps}
                    warnings={reviseWarnings}
                    applying={applyingRevise}
                    label={templateName}
                    onAccept={handleAcceptBlockOp}
                    onReject={handleRejectBlockOp}
                    onAcceptAll={handleAcceptAllBlock}
                    onRejectAll={handleRejectAllBlock}
                  />
                ) : aiSuggestions.some(s => s.status === 'pending') ? (
                  <DiffPreview
                    baseDraft={baseDraft}
                    suggestions={aiSuggestions}
                    label={`${templateName} — ${t('generatorV1.step2.previewLabelAiDiff')}`}
                    onAccept={handleAcceptSuggestion}
                    onReject={handleRejectSuggestion}
                    onAcceptAll={handleAcceptAll}
                    onRejectAll={handleRejectAll}
                  />
                ) : editedHtml ? (
                  // Đã sửa tay → preview chính nội dung đã sửa (giữ định dạng) + highlight field
                  <DocxFormattedPreview
                    html={editedHtml}
                    fields={fields}
                    label={`${templateName} — ${t('generatorV1.step2.previewLabelEdited')}`}
                  />
                ) : (templateId && !customParams) ? (
                  // Có template thật → preview GIỮ ĐỊNH DẠNG Word (mammoth) + highlight field
                  <DocxFormattedPreview
                    documentId={templateId}
                    fields={fields}
                    label={`${templateName} — ${t('generatorV1.step2.previewLabelFormatted')}`}
                  />
                ) : (
                  // Không có template (customParams) → fallback text highlight
                  <HighlightedDocPreview
                    template={baseDraft}
                    fields={fields}
                    label={`${templateName} — ${t('generatorV1.step2.previewLabelHighlight')}`}
                    userAddedKeys={userAddedKeys}
                  />
                )}
              </motion.div>
            </AnimatePresence>
          )}
        </div>
      </div>

      {/* ── RIGHT: tabbed sidebar (Chỉnh sửa / Comment / Version) ── */}
      <div className="w-[340px] flex-shrink-0 flex flex-col bg-background border-l border-border min-h-0 overflow-hidden">
        {/* Tab strip */}
        <div className="flex border-b border-border flex-shrink-0 bg-card">
          {([
            { id: 'edit',    labelKey: 'generatorV1.step2.tabEdit',    icon: Pencil },
            { id: 'version', labelKey: 'generatorV1.step2.tabVersion', icon: HistoryIcon },
          ] as { id: Step2Tab; labelKey: string; icon: typeof Pencil }[]).map(tabItem => {
            const Icon = tabItem.icon;
            const active = tab === tabItem.id;
            return (
              <button
                key={tabItem.id}
                onClick={() => setTab(tabItem.id)}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-medium border-b-2 transition-colors ${
                  active ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />{t(tabItem.labelKey)}
                {tabItem.id === 'version' && sessionVersions.length > 0 && (
                  <span className="ml-0.5 text-[9px] bg-muted text-muted-foreground rounded-full px-1.5 py-0.5">{sessionVersions.length}</span>
                )}
              </button>
            );
          })}
        </div>

        {/* Tab body */}
        {tab === 'edit' && (
          <>
            <div className="flex-1 min-h-0 overflow-y-auto">
              <div className="p-5 space-y-5">

                {/* Fill mode selector */}
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-foreground">{t('generatorV1.step2.fillModeTitle')}</p>
                  <div className="flex rounded-lg border border-border overflow-hidden">
                    <button onClick={() => { setFillMode('manual'); setAiExtractBanner(null); }} className={`flex-1 py-1 text-xs font-medium transition-colors ${fillMode === 'manual' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'}`}>{t('generatorV1.step2.fillModeManual')}</button>
                    <button onClick={() => setFillMode('ai')} className={`flex-1 py-1 text-xs font-medium transition-colors ${fillMode === 'ai' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'}`}>{t('generatorV1.step2.fillModeAi')}</button>
                  </div>
                </div>

                {/* AI extract panel */}
                {fillMode === 'ai' && (
                  <div className="space-y-3 rounded-xl border border-primary/20 bg-primary/5 p-3">
                    <div className="flex items-center gap-2">
                      <Sparkles className="w-3.5 h-3.5 text-primary flex-shrink-0" />
                      <p className="text-[11px] text-primary font-semibold">{t('generatorV1.step2.aiExtract.sourceTitle')}</p>
                    </div>
                    {/* Sub-tabs */}
                    <div className="flex rounded-md border border-border overflow-hidden bg-white">
                      <button onClick={() => setAiExtractTab('paste')} className={`flex-1 py-0.5 text-xs font-normal transition-colors ${aiExtractTab === 'paste' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'}`}>{t('generatorV1.step2.aiExtract.tabPaste')}</button>
                      <button onClick={() => setAiExtractTab('upload')} className={`flex-1 py-0.5 text-xs font-normal transition-colors ${aiExtractTab === 'upload' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'}`}>{t('generatorV1.step2.aiExtract.tabUpload')}</button>
                    </div>
                    {/* Paste tab */}
                    {aiExtractTab === 'paste' && (
                      <div className="space-y-2">
                        <Textarea
                          value={aiExtractText}
                          onChange={e => setAiExtractText(e.target.value)}
                          placeholder={t('generatorV1.step2.aiExtract.pastePlaceholder')}
                          className="text-[11px] md:text-[11px] min-h-[120px] resize-none leading-relaxed bg-white"
                          disabled={aiExtractAnalyzing}
                        />
                        <Button size="sm" className="w-full h-8 text-xs gap-1.5" onClick={handleAiExtract2} disabled={aiExtractAnalyzing || !aiExtractText.trim()}>
                          {aiExtractAnalyzing ? <><Loader2 className="w-3.5 h-3.5 animate-spin" />{t('generatorV1.step2.aiExtract.analyzing')}</> : <><Sparkles className="w-3.5 h-3.5" />{t('generatorV1.step2.aiExtract.analyzeBtn')}</>}
                        </Button>
                      </div>
                    )}
                    {/* Upload tab */}
                    {aiExtractTab === 'upload' && (
                      <div className="space-y-2">
                        <label className="block cursor-pointer">
                          <div className={`border-2 border-dashed rounded-lg p-4 text-center transition-colors ${aiExtractFile ? 'border-primary/40 bg-primary/5' : 'border-border hover:border-primary/40 bg-white'}`}>
                            {aiExtractFile ? (
                              <div className="flex items-center justify-center gap-2">
                                <FileText className="w-4 h-4 text-primary flex-shrink-0" />
                                <span className="text-xs font-medium text-primary truncate max-w-[150px]">{aiExtractFile.name}</span>
                                <button type="button" onClick={e => { e.preventDefault(); setAiExtractFile(null); }} className="text-muted-foreground hover:text-destructive flex-shrink-0"><X className="w-3.5 h-3.5" /></button>
                              </div>
                            ) : (
                              <>
                                <Upload className="w-5 h-5 text-muted-foreground mx-auto mb-1.5" />
                                <p className="text-[11px] text-foreground/75 font-medium">{t('generatorV1.step2.aiExtract.uploadHint')}</p>
                                <p className="text-[10px] text-muted-foreground mt-1">PDF, DOCX, TXT</p>
                              </>
                            )}
                          </div>
                          <input ref={aiExtractFileRef} type="file" accept=".pdf,.docx,.doc,.txt" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) setAiExtractFile(f); e.target.value = ''; }} />
                        </label>
                        <Button size="sm" className="w-full h-8 text-xs gap-1.5" onClick={handleAiExtract2} disabled={aiExtractAnalyzing || !aiExtractFile}>
                          {aiExtractAnalyzing ? <><Loader2 className="w-3.5 h-3.5 animate-spin" />{t('generatorV1.step2.aiExtract.analyzing')}</> : <><Sparkles className="w-3.5 h-3.5" />{t('generatorV1.step2.aiExtract.analyzeBtn')}</>}
                        </Button>
                      </div>
                    )}
                    {/* Result banner */}
                    {aiExtractBanner && (
                      <div className={`rounded-lg border px-3 py-2.5 space-y-1 ${aiExtractBanner.missing.length === 0 ? 'bg-emerald-50 border-emerald-200' : 'bg-amber-50 border-amber-200'}`}>
                        <div className="flex items-center gap-1.5">
                          {aiExtractBanner.missing.length === 0 ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 flex-shrink-0" /> : <AlertCircle className="w-3.5 h-3.5 text-amber-600 flex-shrink-0" />}
                          <p className={`text-[11px] font-semibold ${aiExtractBanner.missing.length === 0 ? 'text-emerald-800' : 'text-amber-800'}`}>
                            {t('generatorV1.step2.aiExtract.bannerFound', { found: aiExtractBanner.found, total: aiExtractBanner.total })}
                          </p>
                        </div>
                        {aiExtractBanner.missing.length > 0 && (
                          <p className="text-[10px] text-amber-700 leading-relaxed pl-5">
                            {t('generatorV1.step2.aiExtract.bannerMissing', { count: aiExtractBanner.missing.length, fields: aiExtractBanner.missing.join(', ') })}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* Dynamic form fields */}
                <div className="space-y-3">
                  <p className="text-xs font-semibold text-foreground">{t('generatorV1.step2.docInfoTitle')}</p>
                  <div className="space-y-2.5">
                    {fields.map(f => {
                      const isAuto = autoFilledKeys.has(f.key);
                      return (
                        <div key={f.key} className="space-y-1">
                          <label className="text-[11px] font-medium text-muted-foreground flex items-center gap-1">
                            {f.label}
                            {isAuto && <Sparkles className="w-3 h-3 text-amber-600" />}
                          </label>
                          <div className="flex items-center gap-1">
                            <Input
                              value={f.value}
                              onChange={e => updateField(f.key, e.target.value)}
                              placeholder={t('generatorV1.step2.fieldPlaceholder', { label: f.label })}
                              className={`text-xs h-8 flex-1 ${isAuto ? 'bg-amber-50 border-amber-200 focus-visible:ring-amber-300' : emptyFieldKeys.has(f.key) ? 'border-red-400 bg-red-50 focus-visible:ring-red-300' : ''}`}
                            />
                            {customParams && (
                              <button
                                onClick={() => handleDeleteField(f.key)}
                                className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-red-500 flex-shrink-0 transition-colors"
                                title={t('generatorV1.step2.deleteParamTitle')}
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  {/* Add new parameter (only in custom-param mode) */}
                  {customParams && (
                    <div className="pt-2 border-t border-border space-y-1.5">
                      <p className="text-[11px] font-medium text-muted-foreground">{t('generatorV1.step2.addNewParamTitle')}</p>
                      {pendingParam ? (
                        <div className="flex items-center gap-2 px-2.5 py-2 rounded-md bg-amber-50 border border-amber-200">
                          <AlertCircle className="w-3.5 h-3.5 text-amber-600 flex-shrink-0" />
                          <div className="flex-1 min-w-0">
                            <p className="text-[11px] font-medium text-amber-800 leading-tight">{t('generatorV1.step2.pendingParamWaiting')}</p>
                            <p className="text-[10px] font-mono text-amber-700 mt-0.5">{`{${pendingParam.key}}`}</p>
                          </div>
                          <button
                            onClick={handleCancelInsert}
                            className="p-1 rounded hover:bg-amber-100 text-amber-600 hover:text-amber-900 transition-colors flex-shrink-0"
                            title={t('generatorV1.step2.cancelInsertTitle')}
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ) : (
                        <div className="flex gap-1.5">
                          <Input
                            value={newParamLabel}
                            onChange={e => setNewParamLabel(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') handleAddField(); }}
                            placeholder={t('generatorV1.step2.newParamPlaceholder')}
                            className="h-8 text-xs flex-1"
                          />
                          <Button
                            size="sm"
                            className="h-8 px-2.5 gap-1 text-xs flex-shrink-0"
                            onClick={handleAddField}
                            disabled={!newParamLabel.trim()}
                          >
                            <Plus className="w-3.5 h-3.5" />{t('generatorV1.step2.addParamBtn')}
                          </Button>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Chỉnh sửa với AI */}
                <div className="space-y-2 pt-1">
                  <label className="text-[11px] font-medium text-foreground flex items-center gap-1.5">
                    <Sparkles className="w-3 h-3 text-primary" />
                    {t('generatorV1.step2.aiEditTitle')}
                  </label>
                  {blockOps.length > 0 ? (
                    <div className="rounded-md bg-emerald-50 border border-emerald-200 px-3 py-2.5 flex items-center gap-2">
                      {applyingRevise
                        ? <Loader2 className="w-3.5 h-3.5 text-emerald-600 flex-shrink-0 animate-spin" />
                        : <Check className="w-3.5 h-3.5 text-emerald-600 flex-shrink-0" />}
                      <span className="flex-1 text-xs text-emerald-800">
                        {t('generatorV1.step2.pendingOpsCount', { count: blockOps.filter(s => s.status !== 'rejected').length })}
                      </span>
                      <button
                        onClick={handleRejectAllBlock}
                        className="text-[11px] text-red-600 hover:text-red-800 font-medium underline flex-shrink-0"
                      >
                        {t('generatorV1.step2.cancelAllBtn')}
                      </button>
                    </div>
                  ) : aiSuggestions.some(s => s.status === 'pending') ? (
                    <div className="rounded-md bg-emerald-50 border border-emerald-200 px-3 py-2.5 flex items-center gap-2">
                      <Check className="w-3.5 h-3.5 text-emerald-600 flex-shrink-0" />
                      <span className="flex-1 text-xs text-emerald-800">
                        {t('generatorV1.step2.pendingSuggestionsCount', { count: aiSuggestions.filter(s => s.status === 'pending').length })}
                      </span>
                      <button
                        onClick={handleRejectAll}
                        className="text-[11px] text-red-600 hover:text-red-800 font-medium underline flex-shrink-0"
                      >
                        {t('generatorV1.step2.cancelAllBtn')}
                      </button>
                    </div>
                  ) : (
                    <>
                      <Textarea
                        value={aiInstruction}
                        onChange={e => { setAiInstruction(e.target.value); if (aiInstructionError) setAiInstructionError(''); }}
                        placeholder={t('generatorV1.step2.aiInstructionPlaceholder')}
                        className={`text-xs min-h-[100px] resize-none leading-relaxed ${aiInstructionError ? 'border-destructive focus-visible:ring-destructive' : ''}`}
                        disabled={generatingDiff}
                      />
                      {aiInstructionError && (
                        <p className="text-[11px] text-destructive">{aiInstructionError}</p>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        className="w-full h-8 text-xs gap-1.5"
                        onClick={handleGenerateDiff}
                        disabled={generatingDiff || applyingRevise || (!hasDraft && !hasHtmlSource)}
                      >
                        {generatingDiff
                          ? <><Loader2 className="w-3.5 h-3.5 animate-spin" />{t('generatorV1.step2.generatingSuggestionsBtn')}</>
                          : <><Sparkles className="w-3.5 h-3.5" />{t('generatorV1.step2.generateSuggestionsBtn')}</>}
                      </Button>
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* Sticky bottom actions */}
            <div className="flex-shrink-0 border-t border-border bg-card p-4 space-y-2">
              {!hasDraft && (
                <Button
                  variant="outline"
                  className="w-full h-9 text-xs gap-2"
                  onClick={handleGenerate}
                  disabled={generating}
                >
                  {generating ? <><Loader2 className="w-3.5 h-3.5 animate-spin" />{t('generatorV1.step2.generatingDraftBtn')}</> : <><Sparkles className="w-3.5 h-3.5" />{t('generatorV1.step2.generateAiDraftBtn')}</>}
                </Button>
              )}
              <Button
                className="w-full h-10 text-sm font-semibold gap-2"
                onClick={handleCreate}
              >
                {editMode ? <><Check className="w-4 h-4" />{t('generatorV1.step2.finishBtn')}</> : <><Check className="w-4 h-4" />{t('generatorV1.step2.exportModalTitle')}</>}
              </Button>
            </div>
          </>
        )}

        {tab === 'version' && (
          <div className="flex-1 min-h-0 overflow-y-auto">
            <div className="p-4 space-y-2">
              {sessionVersions.length === 0 ? (
                <div className="text-center py-12 space-y-3">
                  <HistoryIcon className="w-8 h-8 text-muted-foreground/30 mx-auto" />
                  <p className="text-xs text-muted-foreground">{t('generatorV1.step2.versionEmptyTitle')}</p>
                  <p className="text-[10px] text-muted-foreground">{t('generatorV1.step2.versionEmptyHint')}</p>
                </div>
              ) : (
                sessionVersions.map((v: any) => {
                  const isActive = activeVersionId === v.id;
                  return (
                    <div
                      key={v.id}
                      onClick={() => handleSelectVersion(v)}
                      className={`group flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-colors ${
                        isActive ? 'border-2 border-primary bg-primary/5' : 'border border-border hover:bg-muted/40'
                      }`}
                      title={t('generatorV1.step2.versionSelectTitle')}
                    >
                      <div className={`w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${
                        isActive ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
                      }`}>
                        V{v.version_no}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <p className="text-xs font-semibold text-foreground truncate">{v.label ?? t('generatorV1.step2.versionLabelFallback', { n: v.version_no })}</p>
                          {isActive && (
                            <span className="text-[10px] bg-primary text-primary-foreground px-1.5 py-0.5 rounded-full font-medium">{t('generatorV1.step2.versionActiveBadge')}</span>
                          )}
                        </div>
                        <p className="text-[10px] text-muted-foreground mt-0.5">
                          {v.created_at ? fmtDate(new Date(v.created_at), 'dd/MM/yyyy HH:mm') : ''}
                        </p>
                      </div>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button
                            onClick={(e) => e.stopPropagation()}
                            className="opacity-0 group-hover:opacity-100 data-[state=open]:opacity-100 p-1 rounded hover:bg-background transition-opacity flex-shrink-0"
                            aria-label={t('generatorV1.step2.versionOptionsAriaLabel')}
                          >
                            <MoreHorizontal className="w-3.5 h-3.5 text-muted-foreground" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-36">
                          <DropdownMenuItem
                            onClick={(e) => { e.stopPropagation(); setRenameVerTarget(v); setRenameVerValue(v.label ?? t('generatorV1.step2.versionLabelFallback', { n: v.version_no })); }}
                            className="text-xs gap-2"
                          >
                            <Pencil className="w-3.5 h-3.5" />{t('generatorV1.step2.versionRenameItem')}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={(e) => { e.stopPropagation(); setDeleteVerTarget(v); }}
                            className="text-xs gap-2 text-destructive focus:text-destructive"
                          >
                            <Trash2 className="w-3.5 h-3.5" />{t('generatorV1.step2.versionDeleteItem')}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── Create Document Modal ── */}
      <Dialog open={exportOpen} onOpenChange={open => { setExportOpen(open); if (!open) setSkipFieldValidation(false); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t('generatorV1.step2.exportModalTitle')}</DialogTitle>
            <DialogDescription className="text-xs">{t('generatorV1.step2.exportModalDesc')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-1">
            <div className="space-y-2">
              <Label className="text-xs font-medium">{t('generatorV1.step2.exportFormatLabel')}</Label>
              <div className="grid grid-cols-3 gap-2">
                {(['PDF', 'DOCX', 'Excel'] as const).map(fmt => (
                  <button
                    key={fmt}
                    onClick={() => setExportFormat(fmt)}
                    className={`flex flex-col items-center gap-1.5 p-3 rounded-lg border-2 text-xs font-medium transition-all ${
                      exportFormat === fmt ? 'border-primary bg-primary/8 text-primary' : 'border-border text-muted-foreground hover:border-primary/40'
                    }`}
                  >
                    <FileDown className="w-5 h-5" />
                    {fmt}
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">{t('generatorV1.step2.exportFolderLabel')}</Label>
              <Select value={exportFolderId} onValueChange={setExportFolderId}>
                <SelectTrigger className="h-9 text-xs"><SelectValue placeholder={t('generatorV1.step2.exportFolderPlaceholder')} /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__" className="text-xs text-muted-foreground">
                    {t('generatorV1.step2.exportFolderNone')}
                  </SelectItem>
                  {(folders ?? []).map(f => (
                    <SelectItem key={f.id} value={f.id} className="text-xs">
                      <span className="flex items-center gap-1.5"><FolderOpen className="w-3.5 h-3.5 text-amber-500" />{f.name}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setExportOpen(false)}>{t('generatorV1.step2.exportCancelBtn')}</Button>
            <Button onClick={handleConfirmExport} className="gap-1.5">
              <Check className="w-3.5 h-3.5" />{t('generatorV1.step2.exportConfirmBtn')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Xác nhận bỏ qua trường chưa điền ── */}
      <Dialog open={confirmSkipOpen} onOpenChange={setConfirmSkipOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('generatorV1.step2.confirmSkip.title', { count: emptyFieldKeys.size })}</DialogTitle>
            <DialogDescription className="text-xs">{t('generatorV1.step2.confirmSkip.desc')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmSkipOpen(false)}>{t('generatorV1.step2.confirmSkip.back')}</Button>
            <Button onClick={handleConfirmSkip} className="gap-1.5">
              <Check className="w-3.5 h-3.5" />{t('generatorV1.step2.confirmSkip.proceed')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Đổi tên phiên bản ── */}
      <Dialog open={!!renameVerTarget} onOpenChange={(o) => { if (!o) setRenameVerTarget(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('generatorV1.step2.renameVersionModalTitle')}</DialogTitle>
            <DialogDescription className="text-xs">{t('generatorV1.step2.renameVersionModalDesc')}</DialogDescription>
          </DialogHeader>
          <Input
            autoFocus
            value={renameVerValue}
            onChange={(e) => setRenameVerValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleRenameVersion(); }}
            className="text-sm"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameVerTarget(null)} disabled={verActionBusy}>{t('generatorV1.step2.renameVersionCancelBtn')}</Button>
            <Button onClick={handleRenameVersion} disabled={verActionBusy || !renameVerValue.trim()}>{t('generatorV1.step2.renameVersionSaveBtn')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Xoá phiên bản ── */}
      <Dialog open={!!deleteVerTarget} onOpenChange={(o) => { if (!o) setDeleteVerTarget(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('generatorV1.step2.deleteVersionModalTitle')}</DialogTitle>
            <DialogDescription className="text-xs">
              {t('generatorV1.step2.deleteVersionModalDesc', { label: deleteVerTarget?.label ?? t('generatorV1.step2.versionLabelFallback', { n: deleteVerTarget?.version_no }) })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteVerTarget(null)} disabled={verActionBusy}>{t('generatorV1.step2.deleteVersionCancelBtn')}</Button>
            <Button variant="destructive" className="gap-1.5" onClick={handleDeleteVersion} disabled={verActionBusy}>
              <Trash2 className="w-3.5 h-3.5" />{t('generatorV1.step2.deleteVersionConfirmBtn')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
