import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { useSearchParams, useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import {
  Loader2,
  Search,
  Filter,
  Grid3x3,
  List,
  Upload,
  LayoutTemplate,
  Star,
  Clock,
  Users,
  FolderTree,
  ChevronRight,
  Trash2,
  X,
} from "lucide-react";
import { cn } from "@/app/components/ui/utils";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { Document } from "../types/document";
import { Folder } from "../types/folder";
import type { FolderResponse } from "../types/api";
import { DocumentCard } from "../components/document/DocumentCard";
import { FolderCard } from "../components/document/FolderCard";
import { DocumentListView } from "../components/document/DocumentListView";
import { FolderTreePanel, FolderTreeAction } from "../components/document/FolderTreePanel";
import { FilterDocumentsDialog, DocumentFilterState } from "../components/document/FilterDocumentsDialog";
import { DocumentDetailPanel } from "../components/document/DocumentDetailPanel";
import { CreateFolderDialog } from "../components/document/CreateFolderDialog";
import { ShareDialog } from "../components/document/ShareDialog";
import { MoveToFolderDialog } from "../components/document/MoveToFolderDialog";
import { UploadModal } from "../components/document/UploadModal";
import { DocumentPreviewModal } from "../components/document/DocumentPreviewModal";
import { ConfirmDeleteModal } from "../components/ConfirmDeleteModal";
import { axiosClient } from "../api/client";
import { API_ENDPOINTS } from "../api/endpoints";
import { documentsApi } from "../api/endpoints/documents";
import { useQuery } from "@tanstack/react-query";
import {
  useDocuments,
  useDeleteDocument,
  useBulkDeleteDocuments,
  useToggleStar,
  useRenameDocument,
} from "../hooks/useDocuments";
import {
  useFolders,
  useFolder,
  useFolderBreadcrumb,
  useCreateFolder,
  useDeleteFolder,
  useRenameFolder,
} from "../hooks/useFolders";
import { useDocumentPageStore } from "../stores/documentPageStore";
import { useAuthStore } from "../stores/authStore";
import { toast } from "sonner";

type TabId = "recent" | "owned" | "shared" | "favorites";

function parseSortValue(sort: string): {
  sort_by: string;
  api_sort_by: "updated_at" | "created_at";
  sort_order: "asc" | "desc";
} {
  const [by, order] = sort.split(":");
  return {
    sort_by: by || "updated_at",
    api_sort_by: by === "created_at" ? "created_at" : "updated_at",
    sort_order: (order as "asc" | "desc") || "desc",
  };
}

function typeToExtensions(type: string): string[] | undefined {
  if (type === "all" || type === "folder") return undefined;
  if (type === "image") return [".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"];
  return [type];
}

export function DocumentsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const currentFolderId = searchParams.get("folder");
  const profile = useAuthStore((s) => s.profile);

  const {
    showCreateFolderDialog,
    showUploadModal,
    uploadType,
    openCreateFolderDialog,
    closeCreateFolderDialog,
    closeUploadModal,
    openUploadModal,
  } = useDocumentPageStore();

  // Filters
  const [page, setPage] = useState(1);
  const pageSize = 50;
  const [selectedType] = useState("all");
  const [selectedSort, setSelectedSort] = useState("updated_at:desc");
  const [q, setQ] = useState("");
  const [localSearch, setLocalSearch] = useState("");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Bulk selection
  const [selectMode, setSelectMode] = useState(false);
  const [selectedDocIds, setSelectedDocIds] = useState<Set<string>>(new Set());
  const [showBulkDeleteConfirm, setShowBulkDeleteConfirm] = useState(false);

  // View + tabs
  const [viewMode, setViewMode] = useState<"grid" | "list">("list");
  const tabParam = searchParams.get("tab") as TabId | null;
  const validTabs: TabId[] = ["recent", "owned", "shared", "favorites"];
  const [activeTab, setActiveTab] = useState<TabId>(
    tabParam && validTabs.includes(tabParam) ? tabParam : "recent"
  );

  // Folder creation target (overrides currentFolderId when set from tree panel)
  // undefined = use currentFolderId; null = root; string = specific folder
  const [createFolderParentOverride, setCreateFolderParentOverride] = useState<string | null | undefined>(undefined);

  // Filter dialog
  const [showFilterDialog, setShowFilterDialog] = useState(false);
  const [activeFilters, setActiveFilters] = useState<DocumentFilterState>({
    fileTypes: [],
    owner: null,
    fromDate: "",
    toDate: "",
  });

  const { sort_by, api_sort_by, sort_order } = parseSortValue(selectedSort);
  const shouldShowFolders = activeTab !== "favorites";

  const filterExtensions = useMemo(() => {
    if (activeFilters.fileTypes.length === 0) return typeToExtensions(selectedType);
    const extMap: Record<string, string[]> = {
      DOCX: [".docx", ".doc"],
      PDF: [".pdf"],
      XLSX: [".xlsx", ".xls"],
      IMG: [".jpg", ".jpeg", ".png", ".gif", ".webp"],
      VIDEO: [".mp4", ".avi", ".mov", ".mkv"],
    };
    return activeFilters.fileTypes.flatMap((ft) => extMap[ft] ?? [ft]);
  }, [activeFilters.fileTypes, selectedType]);

  const docParams = useMemo(() => {
    const base = {
      page,
      page_size: pageSize,
      folder_id: currentFolderId,
      extensions: filterExtensions,
      sort_by: api_sort_by,
      sort_order,
      q: q || undefined,
      start_date: activeFilters.fromDate ? `${activeFilters.fromDate}T00:00:00` : undefined,
      end_date: activeFilters.toDate ? `${activeFilters.toDate}T23:59:59` : undefined,
      uploader_id: activeFilters.owner?.id || undefined,
    };
    if (activeTab === "favorites") return { ...base, starred: true };
    if (activeTab === "owned" && profile?.id) return { ...base, uploader_id: profile.id };
    if (activeTab === "shared") return { ...base, shared_with_me: true };
    return base;
  }, [page, pageSize, currentFolderId, filterExtensions, api_sort_by, sort_order, q, activeTab, profile, activeFilters.fromDate, activeFilters.toDate, activeFilters.owner]);

  const { data: documentsData, isLoading: docsLoading } = useDocuments(docParams);
  const { data: foldersData, isLoading: foldersLoading } = useFolders(currentFolderId, {
    sharedWithMe: activeTab === "shared",
    enabled: shouldShowFolders,
  });
  const { data: currentFolderData } = useFolder(currentFolderId ?? "");
  const breadcrumb = useFolderBreadcrumb(currentFolderId);

  const createFolder = useCreateFolder(currentFolderId);
  const renameFolder = useRenameFolder();
  const renameDocument = useRenameDocument();
  const deleteDocument = useDeleteDocument(docParams);
  const deleteFolder = useDeleteFolder(currentFolderId);
  const bulkDelete = useBulkDeleteDocuments();
  const toggleStar = useToggleStar();

  const [selectedDocument, setSelectedDocument] = useState<Document | null>(null);
  const [selectedFolder, setSelectedFolder] = useState<Folder | null>(null);
  const [renameFolderTarget, setRenameFolderTarget] = useState<FolderResponse | null>(null);
  const [renameDocumentTarget, setRenameDocumentTarget] = useState<Document | null>(null);
  const [shareTarget, setShareTarget] = useState<Document | null>(null);
  const [moveDocumentTarget, setMoveDocumentTarget] = useState<Document | null>(null);
  const [showDetailPanel, setShowDetailPanel] = useState(false);
  const [detailItemType, setDetailItemType] = useState<"document" | "folder" | null>(null);
  const [previewDocument, setPreviewDocument] = useState<Document | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; type: "document" | "folder"; source_type?: string } | null>(null);

  const isDeleteTargetTemplate = deleteTarget?.type === "document" && deleteTarget.source_type === "template";
  const { data: templateUsageData } = useQuery({
    queryKey: ["template-usage", deleteTarget?.id],
    queryFn: () => documentsApi.templateUsage(deleteTarget!.id),
    enabled: !!deleteTarget?.id && isDeleteTargetTemplate,
  });
  const draftSessionCount = templateUsageData?.draft_session_count ?? 0;

  useEffect(() => {
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, []);

  const documents = documentsData?.items ?? [];
  const folders = shouldShowFolders ? foldersData ?? [] : [];
  const totalDocuments = documentsData?.total ?? 0;
  const totalPages = Math.ceil(totalDocuments / pageSize);

  const onNavigate = useCallback(
    (folderId: string | null) => {
      if (!folderId) setSearchParams({});
      else setSearchParams({ folder: folderId });
      setPage(1);
    },
    [setSearchParams]
  );

  const onFolderClick = useCallback((folderId: string) => onNavigate(folderId), [onNavigate]);

  const onDocumentSelect = useCallback((doc: Document) => {
    setSelectedDocument(doc);
    setShowDetailPanel(true);
    setDetailItemType("document");
  }, []);

  const onDocumentPreview = useCallback((doc: Document) => {
    setPreviewDocument(doc);
    setShowPreview(true);
  }, []);

  const onFolderSelect = useCallback((folder: Folder) => {
    setSelectedFolder(folder);
    setShowDetailPanel(true);
    setDetailItemType("folder");
  }, []);

  const handleCreateFolder = useCallback((name: string) => {
    const parentId = createFolderParentOverride !== undefined
      ? createFolderParentOverride
      : currentFolderId;
    const promise = createFolder.mutateAsync({ name, parent_id: parentId ?? undefined });
    toast.promise(promise, {
      loading: t("documents.toasts.creatingFolder", { name }),
      success: t("documents.toasts.folderCreated", { name }),
      error: t("documents.toasts.folderCreateFailed", { name }),
    });
    setCreateFolderParentOverride(undefined);
  }, [createFolder, currentFolderId, createFolderParentOverride, t]);

  const handleDeleteRequest = useCallback((id: string, type: "document" | "folder", source_type?: string) => {
    setDeleteTarget({ id, type, source_type });
  }, []);

  const handleCreateRootFolder = useCallback(() => {
    setCreateFolderParentOverride(null);
    openCreateFolderDialog();
  }, [openCreateFolderDialog]);

  const handleFolderTreeAction = useCallback((folder: FolderResponse, action: FolderTreeAction) => {
    if (action === "rename") {
      setRenameFolderTarget(folder);
    } else if (action === "delete") {
      handleDeleteRequest(folder.id, "folder");
    } else if (action === "add-subfolder") {
      setCreateFolderParentOverride(folder.id);
      openCreateFolderDialog();
    }
  }, [handleDeleteRequest, openCreateFolderDialog]);

  const handleDeleteConfirm = useCallback(async () => {
    if (!deleteTarget) return;
    const id = toast.loading(t("documents.toasts.deleting"));
    setDeleteTarget(null);
    setShowDetailPanel(false);
    try {
      if (deleteTarget.type === "folder") {
        await deleteFolder.mutateAsync(deleteTarget.id);
      } else {
        await deleteDocument.mutateAsync(deleteTarget.id);
      }
      toast.success(t("documents.toasts.deleted"), { id });
    } catch {
      toast.dismiss(id);
    }
  }, [deleteTarget, deleteFolder, deleteDocument, t]);

  const handleBulkDeleteConfirm = useCallback(async () => {
    if (selectedDocIds.size === 0) return;
    const id = toast.loading(t("documents.toasts.deleting"));
    try {
      const res = await bulkDelete.mutateAsync(Array.from(selectedDocIds));
      setSelectedDocIds(new Set());
      setSelectMode(false);
      setShowBulkDeleteConfirm(false);
      toast.success(t("documents.toasts.bulkDeleted", { count: res.deleted }), { id });
    } catch {
      toast.dismiss(id);
    }
  }, [selectedDocIds, bulkDelete, t]);

  const handleToggleStar = useCallback((doc: Document, e: React.MouseEvent) => {
    e.stopPropagation();
    toggleStar.mutate(doc.id);
  }, [toggleStar]);

  const handleDownload = useCallback((doc: Document) => {
    axiosClient
      .get(API_ENDPOINTS.documents.download(doc.id), { responseType: "blob" })
      .then((res) => {
        const url = URL.createObjectURL(res.data as Blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = doc.original_filename;
        a.click();
        URL.revokeObjectURL(url);
      })
      .catch(() => toast.error(t("documents.toasts.downloadFailed")));
  }, [t]);

  const toggleDocSelection = useCallback((id: string) => {
    setSelectedDocIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleSort = useCallback((col: string) => {
    const [cur, curOrder] = selectedSort.split(":");
    const newOrder = cur === col && curOrder === "desc" ? "asc" : "desc";
    setSelectedSort(`${col}:${newOrder}`);
    setPage(1);
  }, [selectedSort]);

  const handleSearchInput = useCallback((value: string) => {
    setLocalSearch(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => { setQ(value); setPage(1); }, 400);
  }, []);

  const filteredDocuments = useMemo(() => documents, [documents]);
  const filteredFolders = useMemo(() => folders, [folders]);
  const isLoading = docsLoading || (shouldShowFolders && foldersLoading);
  const totalCount = filteredFolders.length + filteredDocuments.length;

  const TABS: { id: TabId; label: string; icon: React.ReactNode }[] = [
    { id: "recent",    label: t("documents.tabRecent"),       icon: <Clock      className="h-3.5 w-3.5" /> },
    { id: "owned",     label: t("documents.tabOwnedByMe"),    icon: <FolderTree className="h-3.5 w-3.5" /> },
    { id: "shared",    label: t("documents.tabSharedWithMe"), icon: <Users      className="h-3.5 w-3.5" /> },
    { id: "favorites", label: t("documents.tabFavorites"),    icon: <Star       className="h-3.5 w-3.5" /> },
  ];

  return (
    <>
      <div className="flex h-full w-full min-w-0">
        {/* Left: Folder tree */}
        <FolderTreePanel
          currentFolderId={currentFolderId}
          onNavigate={onNavigate}
          onCreateRootFolder={handleCreateRootFolder}
          onFolderAction={handleFolderTreeAction}
          sharedWithMe={activeTab === "shared"}
        />

        {/* Right: Main content */}
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto p-5 space-y-4">

          {/* Breadcrumb */}
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 text-sm">
              <button
                onClick={() => onNavigate(null)}
                className={cn(
                  "transition-colors",
                  breadcrumb.length > 0
                    ? "text-muted-foreground hover:text-foreground"
                    : "font-semibold text-foreground"
                )}
              >
                {t("documents.myDrive")}
              </button>
              {breadcrumb.map((folder, i) => (
                <span key={folder.id} className="flex items-center gap-1.5">
                  <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                  {i < breadcrumb.length - 1 ? (
                    <button
                      onClick={() => onNavigate(folder.id)}
                      className="text-muted-foreground transition-colors hover:text-foreground"
                    >
                      {folder.name}
                    </button>
                  ) : (
                    <span className="font-semibold text-foreground">{folder.name}</span>
                  )}
                </span>
              ))}
            </div>
          </div>

          {/* Tabs + Action buttons */}
          <div className="flex items-center flex-wrap gap-2">
            <div className="flex items-center gap-0 flex-shrink-0 border-b border-border/40 overflow-x-auto">
              {TABS.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => { setActiveTab(tab.id); setPage(1); }}
                  className={cn(
                    "relative flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium transition-all whitespace-nowrap",
                    activeTab === tab.id
                      ? "text-accent-foreground font-semibold"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {tab.icon}
                  <span className="hidden sm:inline">{tab.label}</span>
                  {activeTab === tab.id && (
                    <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-accent-foreground rounded-full" />
                  )}
                </button>
              ))}
            </div>
            <div className="flex-1" />
            <button
              onClick={() => openUploadModal("file")}
              className="flex items-center gap-1.5 h-8 px-3 rounded-xl border border-border bg-card text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors flex-shrink-0"
            >
              <Upload className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">
                {t("documents.upload")}
              </span>
            </button>
            <button
              onClick={() => navigate("/generator")}
              className="flex items-center gap-1.5 h-8 px-3 rounded-xl bg-accent-foreground hover:bg-accent-foreground/90 text-white text-xs font-semibold transition-colors flex-shrink-0"
            >
              <LayoutTemplate className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{t("documents.templates")}</span>
            </button>
          </div>

          {/* Search + Filter + View toggle */}
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative flex-1 min-w-[160px] max-w-xs">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                value={localSearch}
                onChange={(e) => handleSearchInput(e.target.value)}
                placeholder={t("documents.searchPlaceholder")}
                className="pl-8 h-8 text-xs"
              />
            </div>

            <button
              onClick={() => setShowFilterDialog(true)}
              className={cn(
                "flex items-center gap-1.5 h-8 px-3 rounded-xl border text-xs font-medium transition-colors flex-shrink-0 bg-card",
                (activeFilters.fileTypes.length > 0 || activeFilters.fromDate || activeFilters.toDate || activeFilters.owner !== null)
                  ? "border-accent-foreground text-accent-foreground"
                  : "border-border text-muted-foreground hover:text-foreground hover:bg-muted"
              )}
            >
              <Filter className="h-3.5 w-3.5" />
              {t("common.filters")}
            </button>

            {selectMode && (
              <div className="flex items-center gap-2">
                {selectedDocIds.size > 0 && (
                  <Button variant="destructive" size="sm" onClick={() => setShowBulkDeleteConfirm(true)} disabled={bulkDelete.isPending}>
                    <Trash2 className="mr-1.5 h-4 w-4" />
                    {t("documents.selectToDelete")} ({selectedDocIds.size})
                  </Button>
                )}
                <Button variant="outline" size="sm" onClick={() => { setSelectMode(false); setSelectedDocIds(new Set()); }}>
                  <X className="mr-1.5 h-4 w-4" />
                  {t("common.cancel")}
                </Button>
              </div>
            )}

            <div className="flex-1" />
            <div className="flex items-center bg-card border border-border rounded-xl p-1 gap-0.5 flex-shrink-0">
              <button
                onClick={() => setViewMode("list")}
                title={t("common.listView")}
                className={cn("p-1.5 rounded-lg transition-colors", viewMode === "list" ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:text-foreground hover:bg-muted")}
              >
                <List className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => setViewMode("grid")}
                title={t("common.gridView")}
                className={cn("p-1.5 rounded-lg transition-colors", viewMode === "grid" ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:text-foreground hover:bg-muted")}
              >
                <Grid3x3 className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          {/* File count */}
          {!isLoading && (
            <p className="text-[11px] text-muted-foreground">
              {t("documents.fileCount", { count: totalCount })}
            </p>
          )}

          {/* Content */}
          <div>
            {isLoading ? (
              <div className="flex items-center justify-center py-20">
                <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
              </div>
            ) : viewMode === "list" ? (
              <DocumentListView
                documents={filteredDocuments}
                folders={filteredFolders}
                onDocumentView={onDocumentPreview}
                onDocumentRename={(doc) => setRenameDocumentTarget(doc)}
                onDocumentShare={(doc) => setShareTarget(doc)}
                onFolderClick={onFolderClick}
                onFolderSelect={onFolderSelect}
                onToggleStar={handleToggleStar}
                onDocumentDownload={handleDownload}
                onDocumentMove={(doc) => setMoveDocumentTarget(doc)}
                onDocumentDelete={(doc) => handleDeleteRequest(doc.id, "document", doc.source_type)}
                onFolderDelete={(folder) => handleDeleteRequest(folder.id, "folder")}
                currentFolderName={currentFolderData?.name}
                currentUserId={profile?.id}
                sortBy={sort_by}
                sortOrder={sort_order}
                onSort={handleSort}
              />
            ) : (
              <div className="space-y-6">
                {filteredFolders.length > 0 && (
                  <div>
                    <h2 className="mb-3 text-xs font-medium uppercase tracking-wider text-gray-400">
                      {t("documents.folders")}
                    </h2>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
                      {filteredFolders.map((folder) => (
                        <FolderCard key={folder.id} folder={folder} onClick={() => onFolderClick(folder.id)} onShowDetails={onFolderSelect} />
                      ))}
                    </div>
                  </div>
                )}
                {filteredDocuments.length > 0 && (
                  <div>
                    {filteredFolders.length > 0 && (
                      <h2 className="mb-3 text-xs font-medium uppercase tracking-wider text-gray-400">
                        {t("documents.title")}
                      </h2>
                    )}
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
                      {filteredDocuments.map((doc) => {
                        const isSelected = selectedDocIds.has(doc.id);
                        return (
                          <div
                            key={doc.id}
                            className={cn("relative rounded-xl transition-all", selectMode && isSelected ? "ring-2 ring-brand-500 ring-offset-1" : "")}
                            onClick={selectMode ? () => toggleDocSelection(doc.id) : undefined}
                          >
                            {selectMode && (
                              <div className="absolute top-3 right-3 z-10">
                                <input type="checkbox" checked={isSelected} onChange={() => toggleDocSelection(doc.id)} onClick={(e) => e.stopPropagation()} className="h-4 w-4 cursor-pointer rounded border-gray-300 text-brand-500" />
                              </div>
                            )}
                            <DocumentCard
                              handleToggleStar={handleToggleStar}
                              document={doc}
                              selectMode={selectMode}
                              onClick={selectMode ? undefined : onDocumentPreview}
                              onMenuClick={selectMode ? undefined : onDocumentSelect}
                            />
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
                {filteredFolders.length === 0 && filteredDocuments.length === 0 && (
                  <div className="py-16 text-center">
                    <p className="text-gray-500">{t("documents.emptyState")}</p>
                  </div>
                )}
              </div>
            )}

            {/* Pagination */}
            {totalDocuments > 0 && totalPages > 1 && (
              <div className="mt-4 flex items-center justify-between">
                <p className="text-sm text-gray-500">
                  {t("documents.showing", {
                    from: (page - 1) * pageSize + 1,
                    to: Math.min(page * pageSize, totalDocuments),
                    total: totalDocuments,
                  })}
                </p>
                <div className="flex items-center gap-1">
                  <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>←</Button>
                  <span className="px-3 text-sm text-gray-500">{page} / {totalPages}</span>
                  <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>→</Button>
                </div>
              </div>
            )}
          </div>
          </div>
        </div>
      </div>

      {/* Modals */}
      <DocumentDetailPanel
        item={detailItemType === "document" ? selectedDocument : selectedFolder}
        itemType={detailItemType}
        open={showDetailPanel}
        onClose={() => setShowDetailPanel(false)}
        onDelete={handleDeleteRequest}
      />
      <CreateFolderDialog
        open={showCreateFolderDialog}
        title={typeof createFolderParentOverride === "string" ? t("documents.addSubfolder") : undefined}
        placeholder={typeof createFolderParentOverride === "string" ? t("documents.subfolderNamePlaceholder") : undefined}
        onClose={() => { closeCreateFolderDialog(); setCreateFolderParentOverride(undefined); }}
        onCreateFolder={handleCreateFolder}
      />
      <CreateFolderDialog
        open={!!renameFolderTarget}
        initialName={renameFolderTarget?.name ?? ""}
        title={t("common.rename")}
        submitLabel={t("common.save")}
        onClose={() => setRenameFolderTarget(null)}
        onCreateFolder={async (name) => {
          if (!renameFolderTarget) return;
          const id = toast.loading(t("documents.toasts.renamingFolder", { name }));
          setRenameFolderTarget(null);
          try {
            await renameFolder.mutateAsync({ id: renameFolderTarget.id, name });
            toast.success(t("documents.toasts.folderRenamed", { name }), { id });
          } catch {
            toast.dismiss(id);
          }
        }}
      />
      <CreateFolderDialog
        open={!!renameDocumentTarget}
        initialName={renameDocumentTarget?.title ?? renameDocumentTarget?.original_filename ?? ""}
        title={t("common.rename")}
        placeholder={t("documents.documentNamePlaceholder")}
        submitLabel={t("common.save")}
        onClose={() => setRenameDocumentTarget(null)}
        onCreateFolder={async (title) => {
          if (!renameDocumentTarget) return;
          const id = toast.loading(t("documents.toasts.renamingFolder", { name: title }));
          setRenameDocumentTarget(null);
          try {
            await renameDocument.mutateAsync({ id: renameDocumentTarget.id, title });
            toast.success(t("documents.toasts.folderRenamed", { name: title }), { id });
          } catch {
            toast.dismiss(id);
          }
        }}
      />
      {shareTarget && (
        <ShareDialog
          open={!!shareTarget}
          onOpenChange={(open) => { if (!open) setShareTarget(null); }}
          resourceId={shareTarget.id}
          resourceType="document"
          resourceName={shareTarget.title || shareTarget.original_filename}
          ownerId={shareTarget.owner_id}
        />
      )}
      <MoveToFolderDialog
        document={moveDocumentTarget}
        open={!!moveDocumentTarget}
        onClose={() => setMoveDocumentTarget(null)}
      />
      {showUploadModal && (
        <UploadModal isOpen={showUploadModal} uploadType={uploadType} onClose={closeUploadModal} folderId={currentFolderId} />
      )}
      <DocumentPreviewModal document={previewDocument} documents={filteredDocuments} open={showPreview} onClose={() => setShowPreview(false)} />
      <ConfirmDeleteModal
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDeleteConfirm}
        title={t(deleteTarget?.type === "folder" ? "documents.deleteFolderTitle" : "documents.deleteConfirmTitle")}
        description={
          isDeleteTargetTemplate && draftSessionCount > 0
            ? t("documents.deleteTemplateWithDraftsMessage", { count: draftSessionCount })
            : t("documents.deleteConfirmMessage")
        }
        confirmLabel={t("common.delete")}
        isLoading={deleteDocument.isPending || deleteFolder.isPending}
      />
      <ConfirmDeleteModal
        open={showBulkDeleteConfirm}
        onClose={() => setShowBulkDeleteConfirm(false)}
        onConfirm={handleBulkDeleteConfirm}
        title={t("documents.bulkDeleteConfirm", { count: selectedDocIds.size })}
        description={t("documents.bulkDeleteDescription", { count: selectedDocIds.size })}
        confirmLabel={t("documents.deleteAll")}
        isLoading={bulkDelete.isPending}
      />

      <FilterDocumentsDialog
        open={showFilterDialog}
        initial={activeFilters}
        onClose={() => setShowFilterDialog(false)}
        onApply={(filters) => { setActiveFilters(filters); setPage(1); }}
      />

    </>
  );
}
