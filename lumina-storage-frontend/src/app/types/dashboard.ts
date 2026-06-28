export interface StorageBreakdown {
  documents_bytes: number;
  spreadsheets_bytes: number;
  presentations_bytes: number;
  other_bytes: number;
}

export interface DashboardStats {
  storage: {
    used_bytes: number;
    max_gb: number;
    breakdown: StorageBreakdown;
  };
  processing: {
    total: number;
    processing: number;
    completed: number;
    failed: number;
    queued: number;
  };
  shared: {
    total: number;
    shared_by_me: number;
    shared_with_me: number;
  };
  documents: {
    total: number;
    added_today: number;
    added_this_week: number;
    added_this_month: number;
  };
  activity: {
    total_today: number;
    uploaded_today: number;
    viewed_today: number;
    shared_today: number;
  };
}

export interface ProcessingFile {
  id: string;
  document_id: string | null;
  file_name: string;
  extension: string;
  status: string;
  created_at: string;
}

export interface RecentFile {
  id: string;
  title: string;
  extension: string;
  owner_name: string | null;
  updated_at: string;
}

export interface SharedFile {
  id: string;
  title: string;
  extension: string;
  owner_name: string | null;
  updated_at: string;
}
