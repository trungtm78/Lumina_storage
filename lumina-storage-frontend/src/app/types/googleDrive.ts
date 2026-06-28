export interface GoogleDriveImportResponse {
  id: string;
  drive_file_id: string;
  drive_file_name: string;
  drive_url: string;
  mime_type: string;
  status: "pending" | "done" | "failed";
  document_id: string | null;
  error_message: string | null;
  created_at: string;
  completed_at: string | null;
}

export interface GoogleDriveImportRequest {
  url: string;
  folder_id?: string;
}
