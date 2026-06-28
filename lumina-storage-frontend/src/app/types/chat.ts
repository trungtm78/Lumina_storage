export interface ChatSessionResponse {
  id: string;
  user_id: string;
  title: string | null;
  created_at: string;
  updated_at: string;
}

export interface ChatSessionCreateRequest {
  title?: string;
}

export interface CitationSource {
  citation_index: number;
  document_id: string;
  document_title: string;
  original_filename: string;
  page_number: number | null;
  relevance_score: number;
  excerpt: string;
}

export interface SkillResult {
  rendered_document_id: string;
  preview_pdf_id: string | null;
  applied_count: number;
}

export interface ChatMessageResponse {
  id: string;
  session_id: string;
  role: "user" | "assistant";
  content: string;
  model_used: string | null;
  sources?: CitationSource[];
  skill_result?: SkillResult | null;
  attachments?:
    | { document_id: string; filename: string; extension: string }[]
    | null;
  created_at: string;
}

export interface ChatMessageCreateRequest {
  content: string;
  document_ids?: string[];
  model_id?: string;
  skill_document_id?: string;
}

export interface UpdateSessionRequest {
  title?: string;
}

export interface PaginatedSessionsResponse {
  items: ChatSessionResponse[];
  has_more: boolean;
}

export interface PaginatedMessagesResponse {
  items: ChatMessageResponse[];
  has_more: boolean;
}
