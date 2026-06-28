import type { FolderResponse } from "./folderApi";

export interface DocumentResponse {
  id: string;
  title: string;
  description: string | null;
  file_name: string;
  original_filename: string;
  file_path: string;
  file_size: number;
  mime_type: string;
  extension: string;
  checksum: string;
  folder_id: string | null;
  storage_config_id: string;
  owner_id: string | null;
  uploader_name: string | null;
  source_type: string;
  source_metadata: Record<string, unknown> | null;
  starred: boolean;
  page_count: number | null;
  processing_status: "pending" | "processing" | "completed" | "failed";
  image_thumbnail: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface DocumentListParams {
  page?: number;
  page_size?: number;
  folder_id?: string | null;
  extensions?: string[];
  uploader_id?: string;
  sort_by?: "updated_at" | "created_at";
  sort_order?: "asc" | "desc";
  start_date?: string;
  end_date?: string;
  q?: string;
  search_mode?: "keyword" | "semantic";
  starred?: boolean;
  shared_with_me?: boolean;
  source_type?: string;
}

export interface TrashListParams {
  page?: number;
  page_size?: number;
  sort_by?: "updated_at" | "created_at";
  sort_order?: "asc" | "desc";
}

export interface DocumentUploadFolderResponse {
  documents: DocumentResponse[];
  folder: FolderResponse;
}
