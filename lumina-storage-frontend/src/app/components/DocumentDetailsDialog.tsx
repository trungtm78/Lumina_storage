import { X, FileText, Download, Trash2, Edit } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Document } from "../types/document";
import { format } from "date-fns";
import { Button } from "./ui/button";
import { toast } from "sonner";
import { useState } from "react";
import { formatFileSize, getFileTypeFromExtension } from "../utils/formatters";

interface DocumentDetailsDialogProps {
  document: Document | null;
  isOpen: boolean;
  onClose: () => void;
  onEdit: () => void;
}

export function DocumentDetailsDialog({
  document,
  isOpen,
  onClose,
  onEdit,
}: DocumentDetailsDialogProps) {
  const { t } = useTranslation();
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  if (!isOpen || !document) return null;

  const handleDownload = () => {
    toast.success(t("documents.downloadingFile", { title: document.title }));
    setTimeout(() => {
      toast.success(t("documents.downloadComplete"));
    }, 1500);
  };

  const handleDeleteConfirm = () => {
    setShowDeleteDialog(false);
    onClose();
    toast.success(t("documents.toasts.deleted"));
  };

  return (
    <>
      <div className="flex w-80 flex-col overflow-hidden border-l border-gray-200 bg-white">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
          <h2 className="text-base font-semibold text-gray-900">{t("common.details")}</h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 transition-colors hover:bg-gray-100"
          >
            <X className="h-5 w-5 text-gray-500" />
          </button>
        </div>

        {/* Content - Scrollable */}
        <div className="flex-1 overflow-y-auto">
          {/* Preview */}
          <div className="border-b border-gray-200 px-4 py-6">
            <div className="flex aspect-[4/3] items-center justify-center rounded-lg border border-gray-200 bg-gray-50">
              <FileText className="h-16 w-16 text-gray-400" />
            </div>
          </div>

          {/* File Name */}
          <div className="border-b border-gray-200 px-4 py-4">
            <div className="text-sm font-medium break-words text-gray-900">
              {document.title || document.original_filename}
            </div>
          </div>

          {/* Details Section */}
          <div className="space-y-4 px-4 py-4">
            {/* File Type */}
            <div>
              <div className="mb-1 text-xs font-semibold text-gray-500 uppercase">
                {t("documents.fileType")}
              </div>
              <div className="text-sm text-gray-900">
                {document.extension?.toUpperCase() || document.mime_type}
              </div>
            </div>

            {/* File Information */}
            <div>
              <div className="mb-1 text-xs font-semibold text-gray-500 uppercase">
                {t("documents.fileInfo")}
              </div>
              <div className="space-y-1 text-sm text-gray-700">
                <div className="flex justify-between">
                  <span className="text-gray-500">{t("common.size")}:</span>
                  <span>{formatFileSize(document.file_size)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">{t("common.type")}:</span>
                  <span>
                    {getFileTypeFromExtension(document.extension).toUpperCase()}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">{t("common.createdAt")}:</span>
                  <span>
                    {format(new Date(document.created_at), "MMM d, yyyy")}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Actions Footer */}
        <div className="space-y-2 border-t border-gray-200 px-4 py-3">
          <Button
            onClick={() => {
              onEdit();
              onClose();
            }}
            className="bg-brand-500 hover:bg-brand-600 w-full text-white"
            size="sm"
          >
            <Edit className="mr-2 h-4 w-4" />
            {t("documents.editMetadata")}
          </Button>
          <div className="flex gap-2">
            <Button
              onClick={handleDownload}
              variant="outline"
              className="flex-1"
              size="sm"
            >
              <Download className="mr-2 h-4 w-4" />
              {t("common.download")}
            </Button>
            <Button
              onClick={() => setShowDeleteDialog(true)}
              variant="outline"
              className="text-brand-600 hover:text-brand-700 hover:bg-brand-50 flex-1"
              size="sm"
            >
              <Trash2 className="mr-2 h-4 w-4" />
              {t("common.delete")}
            </Button>
          </div>
        </div>
      </div>

      {/* Delete Confirmation Popup */}
      {showDeleteDialog && (
        <>
          <div
            className="fixed inset-0 z-[60] bg-black/50"
            onClick={() => setShowDeleteDialog(false)}
          />
          <div className="fixed top-1/2 left-1/2 z-[70] w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl bg-white p-6 shadow-2xl">
            <h3 className="mb-2 text-lg font-semibold text-gray-900">
              {t("documents.deleteConfirmTitle")}
            </h3>
            <p className="mb-6 text-sm text-gray-600">
              {t("documents.deleteFileConfirm", { title: document.title })}
            </p>
            <div className="flex justify-end gap-3">
              <Button
                onClick={() => setShowDeleteDialog(false)}
                variant="outline"
                size="sm"
              >
                {t("common.cancel")}
              </Button>
              <Button
                onClick={handleDeleteConfirm}
                className="bg-brand-600 hover:bg-brand-700 text-white"
                size="sm"
              >
                {t("common.delete")}
              </Button>
            </div>
          </div>
        </>
      )}
    </>
  );
}
