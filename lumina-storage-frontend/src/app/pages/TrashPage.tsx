import { useState, useMemo } from "react";
import { RotateCcw, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Document } from "../types/document";
import {
  useTrashDocuments,
  useRestoreDocument,
  usePermanentDeleteDocument,
  useBulkPermanentDelete,
} from "../hooks/useDocuments";
import { toast } from "sonner";
import { format } from "date-fns";
import {
  DataTable,
  type DataTableColumn,
} from "@/app/components/ui/data-table";
import { PaginationBar } from "@/app/components/user-role/PaginationBar";

export function TrashPage() {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const pageSize = 50;
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const params = {
    page,
    page_size: pageSize,
    sort_by: "updated_at" as const,
    sort_order: "desc" as const,
  };
  const { data, isLoading } = useTrashDocuments(params);
  const restoreDocument = useRestoreDocument();
  const permanentDelete = usePermanentDeleteDocument();
  const bulkPermanentDelete = useBulkPermanentDelete();

  const documents = data?.items ?? [];
  const totalPages = Math.ceil((data?.total ?? 0) / pageSize);

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleRestore = (doc: Document) => {
    const promise = restoreDocument.mutateAsync(doc.id);
    toast.promise(promise, {
      loading: t("trash.restoring", { title: doc.title }),
      success: t("trash.restored", { title: doc.title }),
      error: t("trash.restoreFailed"),
    });
  };

  const handlePermanentDelete = (doc: Document) => {
    if (
      !confirm(
        t("trash.confirmPermanentDelete", { title: doc.title })
      )
    )
      return;
    const promise = permanentDelete.mutateAsync(doc.id);
    toast.promise(promise, {
      loading: t("trash.permanentDeleting"),
      success: t("trash.permanentDeleted"),
      error: t("trash.deleteFailed"),
    });
  };

  const handleBulkPermanentDelete = () => {
    if (selectedIds.size === 0) return;
    if (
      !confirm(
        t("trash.confirmBulkPermanentDelete", { count: selectedIds.size })
      )
    )
      return;
    const promise = bulkPermanentDelete
      .mutateAsync(Array.from(selectedIds))
      .then((res) => {
        setSelectedIds(new Set());
        return res;
      });
    toast.promise(promise, {
      loading: t("trash.permanentDeleting"),
      success: (res) => t("trash.bulkPermanentDeleted", { count: res.deleted }),
      error: t("trash.deleteFailed"),
    });
  };

  const columns = useMemo<DataTableColumn<Document>[]>(
    () => [
      {
        key: "checkbox",
        header: (
          <input
            type="checkbox"
            checked={
              selectedIds.size === documents.length && documents.length > 0
            }
            onChange={() => {
              if (selectedIds.size === documents.length) {
                setSelectedIds(new Set());
              } else {
                setSelectedIds(new Set(documents.map((d) => d.id)));
              }
            }}
            className="h-4 w-4 cursor-pointer"
          />
        ),
        headerClassName: "w-10 px-4 py-3",
        cellClassName: "px-4 py-3",
        render: (doc) => (
          <input
            type="checkbox"
            checked={selectedIds.has(doc.id)}
            onChange={() => toggleSelect(doc.id)}
            className="h-4 w-4 cursor-pointer"
          />
        ),
      },
      {
        key: "stt",
        header: t("trash.no"),
        type: "stt" as const,
        sttOffset: (page - 1) * pageSize,
        headerClassName: "w-12 px-4 py-3",
        cellClassName: "w-12 px-4 py-3",
      },
      {
        key: "name",
        header: t("common.name"),
        headerClassName: "px-4 py-3",
        cellClassName: "px-4 py-3",
        render: (doc) => (
          <div>
            <span className="line-clamp-1 font-medium text-gray-900">
              {doc.title}
            </span>
            <span className="block text-xs text-gray-400">
              {doc.original_filename}
            </span>
          </div>
        ),
      },
      {
        key: "type",
        header: t("common.type"),
        type: "text" as const,
        field: (doc: Document) => doc.extension.replace(".", "").toUpperCase(),
        headerClassName: "px-4 py-3",
        cellClassName: "px-4 py-3 text-gray-500 text-xs",
        hiddenOnMobile: true,
      },
      {
        key: "deleted_at",
        header: t("trash.deletedAt"),
        type: "time" as const,
        field: (doc: Document) =>
          doc.deleted_at
            ? format(new Date(doc.deleted_at), "dd/MM/yyyy HH:mm")
            : null,
        headerClassName: "px-4 py-3",
        cellClassName: "px-4 py-3",
        hiddenOnMobile: true,
      },
      {
        key: "actions",
        header: t("common.actions"),
        headerClassName: "px-4 py-3 text-right",
        cellClassName: "px-4 py-3",
        render: (doc) => (
          <div className="flex items-center justify-end gap-2">
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleRestore(doc);
              }}
              disabled={restoreDocument.isPending}
              className="flex items-center gap-1 rounded-lg border border-blue-200 px-2.5 py-1.5 text-xs text-blue-600 transition-colors hover:bg-blue-50 disabled:opacity-50"
              title={t("trash.restore")}
            >
              <RotateCcw className="h-3.5 w-3.5" />
              {t("trash.restore")}
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                handlePermanentDelete(doc);
              }}
              disabled={permanentDelete.isPending}
              className="flex items-center gap-1 rounded-lg border border-red-200 px-2.5 py-1.5 text-xs text-red-600 transition-colors hover:bg-red-50 disabled:opacity-50"
              title={t("trash.deleteForever")}
            >
              <Trash2 className="h-3.5 w-3.5" />
              {t("trash.deleteForever")}
            </button>
          </div>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      selectedIds,
      documents,
      restoreDocument.isPending,
      permanentDelete.isPending,
      page,
      pageSize,
      t,
    ]
  );

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      {/* Header */}
      <div className="border-b border-gray-200 bg-white px-4 py-3 md:px-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 font-medium text-gray-900">
            <Trash2 className="h-5 w-5 text-gray-500" />
            {t("trash.title")}
          </div>
          {selectedIds.size > 0 && (
            <button
              onClick={handleBulkPermanentDelete}
              disabled={bulkPermanentDelete.isPending}
              className="flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-sm text-red-600 transition-colors hover:bg-red-100 disabled:opacity-50"
            >
              <Trash2 className="h-4 w-4" />
              {t("trash.bulkDeleteButton", { count: selectedIds.size })}
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto bg-gray-50">
        <div className="p-4 md:p-6">
          {!isLoading && documents.length === 0 ? (
            <div className="py-20 text-center">
              <Trash2 className="mx-auto mb-3 h-12 w-12 text-gray-300" />
              <p className="text-gray-500">{t("trash.empty")}</p>
            </div>
          ) : (
            <DataTable
              columns={columns}
              data={documents}
              rowKey={(doc) => doc.id}
              isLoading={isLoading}
              emptyMessage={t("trash.empty")}
              className="rounded-lg"
              footer={
                <PaginationBar
                  page={page}
                  totalPages={totalPages}
                  total={data?.total ?? 0}
                  pageSize={pageSize}
                  onPageChange={setPage}
                />
              }
            />
          )}
        </div>
      </div>
    </div>
  );
}
