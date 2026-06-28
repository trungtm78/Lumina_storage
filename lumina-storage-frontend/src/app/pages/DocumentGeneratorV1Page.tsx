// @ts-nocheck
import { useState, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { AnimatePresence, motion } from 'motion/react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format, parseISO } from 'date-fns';
import {
  ArrowLeft, Check, ChevronRight, Clock,
  FileText, FolderOpen, Save,
} from 'lucide-react';
import { Button } from '@/app/components/ui/button';
import { Label } from '@/app/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/app/components/ui/select';
import {
  Dialog, DialogContent, DialogDescription, DialogTitle,
} from '@/app/components/ui/dialog';

import type { WizardStep, WizardDocType, TopTab, HistoryItem, DocFolder, DocStatus } from '@/app/components/document-generator-v1/types';
import type { SavedTplCard } from '@/app/components/document-generator-v1/types';
import { DOC_TYPE_VN } from '@/app/components/document-generator-v1/constants';
import { useToast } from '@/app/components/document-generator-v1/useToast';
import { Toast } from '@/app/components/document-generator-v1/Toast';
import { MyDocumentTab } from '@/app/components/document-generator-v1/MyDocumentTab';
import { SavedTemplatesPanel } from '@/app/components/document-generator-v1/SavedTemplatesPanel';
import { Step2 } from '@/app/components/document-generator-v1/Step2DraftEditor';
import { Step3 } from '@/app/components/document-generator-v1/Step3FillExport';
import { UploadHistoryDrawer } from '@/app/components/document-generator-v1/UploadHistoryDrawer';
import { GeneratorErrorBoundary } from '@/app/components/document-generator-v1/GeneratorErrorBoundary';
import { generatorSessionsApi, generatorApi } from '@/app/api/endpoints/generator';
import { foldersApi } from '@/app/api/endpoints/folders';
import { documentsApi } from '@/app/api/endpoints/documents';
import { templatesApi } from '@/app/api/endpoints/templates';

// Safe date formatter — never throws on null/malformed timestamps (a throw here
// happens in the page body, ABOVE the error boundary → white screen).
function safeFmt(value: string | null | undefined, pattern: string): string {
  if (!value) return '';
  try {
    const d = parseISO(value);
    if (isNaN(d.getTime())) return '';
    return format(d, pattern);
  } catch {
    return '';
  }
}

function DocumentGeneratorV1PageInner() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [topTab, setTopTab] = useState<TopTab>('create');
  const [step, setStep] = useState<WizardStep>(1);
  const [docType, setDocType] = useState<WizardDocType | null>(null);
  const [versions, setVersions] = useState([]);
  const [savedTemplate, setSavedTemplate] = useState<string | null>(null);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [currentFieldValues, setCurrentFieldValues] = useState<Record<string, string>>({});
  const [templatePrefill, setTemplatePrefill] = useState<Record<string, string> | undefined>(undefined);
  const [editingDoc, setEditingDoc] = useState<HistoryItem | null>(null);
  // When resuming a saved draft: the session id to generate into (continue, not content-edit).
  const [resumeSessionId, setResumeSessionId] = useState<string | null>(null);
  const [customEditorParams, setCustomEditorParams] = useState<{ key: string; label: string }[] | undefined>(undefined);
  const [customEditorTemplate, setCustomEditorTemplate] = useState<string | undefined>(undefined);
  const [exitConfirmOpen, setExitConfirmOpen] = useState(false);
  const [confirmSkipExitOpen, setConfirmSkipExitOpen] = useState(false);
  const [exitEmptyCount, setExitEmptyCount] = useState(0);
  const [highlightEmptyTrigger, setHighlightEmptyTrigger] = useState(0);
  const [exitFolderId, setExitFolderId] = useState<string>('__none__');
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);
  const { toasts, push: pushToast } = useToast();

  // doc→folder local mapping (pure UI, not stored in backend)
  const [docFolders, setDocFolders] = useState<Record<string, string>>({});

  // ── Server state: sessions ───────────────────────────────────────────────
  const { data: sessionsData, refetch: refetchSessions } = useQuery({
    queryKey: ['generator-sessions'],
    queryFn: () => generatorSessionsApi.list({ limit: 100 }),
  });

  // Generated documents carry the real folder_id (chosen at generate time).
  // Sessions don't store folder, so we map document_id → folder_id here to
  // group completed docs into the correct folder in "Tài liệu của tôi".
  // Key bắt đầu bằng 'documents' để mọi mutation document (đổi tên/xoá ở trang
  // "Tài Liệu") gọi invalidateQueries(['documents']) cũng làm map này refetch
  // → đồng bộ 2 chiều.
  const { data: genDocsData, refetch: refetchGenDocs } = useQuery({
    queryKey: ['documents', 'generated', 'generator-v1-map'],
    queryFn: () => documentsApi.list({ source_type: 'generated', page_size: 100 }),
  });
  // Map document_id → Document THẬT (title + folder), để hiển thị tên/folder cập nhật
  // theo trang "Tài Liệu".
  const genDocById = useMemo(() => {
    const m: Record<string, { title: string; folder_id: string | null }> = {};
    (genDocsData?.items ?? []).forEach(d => { if (d.id) m[d.id] = { title: d.title, folder_id: d.folder_id }; });
    return m;
  }, [genDocsData]);
  // Map đầy đủ (không bị phân trang) → mới dám ẩn tài liệu đã bị xoá bên "Tài Liệu".
  const genDocsComplete = !!genDocsData && (genDocsData.total ?? 0) <= (genDocsData.items?.length ?? 0);

  // Template titles → để đặt tên tài liệu mặc định = "tên template — ngày".
  const { data: templatesData } = useQuery({
    queryKey: ['generator-templates'],
    queryFn: () => templatesApi.list({ limit: 100 }),
    staleTime: 60_000,
  });
  const templateTitleById = useMemo(() => {
    const m: Record<string, string> = {};
    (templatesData?.items ?? []).forEach(t => {
      m[t.id] = (t.title ?? '').replace(/\.(docx?|pdf|xlsx?|pptx?)$/i, '').trim();
    });
    return m;
  }, [templatesData]);

  // Tên template hiện tại (fallback về nhãn loại tài liệu nếu không có template).
  const currentTemplateName = (
    (selectedTemplateId && templateTitleById[selectedTemplateId]) ||
    (docType ? (DOC_TYPE_VN[docType]?.label ?? docType) : 'Tài liệu')
  );

  const history: HistoryItem[] = useMemo(() => (sessionsData?.items ?? [])
    .map(s => {
      const completed = s.status === 'completed';
      const doc = s.document_id ? genDocById[s.document_id] : null;
      // Document đã bị xoá ở trang "Tài Liệu" → ẩn ở đây (chỉ khi map chắc chắn đầy đủ).
      const docDeleted = completed && !!s.document_id && !doc && genDocsComplete;
      return {
        id: s.id,
        // Ưu tiên tên Document THẬT (phản ánh đổi tên ở "Tài Liệu"); fallback session.title.
        title: doc?.title || s.title || `${s.doc_type ?? 'Tài liệu'} — ${safeFmt(s.created_at, 'dd/MM/yyyy')}`,
        type: (s.doc_type ?? 'Sales Contract') as WizardDocType,
        lastEdited: safeFmt(s.updated_at, 'yyyy-MM-dd'),
        status: (completed ? 'Completed' : 'In Progress') as DocStatus,
        currentStep: completed ? 3 : 2,
        versions: [],
        activity: [],
        documentId: s.document_id,
        templateId: s.template_id,
        folderId: doc?.folder_id ?? s.folder_id ?? '',
        fieldValues: s.field_values ?? {},
        _hidden: docDeleted,
      };
    })
    .filter(h => !h._hidden), [sessionsData, genDocById, genDocsComplete]);

  // ── Server state: folders ────────────────────────────────────────────────
  const { data: foldersData, refetch: refetchFolders } = useQuery({
    queryKey: ['folders'],
    queryFn: () => foldersApi.list(),
  });
  const folders: DocFolder[] = useMemo(() => (foldersData ?? []).map(f => ({ id: f.id, name: f.name })), [foldersData]);

  const createFolderMutation = useMutation({
    mutationFn: (name: string) => foldersApi.create({ name }),
    onSuccess: () => { refetchFolders(); pushToast(t('generatorV1.toast.folderCreated'), 'success', 1800); },
  });
  const renameFolderMutation = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => foldersApi.rename(id, name),
    onSuccess: () => { refetchFolders(); pushToast(t('generatorV1.toast.folderRenamed'), 'success', 1800); },
  });
  const deleteFolderMutation = useMutation({
    mutationFn: (id: string) => foldersApi.delete(id),
    onSuccess: () => { refetchFolders(); pushToast(t('generatorV1.toast.folderDeleted'), 'success', 1800); },
  });

  const handleCreateFolder = (name: string) => createFolderMutation.mutate(name);
  const handleRenameFolder = (id: string, name: string) => renameFolderMutation.mutate({ id, name });
  const handleDeleteFolder = (id: string) => deleteFolderMutation.mutate(id);

  // ── Field values sync from Step2 ─────────────────────────────────────────
  const handleFieldsChange = useCallback((vals: Record<string, string>) => {
    setCurrentFieldValues(vals);
  }, []);

  // ── Wizard navigation helpers ─────────────────────────────────────────────
  const resetWizard = () => {
    setStep(1); setDocType(null); setVersions([]); setSavedTemplate(null);
    setSelectedTemplateId(null); setCurrentFieldValues({});
    setTemplatePrefill(undefined); setCustomEditorParams(undefined); setCustomEditorTemplate(undefined);
    setResumeSessionId(null);
  };

  const goBack = () => {
    if (step === 2) {
      resetWizard(); setEditingDoc(null);
    }
    if (step === 3) setStep(2);
  };

  const handleGoBackRequest = () => {
    if (step === 2 && docType) {
      if (exitFolderId === '__none__' && folders.length) setExitFolderId(folders[0]?.id ?? '__none__');
      setExitConfirmOpen(true);
    } else {
      goBack();
    }
  };

  // ── Template selection ────────────────────────────────────────────────────
  const handleSelectType = (type: WizardDocType, prefill?: Record<string, string>, templateId?: string) => {
    setDocType(type);
    setVersions([]); setSavedTemplate(null);
    setSelectedTemplateId(templateId ?? null);
    setTemplatePrefill(prefill);
    setCustomEditorParams(undefined); setCustomEditorTemplate(undefined);
    setEditingDoc(null);
    setStep(2);
  };

  const handlePickTemplate = (card: SavedTplCard) => {
    handleSelectType(card.type, undefined, card.id);
  };

  const handlePickWithTemplate = (
    card: SavedTplCard,
    params: { key: string; label: string }[],
    template: string,
    prefill?: Record<string, string>,
  ) => {
    setCustomEditorParams(params.length ? params : undefined);
    setCustomEditorTemplate(template || undefined);
    setDocType(card.type);
    setVersions([]); setSavedTemplate(null);
    setSelectedTemplateId(card.id);
    setTemplatePrefill(prefill ?? {});
    setEditingDoc(null);
    setTopTab('create');
    setStep(2);
  };

  const handleEditDocument = (doc: HistoryItem) => {
    const rawSession = (sessionsData?.items ?? []).find(s => s.id === doc.id);

    // Mọi tài liệu (nháp HOẶC đã hoàn tất) đều có template + field_values trên session.
    // "Chỉnh sửa" = nạp lại đúng template + giá trị + folder THẬT để sửa rồi tạo lại.
    // (Không còn dùng nội dung giả getFakeContent / extractPrefillFromDoc.)
    if (rawSession) {
      if (rawSession.template_id && !rawSession.template_exists) {
        pushToast(t('generatorV1.toast.templateDeleted'), 'error', 4000);
        return;
      }
      setDocType(doc.type as WizardDocType);
      setVersions([]); setSavedTemplate(null);
      setSelectedTemplateId(rawSession.template_id ?? null);
      setTemplatePrefill(rawSession.field_values ?? {});
      setCurrentFieldValues(rawSession.field_values ?? {});
      setResumeSessionId(rawSession.id);
      setEditingDoc(null);
      setExitFolderId(rawSession.folder_id ?? '');
      setCustomEditorParams(undefined); setCustomEditorTemplate(undefined);
      setTopTab('create');
      setStep(2);
      return;
    }

    // Fallback hiếm gặp: không tìm thấy session (dữ liệu cũ) → mở editor trống theo loại
    setEditingDoc(null);
    setResumeSessionId(null);
    setDocType(doc.type as WizardDocType);
    setVersions([]); setSavedTemplate(null);
    setSelectedTemplateId(null);
    setTemplatePrefill(undefined);
    setCustomEditorParams(undefined); setCustomEditorTemplate(undefined);
    setTopTab('create');
    setStep(2);
  };

  const handleSaveEdit = (_content: string) => {
    setEditingDoc(null);
    setCustomEditorParams(undefined); setCustomEditorTemplate(undefined);
    setTopTab('templates');
    setStep(1); setDocType(null);
  };

  // ── "Hoàn tất" — generate document via backend ───────────────────────────
  const handleFinalize = async (
    _content: string,
    _format: 'PDF' | 'DOCX' | 'Excel',
    folderId: string,
    fieldValues?: Record<string, string>,
    opts?: { editedHtml?: string; sessionId?: string; skipValidation?: boolean },
  ) => {
    if (!docType) return;

    const vals = fieldValues ?? currentFieldValues;
    const outputFormat = _format === 'PDF' ? 'pdf' : 'docx'; // Excel fallback to docx
    const ext = outputFormat === 'pdf' ? '.pdf' : '.docx';
    // Tên mặc định = tên template + ngày (title hiển thị + tên file tải về).
    const sessionTitle = `${currentTemplateName} — ${format(new Date(), 'dd/MM/yyyy')}`;
    const outputFilename = `${currentTemplateName}_${format(new Date(), 'yyyyMMdd')}${ext}`;
    // Phase 2: có nội dung sửa tay → backend generate từ HTML đã sửa (PDF/DOCX).
    const editedHtml = opts?.editedHtml;

    if (!selectedTemplateId && !editedHtml) {
      pushToast(t('generatorV1.toast.noTemplate'), 'info', 2400);
      return;
    }

    try {
      // Session do Step2 tạo (khi lưu version) được ưu tiên.
      const existingSessionId = opts?.sessionId ?? resumeSessionId ?? editingDoc?.id ?? null;
      let completedSessionId: string;
      if (existingSessionId) {
        // Resume/edit: lưu lại field_values + folder + title mới nhất trước khi generate
        await generatorSessionsApi.update(existingSessionId, {
          field_values: vals,
          title: sessionTitle,
          folder_id: folderId || undefined,
        });
        await generatorSessionsApi.generate(existingSessionId, {
          output_filename: outputFilename,
          folder_id: folderId || undefined,
          output_format: outputFormat,
          edited_html: editedHtml || undefined,
          skip_field_validation: opts?.skipValidation || undefined,
        });
        completedSessionId = existingSessionId;
      } else {
        const session = await generatorSessionsApi.create({
          template_id: selectedTemplateId ?? undefined,
          doc_type: docType,
          field_values: vals,
          title: sessionTitle,
          folder_id: folderId || undefined,
        });
        await generatorSessionsApi.generate(session.id, {
          output_filename: outputFilename,
          folder_id: folderId || undefined,
          output_format: outputFormat,
          edited_html: editedHtml || undefined,
          skip_field_validation: opts?.skipValidation || undefined,
        });
        completedSessionId = session.id;
      }

      // Chỉ navigate ra khỏi editor khi thành công
      // Await refetch để session mới (status=completed) có trong list trước khi set selected.
      await refetchSessions();
      refetchGenDocs(); // cập nhật map document → folder để hiện đúng folder
      pushToast(t('generatorV1.toast.createSuccess'), 'success', 2400);
      setSelectedDocId(completedSessionId); // auto-select tài liệu vừa tạo
      setTopTab('templates');
      resetWizard();
      setEditingDoc(null);
    } catch (err: any) {
      // Ở lại editor khi lỗi — không navigate, không reset
      const issues = err?.response?.data?.detail?.issues;
      if (issues?.length) {
        const labels = issues.map((i: any) => i.message).join('\n');
        pushToast(t('generatorV1.toast.missingFields', { labels }), 'info', 4000);
      } else {
        pushToast(t('generatorV1.toast.createError'), 'info', 2400);
      }
      refetchSessions(); // refetch để hiện session đang failed nếu có
    }
  };

  // ── "Xử lý sau" — save session to backend ────────────────────────────────
  const handleExitSaveLater = async () => {
    if (docType) {
      try {
        if (resumeSessionId) {
          // Đang resume một nháp → cập nhật nháp đó, không tạo mới
          await generatorSessionsApi.update(resumeSessionId, {
            field_values: currentFieldValues,
            folder_id: exitFolderId !== '__none__' ? exitFolderId : null,
          });
        } else {
          await generatorSessionsApi.create({
            template_id: selectedTemplateId ?? undefined,
            doc_type: docType,
            field_values: currentFieldValues,
            title: `${currentTemplateName} — ${format(new Date(), 'dd/MM/yyyy')}`,
            folder_id: exitFolderId !== '__none__' ? exitFolderId : null,
          });
        }
        refetchSessions();
        setExitConfirmOpen(false);
        pushToast(t('generatorV1.toast.savedForLater'), 'success', 2200);
        goBack();
        return;
      } catch {
        pushToast(t('generatorV1.toast.saveError'), 'error', 3000);
        return;
      }
    }
    setExitConfirmOpen(false);
    goBack();
  };

  const handleExitFinalize = () => {
    if (!docType) return;
    const emptyCount = Object.values(currentFieldValues).filter(v => !v?.trim()).length;
    if (emptyCount > 0) {
      setExitEmptyCount(emptyCount);
      setConfirmSkipExitOpen(true);
      return;
    }
    setExitConfirmOpen(false);
    handleFinalize('', 'DOCX', exitFolderId !== '__none__' ? exitFolderId : '', currentFieldValues);
  };

  const handleExitFinalizeConfirmed = () => {
    setConfirmSkipExitOpen(false);
    setExitConfirmOpen(false);
    handleFinalize('', 'DOCX', exitFolderId !== '__none__' ? exitFolderId : '', currentFieldValues, { skipValidation: true });
  };

  // ── My Documents actions ──────────────────────────────────────────────────
  const handleApproveDraft = (_content: string) => {
    setSavedTemplate(_content);
    setStep(3);
  };

  const handleResume = (doc: HistoryItem) => {
    setDocType(doc.type as WizardDocType);
    setVersions([]); setSavedTemplate(null);
    setTopTab('create');
    setStep(doc.status === 'Draft' ? 2 : 3);
    pushToast(t('generatorV1.toast.resuming', { title: doc.title }), 'info', 1800);
  };

  const handleDownload = async (doc: HistoryItem) => {
    if (!doc.documentId) {
      pushToast(t('generatorV1.toast.noFile', { title: doc.title }), 'info', 2000);
      return;
    }
    try {
      // Always fetch fresh metadata so the filename has the correct extension.
      // genDocsData may be stale (e.g. right after generation), and the fallback
      // would hardcode ".docx" even for PDF documents.
      const freshMeta = await documentsApi.get(doc.documentId);
      const ext = freshMeta.original_filename?.split('.').pop() || 'docx';
      const rawTitle = (freshMeta.title || doc.title || '').trim();
      const displayTitle = rawTitle.replace(/\.(docx?|pdf|xlsx?)$/i, '');
      const filename = displayTitle ? `${displayTitle}.${ext}` : (freshMeta.original_filename || `${doc.title}.docx`);
      await documentsApi.download(doc.documentId, filename);
    } catch {
      pushToast(t('generatorV1.toast.downloadError'), 'info', 2200);
    }
  };

  // Đổi tên: cập nhật CẢ session lẫn Document thật → đồng bộ sang "Tài Liệu".
  const handleRenameSession = async (id: string, title: string) => {
    const rawSession = (sessionsData?.items ?? []).find(s => s.id === id);
    try {
      await generatorSessionsApi.update(id, { title });
      if (rawSession?.document_id) {
        await documentsApi.update(rawSession.document_id, { title });
      }
      refetchSessions();
      refetchGenDocs();
      queryClient.invalidateQueries({ queryKey: ['documents'] }); // trang Tài Liệu + Thùng Rác
    } catch { /* ignore */ }
  };

  const handleMoveSession = async (id: string, folderId: string) => {
    const rawSession = (sessionsData?.items ?? []).find(s => s.id === id);
    const folderIdOrNull = folderId || null;
    try {
      await generatorSessionsApi.update(id, { folder_id: folderIdOrNull });
      if (rawSession?.document_id) {
        await documentsApi.move(rawSession.document_id, folderIdOrNull);
        queryClient.invalidateQueries({ queryKey: ['documents'] });
      }
      refetchSessions();
      refetchGenDocs();
    } catch { /* ignore */ }
  };

  // Xoá: xoá session VÀ Document thật (soft-delete → vào Thùng Rác, biến mất khỏi "Tài Liệu").
  const handleDeleteSession = async (id: string) => {
    const rawSession = (sessionsData?.items ?? []).find(s => s.id === id);
    try {
      await generatorSessionsApi.delete(id);
      if (rawSession?.document_id) {
        await documentsApi.delete(rawSession.document_id);
      }
      refetchSessions();
      refetchGenDocs();
      queryClient.invalidateQueries({ queryKey: ['documents'] });
      if (selectedDocId === id) setSelectedDocId(null);
    } catch { /* ignore */ }
  };

  const currentContent = versions[versions.length - 1]?.content ?? '';
  const inWizard = topTab === 'create' && step > 1;

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col overflow-hidden">
      <Toast toasts={toasts} />

      {/* Top toolbar */}
      <div className="border-b border-border px-5 py-2.5 flex items-center gap-3 bg-card flex-shrink-0">
        {inWizard ? (
          <>
            <Button variant="ghost" size="sm" className="gap-1.5 text-xs h-8 text-muted-foreground" onClick={handleGoBackRequest}>
              <ArrowLeft className="w-3.5 h-3.5" />{t('generatorV1.backBtn')}
            </Button>
            {docType && (
              <>
                <ChevronRight className="w-3 h-3 text-muted-foreground/40" />
                <span className="text-sm font-medium text-foreground">{currentTemplateName}</span>
              </>
            )}
          </>
        ) : (
          <div className="flex items-center gap-1">
            <button
              onClick={() => { setTopTab('create'); resetWizard(); }}
              className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                topTab === 'create' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'
              }`}
            >
              <FileText className="w-3.5 h-3.5" />{t('generatorV1.tabCreate')}
            </button>
            <button
              onClick={() => setTopTab('templates')}
              className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                topTab === 'templates' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'
              }`}
            >
              <FolderOpen className="w-3.5 h-3.5" />{t('generatorV1.tabMyDocs')}
            </button>
          </div>
        )}

        <div className="flex-1" />
        <UploadHistoryDrawer />
      </div>

      {/* Body */}
      <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
        {topTab === 'templates' ? (
          <MyDocumentTab
            history={history}
            folders={folders}
            docFolders={docFolders}
            selectedDocId={selectedDocId}
            onSelectDoc={setSelectedDocId}
            onCreateFolder={handleCreateFolder}
            onRenameFolder={handleRenameFolder}
            onDeleteFolder={handleDeleteFolder}
            _onResume={handleResume}
            onDownload={handleDownload}
            onRename={handleRenameSession}
            onDelete={handleDeleteSession}
            onMove={handleMoveSession}
            pushToast={pushToast}
            onEdit={handleEditDocument}
          />
        ) : step === 1 ? (
          <SavedTemplatesPanel
            onPick={handlePickTemplate}
            onPickWithTemplate={handlePickWithTemplate}
            pushToast={pushToast}
          />
        ) : (
          <AnimatePresence mode="wait">
            {step === 2 && docType && (
              <motion.div key="step2" initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }} transition={{ duration: 0.2 }} className="h-full">
                <Step2
                  docType={docType}
                  templateId={selectedTemplateId ?? undefined}
                  versions={versions}
                  onVersionsChange={setVersions}
                  onApproveDraft={handleApproveDraft}
                  initialPrefill={templatePrefill}
                  pushToast={pushToast}
                  editMode={false}
                  initialContent={undefined}
                  onSave={handleSaveEdit}
                  folders={folders}
                  onFinalize={handleFinalize}
                  customParams={customEditorParams}
                  baseTemplate={customEditorTemplate}
                  onFieldsChange={handleFieldsChange}
                  sessionId={resumeSessionId ?? editingDoc?.id ?? null}
                  onSessionCreated={(id) => setResumeSessionId(id)}
                  triggerHighlightEmpty={highlightEmptyTrigger}
                />
              </motion.div>
            )}
            {step === 3 && docType && (
              <motion.div key="step3" initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }} transition={{ duration: 0.2 }} className="h-full">
                <Step3 docType={docType} templateContent={savedTemplate ?? currentContent} savedHistory={history} onSavedHistoryChange={() => {}} />
              </motion.div>
            )}
          </AnimatePresence>
        )}
      </div>

      {/* Exit Confirm Dialog */}
      <Dialog open={exitConfirmOpen} onOpenChange={open => { if (!open) setExitConfirmOpen(false); }}>
        <DialogContent className="max-w-md p-0 gap-0 overflow-hidden">
          <div className="px-6 pt-6 pb-4 pr-12">
            <div className="flex items-center gap-2.5 mb-2">
              <div className="w-9 h-9 rounded-xl bg-amber-50 flex items-center justify-center flex-shrink-0">
                <Save className="w-4.5 h-4.5 text-amber-600" />
              </div>
              <DialogTitle className="text-base font-semibold text-foreground leading-snug">
                {t('generatorV1.exitDialog.title')}
              </DialogTitle>
            </div>
            <DialogDescription className="text-sm text-muted-foreground leading-relaxed">
              {t('generatorV1.exitDialog.desc')}
            </DialogDescription>
          </div>

          <div className="px-6 pb-5 space-y-4 border-t border-border pt-4">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-foreground">{t('generatorV1.exitDialog.folderLabel')}</Label>
              <p className="text-[11px] text-muted-foreground">{t('generatorV1.exitDialog.folderHint')}</p>
              <Select value={exitFolderId} onValueChange={setExitFolderId}>
                <SelectTrigger className="h-9 text-xs">
                  <SelectValue placeholder={t('generatorV1.exitDialog.folderPlaceholder')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__" className="text-xs text-muted-foreground">
                    {t('generatorV1.exitDialog.folderNone')}
                  </SelectItem>
                  {folders.map(f => (
                    <SelectItem key={f.id} value={f.id} className="text-xs">
                      <span className="flex items-center gap-1.5">
                        <FolderOpen className="w-3.5 h-3.5 text-amber-500" />{f.name}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex items-center gap-2 px-6 py-4 border-t border-border bg-muted/30">
            <Button variant="outline" className="flex-1 h-9 text-sm gap-2" onClick={handleExitSaveLater}>
              <Clock className="w-3.5 h-3.5" />{t('generatorV1.exitDialog.saveLaterBtn')}
            </Button>
            <Button className="flex-1 h-9 text-sm font-semibold gap-2" onClick={handleExitFinalize}>
              <Check className="w-3.5 h-3.5" />{t('generatorV1.exitDialog.finalizeBtn')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Xác nhận bỏ qua field chưa điền — từ exit dialog */}
      <Dialog open={confirmSkipExitOpen} onOpenChange={open => { if (!open) setConfirmSkipExitOpen(false); }}>
        <DialogContent className="max-w-sm">
          <div className="px-1 pt-1">
            <DialogTitle className="text-base font-semibold">{t('generatorV1.step2.confirmSkip.title', { count: exitEmptyCount })}</DialogTitle>
            <DialogDescription className="text-xs mt-1.5">{t('generatorV1.step2.confirmSkip.desc')}</DialogDescription>
          </div>
          <div className="flex gap-2 justify-end mt-2">
            <Button variant="outline" onClick={() => { setConfirmSkipExitOpen(false); setExitConfirmOpen(false); setHighlightEmptyTrigger(n => n + 1); }}>{t('generatorV1.step2.confirmSkip.back')}</Button>
            <Button onClick={handleExitFinalizeConfirmed} className="gap-1.5">
              <Check className="w-3.5 h-3.5" />{t('generatorV1.step2.confirmSkip.proceed')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function DocumentGeneratorV1Page() {
  // Bump the key to fully remount the inner page on reset — clears any state
  // that may have triggered a render crash.
  const [resetKey, setResetKey] = useState(0);
  return (
    <GeneratorErrorBoundary onReset={() => setResetKey(k => k + 1)}>
      <DocumentGeneratorV1PageInner key={resetKey} />
    </GeneratorErrorBoundary>
  );
}
