// @ts-nocheck
import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import {
  Check, ChevronRight, Clock, Download, FileText,
  Plus, Search,
  ArrowLeft, FolderOpen,
  ChevronDown,
  Eye,
  FileSearch,
  FolderInput,
  Inbox,
  MoreHorizontal,
  Trash2, Pencil,
  FolderPlus,
} from 'lucide-react';
import { Button } from '@/app/components/ui/button';
import { Input } from '@/app/components/ui/input';
import { Label } from '@/app/components/ui/label';
import { Badge } from '@/app/components/ui/badge';
import { ScrollArea } from '@/app/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/app/components/ui/select';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/app/components/ui/dialog';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator,
} from '@/app/components/ui/dropdown-menu';
import type { HistoryItem, DocFolder } from './types';
import { ROUTE_PATHS } from './constants';
import { documentsApi } from '@/app/api/endpoints/documents';
import { templatesApi } from '@/app/api/endpoints/templates';
import { axiosClient } from '@/app/api/client';
import { API_ENDPOINTS } from '@/app/api/endpoints';
import { Loader2 } from 'lucide-react';
import { DocxFormattedPreview } from './DocPreview';

/**
 * Preview cho NHÁP (chưa hoàn tất, chưa có Document): dựng từ nội dung gốc template
 * (có {placeholder}) + giá trị đã điền (field_values của session) — highlight đã/chưa điền.
 */
function DraftPreview({ templateId, fieldValues, title }: {
  templateId: string;
  fieldValues: Record<string, string>;
  title: string;
}) {
  const { t } = useTranslation();
  // Preview nháp GIỮ ĐỊNH DẠNG Word (mammoth) + highlight giá trị đã điền.
  const fields = Object.entries(fieldValues ?? {}).map(([key, value]) => ({ key, label: key, value: value ?? '' }));
  return (
    <DocxFormattedPreview
      documentId={templateId}
      fields={fields}
      label={`${title} — ${t('generatorV1.myDocs.draftPreviewSuffix')}`}
    />
  );
}

/**
 * Inline preview cho tài liệu đã tạo. Fetch qua axios (kèm Bearer token) rồi tạo
 * blob URL — KHÔNG dùng <iframe src={previewUrl}> trực tiếp vì iframe không gửi
 * được header Authorization → 401. DOCX/Office convert sang PDF qua Gotenberg.
 */
function GeneratedDocPreview({ documentId, title }: { documentId: string; title: string }) {
  const { t } = useTranslation();
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const { data: docMeta } = useQuery({
    queryKey: ['doc-meta', documentId],
    queryFn: () => documentsApi.get(documentId),
    staleTime: 60_000,
  });

  useEffect(() => {
    if (!docMeta) return;
    let cancelled = false;
    setLoading(true); setError(false); setBlobUrl(null);
    const ext = (docMeta.extension ?? '').toLowerCase().replace(/^\./, '');
    const mime = docMeta.mime_type ?? '';
    const isOffice =
      ['docx', 'doc', 'xlsx', 'xls', 'pptx', 'ppt'].includes(ext) ||
      mime.includes('officedocument') || mime.includes('msword');
    const endpoint = isOffice
      ? API_ENDPOINTS.documents.previewPdf(documentId)
      : API_ENDPOINTS.documents.preview(documentId);
    axiosClient
      .get(endpoint, { responseType: 'blob' })
      .then(res => {
        if (cancelled) return;
        setBlobUrl(URL.createObjectURL(res.data as Blob));
        setLoading(false);
      })
      .catch(() => { if (!cancelled) { setError(true); setLoading(false); } });
    return () => { cancelled = true; };
  }, [docMeta, documentId]);

  useEffect(() => () => { if (blobUrl) URL.revokeObjectURL(blobUrl); }, [blobUrl]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (error || !blobUrl) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-center px-6">
        <p className="text-sm font-medium text-foreground">{t('generatorV1.myDocs.previewNoDocTitle')}</p>
        <p className="text-xs text-muted-foreground">{t('generatorV1.myDocs.previewNoDocDesc')}</p>
      </div>
    );
  }
  return <iframe src={blobUrl} className="w-full h-full border-0" title={title} />;
}

export function MyDocumentTab({
  history, folders, docFolders, selectedDocId, onSelectDoc,
  onCreateFolder, onRenameFolder, onDeleteFolder,
  _onResume, onDownload, onRename, onDelete, onMove, pushToast, onEdit,
}: {
  history: HistoryItem[];
  folders: DocFolder[];
  docFolders: Record<string, string>;
  selectedDocId: string | null;
  onSelectDoc: (id: string | null) => void;
  onCreateFolder: (name: string) => void;
  onRenameFolder: (id: string, name: string) => void;
  onDeleteFolder: (id: string) => void;
  _onResume: (doc: HistoryItem) => void;
  onDownload: (doc: HistoryItem) => void;
  onRename: (id: string, newTitle: string) => void;
  onDelete: (id: string) => void;
  onMove: (id: string, folderId: string) => void;
  pushToast: (msg: string, type?: 'info' | 'success', duration?: number) => void;
  onEdit: (doc: HistoryItem) => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [filterTemplate, setFilterTemplate] = useState('all');
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(folders.map(f => [f.id, true]))
  );
  useEffect(() => {
    setExpanded(prev => {
      const next = { ...prev };
      folders.forEach(f => { if (next[f.id] === undefined) next[f.id] = true; });
      return next;
    });
  }, [folders]);

  // Subfolder state
  const [createSubFolderOpen, setCreateSubFolderOpen] = useState(false);
  const [subFolderParent, setSubFolderParent] = useState<DocFolder | null>(null);
  const [newSubFolderName, setNewSubFolderName] = useState('');

  const getProcessStatus = (item: HistoryItem): { label: string; cls: string } => {
    if (item.status === 'Completed' || item.status === 'Batch Generated')
      return { label: t('generatorV1.myDocs.statusProcessed'), cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' };
    if (item.status === 'In Progress')
      return { label: t('generatorV1.myDocs.statusProcessing'), cls: 'bg-blue-50 text-blue-700 border-blue-200' };
    // Draft — treat first MOCK item (h4) as error for demo variety
    return { label: t('generatorV1.myDocs.statusProcessing'), cls: 'bg-blue-50 text-blue-700 border-blue-200' };
  };

  // Danh sách template từ thư viện thật
  const { data: templatesData } = useQuery({
    queryKey: ['generator-templates'],
    queryFn: () => templatesApi.list({ limit: 100 }),
    staleTime: 60_000,
  });
  const templateOptions = templatesData?.items ?? [];
  const confirmCreateSubFolder = () => {
    const name = newSubFolderName.trim();
    if (!name || !subFolderParent) return;
    onCreateFolder(`${subFolderParent.name} / ${name}`);
    setNewSubFolderName('');
    setCreateSubFolderOpen(false);
  };

  const selected = history.find(d => d.id === selectedDocId) ?? null;

  // Doc rename/delete
  const [actionTarget, setActionTarget] = useState<HistoryItem | null>(null);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const [deleteOpen, setDeleteOpen] = useState(false);

  // Folder create/rename/delete
  const [createFolderOpen, setCreateFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [folderTarget, setFolderTarget] = useState<DocFolder | null>(null);
  const [renameFolderOpen, setRenameFolderOpen] = useState(false);
  const [renameFolderValue, setRenameFolderValue] = useState('');
  const [deleteFolderOpen, setDeleteFolderOpen] = useState(false);

  const openRenameFor = (doc: HistoryItem) => {
    setActionTarget(doc);
    setRenameValue(doc.title);
    setRenameOpen(true);
  };
  const openDeleteFor = (doc: HistoryItem) => {
    setActionTarget(doc);
    setDeleteOpen(true);
  };

  // Move to folder
  const [moveOpen, setMoveOpen] = useState(false);
  const [moveFolderId, setMoveFolderId] = useState<string>('__none__');
  const openMoveFor = (doc: HistoryItem) => {
    setActionTarget(doc);
    setMoveFolderId(doc.folderId ?? '__none__');
    setMoveOpen(true);
  };
  const confirmMove = () => {
    if (!actionTarget) return;
    onMove(actionTarget.id, moveFolderId === '__none__' ? '' : moveFolderId);
    setMoveOpen(false);
    pushToast(t('generatorV1.myDocs.toast.movedDoc'), 'success', 2000);
  };

  const confirmRename = () => {
    if (!actionTarget || !renameValue.trim()) return;
    onRename(actionTarget.id, renameValue.trim());
    setRenameOpen(false);
    pushToast(t('generatorV1.myDocs.toast.renamedDoc'), 'success', 2000);
  };
  const confirmDelete = () => {
    if (!actionTarget) return;
    const id = actionTarget.id;
    setDeleteOpen(false);
    onDelete(id);
    if (selectedDocId === id) onSelectDoc(null);
    pushToast(t('generatorV1.myDocs.toast.deletedDoc'), 'success', 2000);
  };

  const openRenameFolder = (f: DocFolder) => {
    setFolderTarget(f);
    setRenameFolderValue(f.name);
    setRenameFolderOpen(true);
  };
  const openDeleteFolder = (f: DocFolder) => {
    setFolderTarget(f);
    setDeleteFolderOpen(true);
  };
  const confirmCreateFolder = () => {
    const name = newFolderName.trim();
    if (!name) return;
    onCreateFolder(name);
    setNewFolderName('');
    setCreateFolderOpen(false);
  };
  const confirmRenameFolder = () => {
    if (!folderTarget || !renameFolderValue.trim()) return;
    onRenameFolder(folderTarget.id, renameFolderValue.trim());
    setRenameFolderOpen(false);
  };
  const confirmDeleteFolder = () => {
    if (!folderTarget) return;
    onDeleteFolder(folderTarget.id);
    setDeleteFolderOpen(false);
  };

  const handleDownloadClick = () => {
    if (!selected) return;
    pushToast(t('generatorV1.myDocs.toast.downloading'), 'info', 1800);
    onDownload(selected);
  };
  const handleAnalyze = () => {
    if (!selected) return;
    if (!selected.documentId) {
      pushToast(t('generatorV1.myDocs.toast.notComplete'), 'info', 2200);
      return;
    }
    // Truyền documentId thật để Document Review tải nội dung từ backend (không dùng content giả)
    const preloadDoc = {
      id: `mydoc-${selected.id}`,
      documentId: selected.documentId,
      name: selected.title.endsWith('.docx') ? selected.title : `${selected.title}.docx`,
      date: selected.lastEdited,
      status: 'Not analyzed' as const,
    };
    pushToast(t('generatorV1.myDocs.toast.sentToReview'), 'success', 2200);
    navigate(ROUTE_PATHS.DOCUMENT_REVIEW, { state: { preloadDoc } });
  };
  const handleEditClick = () => {
    if (!selected) return;
    onEdit(selected);
  };

  const q = search.trim().toLowerCase();
  const matchesQuery = (d: HistoryItem) => {
    const matchSearch = !q || d.title.toLowerCase().includes(q);
    const matchTemplate = filterTemplate === 'all' || d.templateId === filterTemplate;
    return matchSearch && matchTemplate;
  };
  // Nhóm theo folder_id THẬT của tài liệu (lấy từ backend qua document_id),
  // fallback về map local docFolders nếu có (kéo-thả thủ công trong tương lai).
  const docsInFolder = (folderId: string) =>
    history.filter(d => {
      const fid = docFolders[d.id] ?? d.folderId ?? '';
      return fid === folderId && matchesQuery(d);
    });

  const docsUnfiled = () =>
    history.filter(d => {
      const fid = docFolders[d.id] ?? d.folderId ?? '';
      return !fid && matchesQuery(d);
    });

  return (
    <div className="flex h-full min-h-0">
      {/* Sidebar */}
      <div className="w-[320px] flex-shrink-0 border-r border-border bg-card flex flex-col overflow-hidden h-full">
        <div className="p-3 border-b border-border flex-shrink-0 space-y-2">
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input value={search} onChange={e => setSearch(e.target.value)} className="pl-8 h-8 text-xs" placeholder={t('generatorV1.myDocs.searchPlaceholder')} />
          </div>
          <Select value={filterTemplate} onValueChange={setFilterTemplate}>
            <SelectTrigger className="h-7 text-xs">
              <SelectValue placeholder={t('generatorV1.myDocs.filterTemplatePlaceholder')} />
            </SelectTrigger>
            <SelectContent className="max-h-60 overflow-y-auto">
              <SelectItem value="all" className="text-xs">{t('generatorV1.myDocs.filterAllTemplates')}</SelectItem>
              {templateOptions.map(t => (
                <SelectItem key={t.id} value={t.id} className="text-xs">{t.title}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button size="sm" variant="outline" className="w-full h-7 gap-1.5 text-xs" onClick={() => { setNewFolderName(''); setCreateFolderOpen(true); }}>
            <Plus className="w-3.5 h-3.5" />{t('generatorV1.myDocs.createFolderBtn')}
          </Button>
        </div>
        <ScrollArea className="flex-1 min-h-0 [&>[data-radix-scroll-area-viewport]]:overflow-x-hidden">
          {folders.length === 0 && docsUnfiled().length === 0 ? (
            <div className="p-8 text-center">
              <p className="text-xs text-muted-foreground">{t('generatorV1.myDocs.noFoldersMsg')}</p>
            </div>
          ) : (
            <div className="p-2 space-y-0.5">
              {/* Unfiled section — items saved without a folder */}
              {docsUnfiled().length > 0 && (() => {
                const isOpen = expanded['__unfiled__'] !== false;
                const docs = docsUnfiled();
                return (
                  <div className="space-y-0.5">
                    <div
                      className="group flex items-center gap-1.5 px-2 py-1.5 rounded-md hover:bg-muted/50 cursor-pointer"
                      onClick={() => setExpanded(prev => ({ ...prev, ['__unfiled__']: !isOpen }))}
                    >
                      {isOpen ? <ChevronDown className="w-3 h-3 text-muted-foreground" /> : <ChevronRight className="w-3 h-3 text-muted-foreground" />}
                      <Inbox className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                      <span className="text-xs font-medium text-muted-foreground truncate flex-1 min-w-0">{t('generatorV1.myDocs.unfiledSection')}</span>
                      <span className="text-[10px] text-muted-foreground flex-shrink-0">{docs.length}</span>
                    </div>
                    {isOpen && (
                      <div className="ml-5 pl-2 border-l border-border space-y-0.5">
                        {docs.map(d => {
                          const isSel = selectedDocId === d.id;
                          const ps = getProcessStatus(d);
                          return (
                            <div
                              key={d.id}
                              className={`group rounded-md cursor-pointer transition-colors border ${
                                isSel ? 'bg-primary/10 border-primary/30' : 'border-transparent hover:border-border hover:bg-muted/40'
                              } px-2 py-2 mx-0.5`}
                              onClick={() => onSelectDoc(d.id)}
                            >
                              <div className="flex items-start gap-1.5">
                                <FileText className={`w-3.5 h-3.5 flex-shrink-0 mt-0.5 ${isSel ? 'text-primary' : 'text-muted-foreground'}`} />
                                <div className="flex-1 min-w-0">
                                  <p className={`text-xs truncate leading-tight ${isSel ? 'text-primary font-medium' : 'text-foreground'}`}>{d.title}</p>
                                  <div className="flex items-center gap-1.5 mt-1">
                                    <span className={`inline-flex items-center text-[10px] font-medium px-1.5 py-0.5 rounded border ${ps.cls}`}>{ps.label}</span>
                                    <span className="text-[10px] text-muted-foreground truncate">{d.lastEdited}</span>
                                  </div>
                                </div>
                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild>
                                    <button
                                      onClick={(e) => e.stopPropagation()}
                                      className="opacity-0 group-hover:opacity-100 data-[state=open]:opacity-100 p-0.5 rounded hover:bg-background transition-opacity flex-shrink-0"
                                      aria-label={t('generatorV1.myDocs.docOptionsAriaLabel')}
                                    >
                                      <MoreHorizontal className="w-3.5 h-3.5 text-muted-foreground" />
                                    </button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent align="end" className="w-44">
                                    <DropdownMenuItem onClick={(e) => { e.stopPropagation(); openRenameFor(d); }} className="text-xs gap-2">
                                      <Pencil className="w-3.5 h-3.5" />{t('generatorV1.myDocs.docRenameItem')}
                                    </DropdownMenuItem>
                                    <DropdownMenuItem onClick={(e) => { e.stopPropagation(); openMoveFor(d); }} className="text-xs gap-2">
                                      <FolderInput className="w-3.5 h-3.5" />{t('generatorV1.myDocs.docMoveItem')}
                                    </DropdownMenuItem>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem onClick={(e) => { e.stopPropagation(); openDeleteFor(d); }} className="text-xs gap-2 text-destructive focus:text-destructive">
                                      <Trash2 className="w-3.5 h-3.5" />{t('generatorV1.myDocs.docDeleteItem')}
                                    </DropdownMenuItem>
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })()}
              {folders.map(folder => {
                const isOpen = expanded[folder.id] !== false;
                const docs = docsInFolder(folder.id);
                return (
                  <div key={folder.id} className="space-y-0.5">
                    <div
                      className="group flex items-center gap-1.5 px-2 py-1.5 rounded-md hover:bg-muted/50 cursor-pointer"
                      onClick={() => setExpanded(prev => ({ ...prev, [folder.id]: !isOpen }))}
                    >
                      {isOpen ? <ChevronDown className="w-3 h-3 text-muted-foreground" /> : <ChevronRight className="w-3 h-3 text-muted-foreground" />}
                      <FolderOpen className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />
                      <span className="text-xs font-medium text-foreground truncate flex-1 min-w-0">{folder.name}</span>
                      <span className="text-[10px] text-muted-foreground flex-shrink-0">{docs.length}</span>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button
                            onClick={(e) => e.stopPropagation()}
                            className="opacity-0 group-hover:opacity-100 data-[state=open]:opacity-100 p-0.5 rounded hover:bg-background transition-opacity flex-shrink-0"
                            aria-label={t('generatorV1.myDocs.folderOptionsAriaLabel')}
                          >
                            <MoreHorizontal className="w-3.5 h-3.5 text-muted-foreground" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-44">
                          <DropdownMenuItem onClick={(e) => { e.stopPropagation(); setSubFolderParent(folder); setNewSubFolderName(''); setCreateSubFolderOpen(true); }} className="text-xs gap-2">
                            <FolderPlus className="w-3.5 h-3.5" />{t('generatorV1.myDocs.createSubfolderItem')}
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onClick={(e) => { e.stopPropagation(); openRenameFolder(folder); }} className="text-xs gap-2">
                            <Pencil className="w-3.5 h-3.5" />{t('generatorV1.myDocs.renameFolderItem')}
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={(e) => { e.stopPropagation(); openDeleteFolder(folder); }} className="text-xs gap-2 text-destructive focus:text-destructive">
                            <Trash2 className="w-3.5 h-3.5" />{t('generatorV1.myDocs.deleteFolderItem')}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                    {isOpen && (
                      <div className="ml-5 pl-2 border-l border-border space-y-0.5">
                        {docs.length === 0 ? (
                          <p className="text-[10px] text-muted-foreground py-1 pl-2">{t('generatorV1.myDocs.folderEmptyMsg')}</p>
                        ) : docs.map(d => {
                          const isSel = selectedDocId === d.id;
                          const ps = getProcessStatus(d);
                          return (
                            <div
                              key={d.id}
                              className={`group rounded-md cursor-pointer transition-colors border ${
                                isSel ? 'bg-primary/10 border-primary/30' : 'border-transparent hover:border-border hover:bg-muted/40'
                              } px-2 py-2 mx-0.5`}
                              onClick={() => onSelectDoc(d.id)}
                            >
                              <div className="flex items-start gap-1.5">
                                <FileText className={`w-3.5 h-3.5 flex-shrink-0 mt-0.5 ${isSel ? 'text-primary' : 'text-muted-foreground'}`} />
                                <div className="flex-1 min-w-0">
                                  <p className={`text-xs truncate leading-tight ${isSel ? 'text-primary font-medium' : 'text-foreground'}`}>{d.title}</p>
                                  <div className="flex items-center gap-1.5 mt-1">
                                    <span className={`inline-flex items-center text-[10px] font-medium px-1.5 py-0.5 rounded border ${ps.cls}`}>{ps.label}</span>
                                    <span className="text-[10px] text-muted-foreground truncate">{d.lastEdited}</span>
                                  </div>
                                </div>
                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild>
                                    <button
                                      onClick={(e) => e.stopPropagation()}
                                      className="opacity-0 group-hover:opacity-100 data-[state=open]:opacity-100 p-0.5 rounded hover:bg-background transition-opacity flex-shrink-0"
                                      aria-label={t('generatorV1.myDocs.docOptionsAriaLabel')}
                                    >
                                      <MoreHorizontal className="w-3.5 h-3.5 text-muted-foreground" />
                                    </button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent align="end" className="w-44">
                                    <DropdownMenuItem onClick={(e) => { e.stopPropagation(); openRenameFor(d); }} className="text-xs gap-2">
                                      <Pencil className="w-3.5 h-3.5" />{t('generatorV1.myDocs.docRenameItem')}
                                    </DropdownMenuItem>
                                    <DropdownMenuItem onClick={(e) => { e.stopPropagation(); openMoveFor(d); }} className="text-xs gap-2">
                                      <FolderInput className="w-3.5 h-3.5" />{t('generatorV1.myDocs.docMoveItem')}
                                    </DropdownMenuItem>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem onClick={(e) => { e.stopPropagation(); openDeleteFor(d); }} className="text-xs gap-2 text-destructive focus:text-destructive">
                                      <Trash2 className="w-3.5 h-3.5" />{t('generatorV1.myDocs.docDeleteItem')}
                                    </DropdownMenuItem>
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </ScrollArea>
      </div>

      {/* Main preview */}
      <div className="flex-1 min-w-0 flex flex-col bg-background">
        {selected ? (
          <>
            <div className="flex items-center gap-2 px-5 py-3 border-b border-border bg-card flex-shrink-0">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-foreground truncate">{selected.title}</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">{selected.type} · {selected.lastEdited}</p>
              </div>
              <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs" onClick={handleDownloadClick}>
                <Download className="w-3.5 h-3.5" />{t('generatorV1.myDocs.downloadBtn')}
              </Button>
              <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs" onClick={handleAnalyze}>
                <FileSearch className="w-3.5 h-3.5" />{t('generatorV1.myDocs.analyzeBtn')}
              </Button>
              <Button size="sm" className="h-8 gap-1.5 text-xs" onClick={handleEditClick}>
                <Pencil className="w-3.5 h-3.5" />{t('generatorV1.myDocs.editBtn')}
              </Button>
            </div>
            <div className="flex-1 overflow-hidden">
              {selected.documentId ? (
                <GeneratedDocPreview documentId={selected.documentId} title={selected.title} />
              ) : selected.templateId ? (
                <DraftPreview
                  templateId={selected.templateId}
                  fieldValues={selected.fieldValues ?? {}}
                  title={selected.title}
                />
              ) : (
                <div className="h-full flex flex-col items-center justify-center gap-2 text-center px-6">
                  <p className="text-sm font-medium text-foreground">{t('generatorV1.myDocs.incompleteDraftTitle')}</p>
                  <p className="text-xs text-muted-foreground">{t('generatorV1.myDocs.incompleteDraftDesc')}</p>
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center gap-3">
            <div className="w-16 h-16 rounded-2xl bg-muted flex items-center justify-center">
              <FileText className="w-7 h-7 text-muted-foreground" />
            </div>
            <p className="text-sm font-semibold text-foreground">{t('generatorV1.myDocs.emptySelectionTitle')}</p>
            <p className="text-xs text-muted-foreground">{t('generatorV1.myDocs.emptySelectionDesc')}</p>
          </div>
        )}
      </div>

      {/* Create Subfolder Dialog */}
      <Dialog open={createSubFolderOpen} onOpenChange={setCreateSubFolderOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('generatorV1.myDocs.createSubfolderModalTitle')}</DialogTitle>
            <DialogDescription className="text-xs">{t('generatorV1.myDocs.createSubfolderModalDesc', { parentName: subFolderParent?.name })}</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">{t('generatorV1.myDocs.subfolderNameLabel')}</Label>
            <Input
              autoFocus
              value={newSubFolderName}
              onChange={e => setNewSubFolderName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') confirmCreateSubFolder(); }}
              placeholder={t('generatorV1.myDocs.subfolderNamePlaceholder')}
              className="text-sm"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateSubFolderOpen(false)}>{t('generatorV1.myDocs.subfolderCancelBtn')}</Button>
            <Button onClick={confirmCreateSubFolder} disabled={!newSubFolderName.trim()}>{t('generatorV1.myDocs.subfolderCreateBtn')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create Folder Dialog */}
      <Dialog open={createFolderOpen} onOpenChange={setCreateFolderOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('generatorV1.myDocs.createFolderModalTitle')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">{t('generatorV1.myDocs.folderNameLabel')}</Label>
            <Input
              autoFocus
              value={newFolderName}
              onChange={e => setNewFolderName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') confirmCreateFolder(); }}
              placeholder={t('generatorV1.myDocs.folderNamePlaceholder')}
              className="text-sm"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateFolderOpen(false)}>{t('generatorV1.myDocs.createFolderCancelBtn')}</Button>
            <Button onClick={confirmCreateFolder} disabled={!newFolderName.trim()}>{t('generatorV1.myDocs.createFolderConfirmBtn')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rename Folder Dialog */}
      <Dialog open={renameFolderOpen} onOpenChange={setRenameFolderOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('generatorV1.myDocs.renameFolderModalTitle')}</DialogTitle>
          </DialogHeader>
          <Input value={renameFolderValue} onChange={e => setRenameFolderValue(e.target.value)} className="text-sm" />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameFolderOpen(false)}>{t('generatorV1.myDocs.renameFolderCancelBtn')}</Button>
            <Button onClick={confirmRenameFolder} disabled={!renameFolderValue.trim()}>{t('generatorV1.myDocs.renameFolderSaveBtn')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Folder Dialog */}
      <Dialog open={deleteFolderOpen} onOpenChange={setDeleteFolderOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('generatorV1.myDocs.deleteFolderModalTitle')}</DialogTitle>
            <DialogDescription className="text-xs">
              {t('generatorV1.myDocs.deleteFolderModalDesc', { name: folderTarget?.name })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteFolderOpen(false)}>{t('generatorV1.myDocs.deleteFolderCancelBtn')}</Button>
            <Button variant="destructive" onClick={confirmDeleteFolder} className="gap-1.5">
              <Trash2 className="w-3.5 h-3.5" />{t('generatorV1.myDocs.deleteFolderConfirmBtn')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rename Doc Dialog */}
      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('generatorV1.myDocs.renameDocModalTitle')}</DialogTitle>
            <DialogDescription className="text-xs">{t('generatorV1.myDocs.renameDocModalDesc')}</DialogDescription>
          </DialogHeader>
          <Input value={renameValue} onChange={e => setRenameValue(e.target.value)} className="text-sm" />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameOpen(false)}>{t('generatorV1.myDocs.renameDocCancelBtn')}</Button>
            <Button onClick={confirmRename} disabled={!renameValue.trim()}>{t('generatorV1.myDocs.renameDocSaveBtn')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Move to Folder Dialog */}
      <Dialog open={moveOpen} onOpenChange={setMoveOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('generatorV1.myDocs.moveDocModalTitle')}</DialogTitle>
            <DialogDescription className="text-xs">{t('generatorV1.myDocs.moveDocModalDesc')}</DialogDescription>
          </DialogHeader>
          <Select value={moveFolderId} onValueChange={setMoveFolderId}>
            <SelectTrigger className="h-9 text-xs">
              <SelectValue placeholder={t('generatorV1.myDocs.moveDocFolderPlaceholder')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__" className="text-xs text-muted-foreground">
                {t('generatorV1.myDocs.moveDocNoFolder')}
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
          <DialogFooter>
            <Button variant="outline" onClick={() => setMoveOpen(false)}>{t('generatorV1.myDocs.moveDocCancelBtn')}</Button>
            <Button onClick={confirmMove} className="gap-1.5">
              <FolderInput className="w-3.5 h-3.5" />{t('generatorV1.myDocs.moveDocConfirmBtn')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Doc Confirm */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('generatorV1.myDocs.deleteDocModalTitle')}</DialogTitle>
            <DialogDescription className="text-xs">
              {t('generatorV1.myDocs.deleteDocModalDesc', { title: actionTarget?.title })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>{t('generatorV1.myDocs.deleteDocCancelBtn')}</Button>
            <Button variant="destructive" onClick={confirmDelete} className="gap-1.5">
              <Trash2 className="w-3.5 h-3.5" />{t('generatorV1.myDocs.deleteDocConfirmBtn')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
