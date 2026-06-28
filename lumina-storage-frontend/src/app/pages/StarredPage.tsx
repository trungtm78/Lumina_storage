import { useState } from "react";
import { Grid3x3, List, Loader2, Star } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Document } from "../types/document";
import { DocumentCard } from "../components/document/DocumentCard";
import { DocumentListView } from "../components/document/DocumentListView";
import { DocumentDetailPanel } from "../components/document/DocumentDetailPanel";
import { DocumentPreviewModal } from "../components/document/DocumentPreviewModal";
import {
  useDocuments,
  useDeleteDocument,
  useToggleStar,
} from "../hooks/useDocuments";
import { toast } from "sonner";
import { PaginationBar } from "@/app/components/ui/pagination-bar";

export function StarredPage() {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const pageSize = 50;
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [selectedDocument, setSelectedDocument] = useState<Document | null>(
    null
  );
  const [showDetailPanel, setShowDetailPanel] = useState(false);
  const [previewDocument, setPreviewDocument] = useState<Document | null>(null);
  const [showPreview, setShowPreview] = useState(false);

  const params = {
    page,
    page_size: pageSize,
    starred: true,
    sort_by: "updated_at" as const,
    sort_order: "desc" as const,
  };
  const { data, isLoading } = useDocuments(params);
  const deleteDocument = useDeleteDocument(params);
  const toggleStar = useToggleStar();

  const documents = data?.items ?? [];
  const totalPages = Math.ceil((data?.total ?? 0) / pageSize);

  const handleDeleteRequest = (id: string, _type: "document" | "folder") => {
    if (!confirm(t("starred.deleteConfirm"))) return;
    const promise = deleteDocument.mutateAsync(id);
    toast.promise(promise, {
      loading: t("starred.deleting"),
      success: t("starred.deleted"),
      error: t("starred.deleteFailed"),
    });
    setShowDetailPanel(false);
  };

  const handleToggleStar = (doc: Document, e: React.MouseEvent) => {
    e.stopPropagation();
    toggleStar.mutate(doc.id);
  };

  return (
    <>
      <div className="flex h-full min-w-0 flex-1 flex-col">
        {/* Header */}
        <div className="border-b border-gray-200 bg-white px-4 py-3 md:px-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 font-medium text-gray-900">
              <Star className="h-5 w-5 fill-yellow-400 text-yellow-400" />
              {t("starred.title")}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setViewMode("grid")}
                className={`rounded-lg p-2 transition-colors ${viewMode === "grid" ? "bg-gray-100 text-gray-900" : "text-gray-600 hover:bg-gray-50"}`}
              >
                <Grid3x3 className="h-5 w-5" />
              </button>
              <button
                onClick={() => setViewMode("list")}
                className={`rounded-lg p-2 transition-colors ${viewMode === "list" ? "bg-gray-100 text-gray-900" : "text-gray-600 hover:bg-gray-50"}`}
              >
                <List className="h-5 w-5" />
              </button>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto bg-gray-50">
          <div className="p-4 md:p-6">
            {isLoading ? (
              <div className="flex items-center justify-center py-20">
                <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
              </div>
            ) : documents.length === 0 ? (
              <div className="py-20 text-center">
                <Star className="mx-auto mb-3 h-12 w-12 text-gray-300" />
                <p className="text-gray-500">
                  {t("starred.empty")}
                </p>
              </div>
            ) : viewMode === "grid" ? (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4 xl:grid-cols-6">
                {documents.map((doc) => (
                  <div key={doc.id} className="group/card relative">
                    <button
                      onClick={(e) => handleToggleStar(doc, e)}
                      className="absolute top-1 right-8 z-10 rounded p-0.5 text-yellow-400 opacity-100"
                      title={t("documents.unstar")}
                    >
                      <Star className="h-4 w-4" fill="currentColor" />
                    </button>
                    <DocumentCard
                      document={doc}
                      onClick={(d) => {
                        setPreviewDocument(d);
                        setShowPreview(true);
                      }}
                      onMenuClick={(d) => {
                        setSelectedDocument(d);
                        setShowDetailPanel(true);
                      }}
                    />
                  </div>
                ))}
              </div>
            ) : (
              <DocumentListView
                documents={documents}
                folders={[]}
                onDocumentView={(d) => {
                  setSelectedDocument(d);
                  setShowDetailPanel(true);
                  setPreviewDocument(d);
                  setShowPreview(true);
                }}
                onFolderClick={() => {}}
                onFolderSelect={() => {}}
              />
            )}

            <PaginationBar
              page={page}
              totalPages={totalPages}
              total={data?.total ?? 0}
              pageSize={pageSize}
              onPageChange={setPage}
              className="mt-6 px-0"
            />
          </div>
        </div>
      </div>

      <DocumentDetailPanel
        item={selectedDocument}
        itemType="document"
        open={showDetailPanel}
        onClose={() => setShowDetailPanel(false)}
        onDelete={handleDeleteRequest}
      />

      <DocumentPreviewModal
        document={previewDocument}
        documents={documents}
        open={showPreview}
        onClose={() => setShowPreview(false)}
      />
    </>
  );
}
