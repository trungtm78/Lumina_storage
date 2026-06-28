import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  X,
  FileText,
  Calendar,
  User,
  FolderOpen,
  Share2,
  Folder as FolderIcon,
  Trash2,
} from "lucide-react";
import { Document } from "../../types/document";
import { Folder } from "../../types/folder";
import { formatFileSize } from "../../utils/formatters";
import { ShareDialog } from "./ShareDialog";

interface DocumentDetailPanelProps {
  item: Document | Folder | null;
  itemType: "document" | "folder" | null;
  open: boolean;
  onClose: () => void;
  onDelete?: (id: string, type: "document" | "folder", source_type?: string) => void;
}

export function DocumentDetailPanel({
  item,
  itemType,
  open,
  onClose,
  onDelete,
}: DocumentDetailPanelProps) {
  const { t } = useTranslation();
  const [shareOpen, setShareOpen] = useState(false);

  if (!open || !item) return null;

  const isFolder = itemType === "folder";
  const document = !isFolder ? (item as Document) : null;
  const folder = isFolder ? (item as Folder) : null;

  const title = isFolder
    ? folder!.name
    : document!.title || document!.original_filename;
  const created = isFolder ? folder!.created_at : document!.created_at;

  return (
    <div className="w-80 flex-shrink-0 overflow-hidden border-l border-gray-200 bg-white lg:w-1/4">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
        <h2 className="text-lg font-medium text-gray-900">{t("common.details")}</h2>
        <button
          onClick={onClose}
          className="text-gray-400 transition-colors hover:text-gray-600"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* Content */}
      <div className="h-[calc(100vh-137px)] overflow-y-auto">
        {/* Preview */}
        <div className="border-b border-gray-200 p-6">
          <div className="mb-4 flex aspect-video items-center justify-center rounded-lg bg-gray-100">
            {isFolder ? (
              <FolderIcon className="h-20 w-20 text-gray-500" />
            ) : (
              <FileText className="text-brand-500 h-20 w-20" />
            )}
          </div>
          <h3 className="text-base font-medium break-words text-gray-900">
            {title}
          </h3>
        </div>

        {/* Tabs */}
        <div className="border-b border-gray-200">
          <div className="flex">
            <button className="flex-1 border-b-2 border-blue-600 px-4 py-3 text-sm font-medium text-blue-600">
              {isFolder
                ? t("documents.folderDetails")
                : `${t("common.details")} ${document!.extension?.toUpperCase() || document!.mime_type}`}
            </button>
            {/* <button className="flex-1 px-4 py-3 text-sm font-medium text-gray-600 hover:text-gray-900">
              Hoạt động
            </button> */}
          </div>
        </div>

        {/* Details */}
        <div className="space-y-6 p-6">
          {/* Owner */}
          <div>
            <h4 className="mb-3 text-xs font-medium text-gray-500 uppercase">
              {t("documents.whoHasAccess")}
            </h4>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-orange-500 font-medium text-white">
                U
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium text-gray-900">{t("documents.me")}</p>
                <p className="text-xs text-gray-500">{t("documents.owner")}</p>
              </div>
            </div>
            <button
              onClick={() => setShareOpen(true)}
              className="mt-3 w-full rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
            >
              {t("documents.manageAccess")}
            </button>
            <ShareDialog
              open={shareOpen}
              onOpenChange={setShareOpen}
              resourceId={item.id}
              resourceType={isFolder ? "folder" : "document"}
              resourceName={
                isFolder ? (folder?.name ?? "") : (document?.title ?? "")
              }
            />
          </div>

          {/* Security Info */}
          <div className="rounded-lg bg-gray-50 p-4">
            <div className="flex items-start gap-3">
              <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-gray-200">
                <Share2 className="h-4 w-4 text-gray-600" />
              </div>
              <div>
                <p className="mb-1 text-sm font-medium text-gray-900">
                  {t("documents.securityRestriction")}
                </p>
                <p className="text-xs text-gray-600">
                  {isFolder
                    ? t("documents.noRestrictionFolder")
                    : t("documents.noRestrictionFile")}
                </p>
              </div>
            </div>
          </div>

          {/* File/Folder Properties */}
          <div>
            <h4 className="mb-3 text-xs font-medium text-gray-500 uppercase">
              {isFolder ? t("documents.folderDetails") : t("documents.fileDetails")}
            </h4>
            <div className="space-y-3">
              {/* Type */}
              <div className="flex items-center gap-3">
                {isFolder ? (
                  <FolderIcon className="h-4 w-4 text-gray-400" />
                ) : (
                  <FileText className="h-4 w-4 text-gray-400" />
                )}
                <div>
                  <p className="text-xs text-gray-500">{t("common.type")}</p>
                  <p className="text-sm text-gray-900">
                    {isFolder
                      ? t("documents.folder")
                      : document!.extension?.toUpperCase() ||
                        document!.mime_type}
                  </p>
                </div>
              </div>

              {/* Size - only for documents */}
              {!isFolder && (
                <div className="flex items-center gap-3">
                  <FileText className="h-4 w-4 text-gray-400" />
                  <div>
                    <p className="text-xs text-gray-500">{t("common.size")}</p>
                    <p className="text-sm text-gray-900">
                      {formatFileSize(document!.file_size)}
                    </p>
                  </div>
                </div>
              )}

              {/* Location */}
              <div className="flex items-center gap-3">
                <FolderOpen className="h-4 w-4 text-gray-400" />
                <div>
                  <p className="text-xs text-gray-500">{t("documents.location")}</p>
                  <p className="text-sm text-gray-900">
                    {isFolder
                      ? folder!.parent_id
                        ? folder!.path
                        : t("documents.title")
                      : document!.folder_id
                        ? document!.file_path
                        : t("documents.title")}
                  </p>
                </div>
              </div>

              {/* Owner */}
              <div className="flex items-center gap-3">
                <User className="h-4 w-4 text-gray-400" />
                <div>
                  <p className="text-xs text-gray-500">{t("documents.owner")}</p>
                  <p className="text-sm text-gray-900">{t("documents.me")}</p>
                </div>
              </div>

              {/* Created */}
              <div className="flex items-center gap-3">
                <Calendar className="h-4 w-4 text-gray-400" />
                <div>
                  <p className="text-xs text-gray-500">{t("common.createdAt")}</p>
                  <p className="text-sm text-gray-900">
                    {new Date(created).toLocaleDateString("vi-VN", {
                      day: "2-digit",
                      month: "2-digit",
                      year: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="space-y-2 border-t border-gray-200 pt-4">
            <button className="w-full rounded-lg border border-blue-600 px-4 py-2 text-sm font-medium text-blue-600 transition-colors hover:bg-blue-50">
              {t("documents.openInDrive")}
            </button>
            {onDelete && (
              <button
                onClick={() =>
                  onDelete(item.id, isFolder ? "folder" : "document", !isFolder ? (item as Document).source_type : undefined)
                }
                className="border-brand-300 text-brand-600 hover:bg-brand-50 flex w-full items-center justify-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium transition-colors"
              >
                <Trash2 className="h-4 w-4" />
                {isFolder ? t("documents.deleteFolder") : t("documents.deleteFile")}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
