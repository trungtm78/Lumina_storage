import { useTranslation } from "react-i18next";
import {
  ArrowLeft,
  Download,
  Trash2,
  Edit2,
  FileText,
  Share2,
} from "lucide-react";
import { Document } from "../types/document";
import { format } from "date-fns";
import { Button } from "./ui/button";
import { toast } from "sonner";
import { formatFileSize, getFileTypeFromExtension } from "../utils/formatters";

interface DocumentDetailPageProps {
  document: Document;
  onBack: () => void;
  onEdit: () => void;
}

export function DocumentDetailPage({
  document,
  onBack,
  onEdit,
}: DocumentDetailPageProps) {
  const { t } = useTranslation();
  const handleDownload = () => {
    toast.success(t("documents.downloadingFile", { title: document.title }));
    setTimeout(() => {
      toast.success(t("documents.downloadComplete"));
    }, 1500);
  };

  const handleShare = () => {
    toast.info(t("documents.comingSoon"));
  };

  const handleDelete = () => {
    toast.error(t("documents.comingSoon"));
  };

  const fileType = getFileTypeFromExtension(document.extension);

  return (
    <div className="flex h-full flex-col bg-gray-50">
      {/* Header */}
      <div className="border-b border-gray-200 bg-white px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={onBack}
              className="rounded-lg p-2 transition-colors hover:bg-gray-100"
            >
              <ArrowLeft className="h-5 w-5 text-gray-600" />
            </button>
            <div>
              <h1 className="text-xl font-semibold text-gray-900">
                {document.title || document.original_filename}
              </h1>
              <p className="mt-0.5 text-sm text-gray-500">
                {format(new Date(document.created_at), "MMM d, yyyy")}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={handleShare}>
              <Share2 className="mr-2 h-4 w-4" />
              {t("common.share")}
            </Button>
            <Button variant="outline" size="sm" onClick={handleDownload}>
              <Download className="mr-2 h-4 w-4" />
              {t("common.download")}
            </Button>
            <Button
              onClick={onEdit}
              size="sm"
              className="bg-brand-500 hover:bg-brand-600 text-white"
            >
              <Edit2 className="mr-2 h-4 w-4" />
              {t("documents.edit")}
            </Button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-5xl p-6">
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            {/* Preview */}
            <div className="lg:col-span-2">
              <div className="rounded-xl border border-gray-200 bg-white p-8">
                <div className="flex aspect-[8.5/11] items-center justify-center rounded-lg border border-gray-200 bg-gray-50">
                  <div className="text-center">
                    <FileText className="mx-auto mb-4 h-24 w-24 text-gray-400" />
                    <p className="text-gray-500">{t("documents.documentPreview")}</p>
                    <p className="mt-1 text-sm text-gray-400">
                      {fileType.toUpperCase()}
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Metadata Sidebar */}
            <div className="space-y-4">
              <div className="rounded-xl border border-gray-200 bg-white p-4">
                <h2 className="mb-4 font-semibold text-gray-900">
                  {t("documents.information")}
                </h2>
                <div className="space-y-3 text-sm">
                  <div>
                    <div className="mb-1 text-xs font-semibold text-gray-500 uppercase">
                      {t("documents.fileType")}
                    </div>
                    <div className="font-medium text-gray-900">
                      {document.extension?.toUpperCase() || document.mime_type}
                    </div>
                  </div>

                  <div>
                    <div className="mb-1 text-xs font-semibold text-gray-500 uppercase">
                      {t("common.createdAt")}
                    </div>
                    <div className="text-gray-900">
                      {format(new Date(document.created_at), "MMMM d, yyyy")}
                    </div>
                  </div>

                  <div>
                    <div className="mb-1 text-xs font-semibold text-gray-500 uppercase">
                      {t("documents.fileSize")}
                    </div>
                    <div className="text-gray-900">
                      {formatFileSize(document.file_size)}
                    </div>
                  </div>

                  <div>
                    <div className="mb-1 text-xs font-semibold text-gray-500 uppercase">
                      {t("documents.filePath")}
                    </div>
                    <div className="font-mono text-xs break-all text-gray-900">
                      {document.file_path}
                    </div>
                  </div>
                </div>
              </div>

              {/* Actions */}
              <div className="rounded-xl border border-gray-200 bg-white p-4">
                <h2 className="mb-3 font-semibold text-gray-900">{t("common.actions")}</h2>
                <div className="space-y-2">
                  <Button
                    onClick={onEdit}
                    className="bg-brand-500 hover:bg-brand-600 w-full text-white"
                    size="sm"
                  >
                    <Edit2 className="mr-2 h-4 w-4" />
                    {t("documents.editMetadata")}
                  </Button>
                  <Button
                    onClick={handleDownload}
                    variant="outline"
                    size="sm"
                    className="w-full"
                  >
                    <Download className="mr-2 h-4 w-4" />
                    {t("common.download")}
                  </Button>
                  <Button
                    onClick={handleDelete}
                    variant="outline"
                    size="sm"
                    className="text-brand-600 hover:text-brand-700 hover:bg-brand-50 w-full"
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    {t("common.delete")}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
