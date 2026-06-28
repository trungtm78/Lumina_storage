import { useTranslation } from "react-i18next";
import {
  FileText,
  File,
  FileSpreadsheet,
  Image,
  MoreVertical,
} from "lucide-react";
import { Document } from "../types/document";
import { format } from "date-fns";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "./ui/table";
import { formatFileSize, getFileTypeFromExtension } from "../utils/formatters";

interface DocumentTableProps {
  documents: Document[];
  onDocumentClick: (document: Document) => void;
}

export function DocumentTable({
  documents,
  onDocumentClick,
}: DocumentTableProps) {
  const { t } = useTranslation();
  const getFileIcon = (extension: string) => {
    const fileType = getFileTypeFromExtension(extension);
    switch (fileType) {
      case "pdf":
        return <FileText className="text-brand-500 h-5 w-5" />;
      case "doc":
        return <File className="h-5 w-5 text-blue-500" />;
      case "xls":
        return <FileSpreadsheet className="h-5 w-5 text-green-500" />;
      case "image":
        return <Image className="h-5 w-5 text-purple-500" />;
      default:
        return <FileText className="h-5 w-5 text-gray-500" />;
    }
  };

  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
      <Table>
        <TableHeader>
          <TableRow className="bg-gray-50 hover:bg-gray-50">
            <TableHead className="w-[50%]">{t("common.name")}</TableHead>
            <TableHead className="w-[20%]">{t("common.type")}</TableHead>
            <TableHead className="w-[15%]">{t("common.size")}</TableHead>
            <TableHead className="w-[15%]">{t("common.createdAt")}</TableHead>
            <TableHead className="w-[50px]"></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {documents.map((doc) => (
            <TableRow
              key={doc.id}
              className="cursor-pointer hover:bg-gray-50"
              onClick={() => onDocumentClick(doc)}
            >
              <TableCell>
                <div className="flex items-center gap-3">
                  {getFileIcon(doc.extension)}
                  <div className="min-w-0">
                    <div className="truncate font-medium text-gray-900">
                      {doc.title || doc.original_filename}
                    </div>
                    <div className="text-xs text-gray-500">
                      {formatFileSize(doc.file_size)}
                    </div>
                  </div>
                </div>
              </TableCell>
              <TableCell>
                <span className="text-sm text-gray-700">
                  {doc.extension?.toUpperCase() || doc.mime_type}
                </span>
              </TableCell>
              <TableCell>
                <span className="text-sm text-gray-700">
                  {formatFileSize(doc.file_size)}
                </span>
              </TableCell>
              <TableCell>
                <span className="text-sm text-gray-600">
                  {format(new Date(doc.created_at), "MMM d, yyyy")}
                </span>
              </TableCell>
              <TableCell>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                  }}
                  className="rounded p-1 hover:bg-gray-100"
                >
                  <MoreVertical className="h-4 w-4 text-gray-500" />
                </button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
