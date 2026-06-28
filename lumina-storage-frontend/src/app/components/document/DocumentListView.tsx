import { useTranslation } from "react-i18next";
import {
  Folder,
  FileText,
  FileEdit,
  FileVideo,
  Image,
  FileSpreadsheet,
  File,
  MoreVertical,
  ArrowUpDown,
  Loader2,
  AlertCircle,
  Star,
  Eye,
  Pencil,
  Share2,
  Download,
  Trash2,
  FolderInput,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/app/components/ui/dropdown-menu";
import { Document } from "../../types/document";
import { Folder as FolderType } from "../../types/folder";
import { formatFileSize, getFileTypeFromExtension } from "../../utils/formatters";
import { FileTypeBadge } from "./FileTypeBadge";
import { format, isToday, isYesterday } from "date-fns";
import { cn } from "@/app/components/ui/utils";

interface DocumentListViewProps {
  documents: Document[];
  folders: FolderType[];
  onFolderClick: (folderId: string) => void;
  onFolderSelect: (folder: FolderType) => void;
  onDocumentView?: (document: Document) => void;
  onDocumentRename?: (document: Document) => void;
  onDocumentShare?: (document: Document) => void;
  onToggleStar?: (doc: Document, e: React.MouseEvent) => void;
  onDocumentDownload?: (doc: Document) => void;
  onDocumentMove?: (doc: Document) => void;
  onDocumentDelete?: (doc: Document) => void;
  onFolderDelete?: (folder: FolderType) => void;
  currentFolderName?: string;
  currentUserId?: string;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
  onSort?: (column: string) => void;
}

function getDocIcon(extension: string) {
  const type = getFileTypeFromExtension(extension);
  let Icon = File;
  if (type === "pdf")   Icon = FileText;
  else if (type === "doc")   Icon = FileEdit;
  else if (type === "xls")   Icon = FileSpreadsheet;
  else if (type === "image") Icon = Image;
  else if (type === "video") Icon = FileVideo;
  return (
    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-accent">
      <Icon className="h-3.5 w-3.5 text-accent-foreground" />
    </div>
  );
}

function smartDate(iso: string): string {
  const d = new Date(iso);
  if (isToday(d))     return format(d, "HH:mm");
  if (isYesterday(d)) return format(d, "HH:mm 'yesterday'");
  return format(d, "yyyy-MM-dd");
}

function SortHeader({
  label,
  col,
  sortBy,
  sortOrder: _sortOrder,
  onSort,
}: {
  label: string;
  col: string;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
  onSort?: (col: string) => void;
}) {
  const active = sortBy === col;
  return (
    <button
      onClick={() => onSort?.(col)}
      className="inline-flex items-center gap-0.5 !text-[10px] !font-semibold hover:text-foreground transition-colors group"
    >
      {label}
      <ArrowUpDown
        className={cn(
          "w-2.5 h-2.5 transition-opacity",
          active ? "opacity-100 text-accent-foreground" : "opacity-30 group-hover:opacity-60"
        )}
      />
    </button>
  );
}

const headerColClass = "text-[10px] font-semibold uppercase tracking-wider text-muted-foreground";

export function DocumentListView({
  documents,
  folders,
  onFolderClick,
  onFolderSelect,
  onDocumentView,
  onDocumentRename,
  onDocumentShare,
  onToggleStar,
  onDocumentDownload,
  onDocumentMove,
  onDocumentDelete,
  onFolderDelete,
  currentFolderName,
  currentUserId,
  sortBy,
  sortOrder,
  onSort,
}: DocumentListViewProps) {
  const { t } = useTranslation();
  const isEmpty = folders.length === 0 && documents.length === 0;

  return (
    <div className="border border-border rounded-xl overflow-hidden bg-card">
      {/* Header */}
      <div className="flex items-center px-4 py-2.5 border-b border-border/60 bg-muted/30">
        <div className="w-7 flex-shrink-0" />
        <div className={cn("flex-[3]", headerColClass)}>
          <SortHeader label={t("common.name")} col="name" sortBy={sortBy} sortOrder={sortOrder} onSort={onSort} />
        </div>
        <div className={cn("flex-[0.8] hidden sm:block", headerColClass)}>
          <SortHeader label={t("common.type")} col="extension" sortBy={sortBy} sortOrder={sortOrder} onSort={onSort} />
        </div>
        <div className={cn("flex-[1.5] hidden md:block", headerColClass)}>
          <SortHeader label={t("documents.location")} col="location" sortBy={sortBy} sortOrder={sortOrder} onSort={onSort} />
        </div>
        <div className={cn("flex-[1.5] hidden lg:block", headerColClass)}>
          <SortHeader label={t("documents.owner")} col="owner" sortBy={sortBy} sortOrder={sortOrder} onSort={onSort} />
        </div>
        <div className={cn("flex-[1] hidden sm:block", headerColClass)}>
          <SortHeader label={t("documents.modifiedDate")} col="updated_at" sortBy={sortBy} sortOrder={sortOrder} onSort={onSort} />
        </div>
        <div className={cn("flex-[1] hidden xl:block", headerColClass)}>
          <SortHeader label={t("common.createdAt")} col="created_at" sortBy={sortBy} sortOrder={sortOrder} onSort={onSort} />
        </div>
        <div className={cn("flex-[0.7] hidden sm:block", headerColClass)}>
          <SortHeader label={t("common.size")} col="file_size" sortBy={sortBy} sortOrder={sortOrder} onSort={onSort} />
        </div>
        <div className="w-8 flex-shrink-0" />
      </div>

      {/* Rows */}
      <div>
        {/* Folders */}
        {folders.map((folder) => (
          <div
            key={folder.id}
            onClick={() => onFolderClick(folder.id)}
            className="flex items-center px-4 py-3 border-b border-border/40 last:border-b-0 hover:bg-muted/20 transition-colors cursor-pointer"
          >
            <div className="w-7 flex-shrink-0">
              <button
                className="p-1 rounded transition-colors hover:bg-yellow-50 flex-shrink-0"
                onClick={(e) => e.stopPropagation()}
              >
                <Star className="w-3.5 h-3.5 text-muted-foreground/40" />
              </button>
            </div>
            <div className="flex-[3] flex items-center gap-2 min-w-0 pr-2">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-amber-50">
                <Folder className="h-3.5 w-3.5 text-amber-600" />
              </div>
              <span className="text-xs font-medium text-foreground truncate">{folder.name}</span>
            </div>
            <div className="flex-[0.8] hidden sm:flex items-center pr-2" />
            <div className="flex-[1.5] hidden md:block text-xs text-muted-foreground truncate pr-2">
              {currentFolderName ?? t("documents.myDrive")}
            </div>
            <div className="flex-[1.5] hidden lg:block text-xs text-muted-foreground truncate pr-2">
              {t("documents.me")}
            </div>
            <div className="flex-[1] hidden sm:block text-xs text-muted-foreground pr-2">
              {smartDate(folder.updated_at)}
            </div>
            <div className="flex-[1] hidden xl:block text-xs text-muted-foreground pr-2">
              {smartDate(folder.created_at)}
            </div>
            <div className="flex-[0.7] hidden sm:block text-xs text-muted-foreground pr-2">—</div>
            <div className="w-8 flex-shrink-0 flex justify-end" onClick={(e) => e.stopPropagation()}>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors">
                    <MoreVertical className="w-3.5 h-3.5" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="rounded-xl shadow-lg py-1 min-w-[140px]">
                  <DropdownMenuItem className="px-3 py-2 text-xs gap-2" onClick={() => onFolderSelect(folder)}>
                    <Pencil className="size-3" />{t("common.rename")}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="px-3 py-2 text-xs gap-2 text-destructive focus:bg-muted focus:text-destructive"
                    onClick={() => onFolderDelete?.(folder)}
                  >
                    <Trash2 className="size-3 text-destructive" />{t("common.delete")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        ))}

        {/* Documents */}
        {documents.map((doc) => (
          <div
            key={doc.id}
            onClick={() => onDocumentView?.(doc)}
            className="flex items-center px-4 py-3 border-b border-border/40 last:border-b-0 hover:bg-muted/20 transition-colors cursor-pointer"
          >
            <div className="w-7 flex-shrink-0">
              {onToggleStar ? (
                <button
                  onClick={(e) => { e.stopPropagation(); onToggleStar(doc, e); }}
                  className="p-1 rounded transition-colors hover:bg-yellow-50 flex-shrink-0"
                >
                  <Star
                    className={cn(
                      "w-3.5 h-3.5 transition-colors",
                      doc.starred ? "fill-yellow-400 text-yellow-400" : "text-muted-foreground/40 hover:text-yellow-400"
                    )}
                  />
                </button>
              ) : (
                <button className="p-1 rounded transition-colors hover:bg-yellow-50 flex-shrink-0">
                  <Star className="w-3.5 h-3.5 text-muted-foreground/40" />
                </button>
              )}
            </div>

            <div className="flex-[3] flex items-center gap-2 min-w-0 pr-2">
              {getDocIcon(doc.extension)}
              <span className="text-xs font-medium text-foreground truncate">
                {doc.title || doc.original_filename}
              </span>
              {(doc.processing_status === "pending" || doc.processing_status === "processing") && (
                <Loader2 className="h-3 w-3 shrink-0 animate-spin text-muted-foreground/60" />
              )}
              {doc.processing_status === "failed" && (
                <AlertCircle className="h-3 w-3 shrink-0 text-destructive" />
              )}
            </div>

            <div className="flex-[0.8] hidden sm:flex items-center pr-2">
              <FileTypeBadge extension={doc.extension} />
            </div>

            <div className="flex-[1.5] hidden md:block text-xs text-muted-foreground truncate pr-2">
              {currentFolderName ?? t("documents.myDrive")}
            </div>

            <div className="flex-[1.5] hidden lg:block text-xs text-muted-foreground truncate pr-2">
              {doc.owner_id === currentUserId ? t("documents.me") : (doc.uploader_name ?? t("documents.me"))}
            </div>

            <div className="flex-[1] hidden sm:block text-xs text-muted-foreground pr-2">
              {smartDate(doc.updated_at)}
            </div>

            <div className="flex-[1] hidden xl:block text-xs text-muted-foreground pr-2">
              {smartDate(doc.created_at)}
            </div>

            <div className="flex-[0.7] hidden sm:block text-xs text-muted-foreground pr-2">
              {formatFileSize(doc.file_size)}
            </div>

            <div className="w-8 flex-shrink-0 flex justify-end" onClick={(e) => e.stopPropagation()}>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors">
                    <MoreVertical className="w-3.5 h-3.5" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="rounded-xl shadow-lg py-1 min-w-[140px]">
                  <DropdownMenuItem className="px-3 py-2 text-xs gap-2" onClick={() => onDocumentView?.(doc)}>
                    <Eye className="size-3" />{t("common.preview")}
                  </DropdownMenuItem>
                  <DropdownMenuItem className="px-3 py-2 text-xs gap-2" onClick={() => onDocumentRename?.(doc)}>
                    <Pencil className="size-3" />{t("common.rename")}
                  </DropdownMenuItem>
                  <DropdownMenuItem className="px-3 py-2 text-xs gap-2" onClick={() => onDocumentShare?.(doc)}>
                    <Share2 className="size-3" />{t("common.share")}
                  </DropdownMenuItem>
                  <DropdownMenuItem className="px-3 py-2 text-xs gap-2" onClick={() => onDocumentDownload?.(doc)}>
                    <Download className="size-3" />{t("common.download")}
                  </DropdownMenuItem>
                  {doc.owner_id === currentUserId && (
                    <DropdownMenuItem className="px-3 py-2 text-xs gap-2" onClick={() => onDocumentMove?.(doc)}>
                      <FolderInput className="size-3" />{t("common.move")}
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="px-3 py-2 text-xs gap-2 text-destructive focus:bg-muted focus:text-destructive"
                    onClick={() => onDocumentDelete?.(doc)}
                  >
                    <Trash2 className="size-3 text-destructive" />{t("common.delete")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        ))}

        {isEmpty && (
          <div className="py-16 text-center text-sm text-muted-foreground">
            {t("documents.emptyState")}
          </div>
        )}
      </div>
    </div>
  );
}
