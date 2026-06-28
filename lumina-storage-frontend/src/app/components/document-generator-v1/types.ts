// @ts-nocheck
import type { ComponentType } from 'react';

// --- Inlined types (from design lib) ---
export type WizardStep = 1 | 2 | 3;
export type WizardDocType = 'Sales Contract' | 'Purchase Contract' | 'NDA' | 'Internal Memo' | 'Proposal' | 'Report';
export type Step3Mode = 'manual' | 'ai' | 'batch';
export type DocStatus = 'Draft' | 'In Progress' | 'Completed' | 'Batch Generated';
export interface DocVersion { version: number; label: string; content: string; }
export interface PlaceholderField { key: string; label: string; value: string; }
export interface BatchRow { customer_name: string; company_address: string; legal_representative: string; effective_date: string; }
export interface ActivityEntry { id: string; action: string; timestamp: string; }
export interface DocVersionMeta { label: string; createdAt: string; }
export interface HistoryItem { id: string; title: string; type: WizardDocType; lastEdited: string; status: DocStatus; currentStep: WizardStep; activity: ActivityEntry[]; versions: DocVersionMeta[]; documentId?: string | null; templateId?: string | null; folderId?: string | null; fieldValues?: Record<string, string>; }

// --- Inlined data (from design data) ---
export interface DocTypeCard { type: WizardDocType; icon: ComponentType<{ className?: string }>; subtitle: string; color: string; iconColor: string; }

// ─── Saved Template Library cards (Chọn có sẵn) ─────────────────────────────
export type SavedTplCard = { id: string; name: string; tag: string; description: string; type: WizardDocType; folder?: string; updatedAt?: string };

// ─── Mock uploaded files (Lịch sử upload) ───────────────────────────────────
export type UploadedFileItem = { id: string; name: string; uploadedAt: string; size: string; type: string };

// ─── AI Diff types ──────────────────────────────────────────────────────────
export interface AiDiffSuggestion {
  id: string;
  searchText: string; // verbatim substring that must exist in baseDraft
  newText: string;
  status: 'pending' | 'accepted' | 'rejected';
}

// ─── AI đề xuất chỉnh sửa block-based (mức a) ────────────────────────────────
// Op kèm trạng thái duyệt + text trước/sau để hiển thị trong panel diff.
export interface BlockOpSuggestion {
  id: string;
  op: 'replace' | 'insert_after' | 'delete';
  block_id: string;
  beforeText: string;   // nội dung block hiện tại (rỗng khi insert)
  afterText: string;    // nội dung đề xuất (rỗng khi delete)
  kind?: 'paragraph' | 'heading' | 'list_item';
  status: 'pending' | 'accepted' | 'rejected';
}

// ─── Step 2 Props ─────────────────────────────────────────────────────────────
export interface Step2Props {
  docType: WizardDocType;
  versions: DocVersion[];
  onVersionsChange: (v: DocVersion[]) => void;
  onApproveDraft: (content: string, saveAsTemplate: boolean, templateTitle: string) => void;
  /** Optional template prefill: keys = field keys, values = autofill values. Triggers auto-draft. */
  initialPrefill?: Record<string, string>;
  /** Optional toast pusher injected by parent */
  pushToast?: (msg: string, type?: 'info' | 'success', duration?: number) => void;
  /** When editing an existing document, seed preview with this content and switch primary button to "Save". */
  editMode?: boolean;
  initialContent?: string;
  onSave?: (content: string) => void;
  /** Folders to choose from in the Create Document export popup */
  folders?: { id: string; name: string }[];
  /** Called after user confirms export format + folder in popup */
  onFinalize?: (
    content: string,
    format: 'PDF' | 'DOCX' | 'Excel',
    folderId: string,
    fieldValues?: Record<string, string>,
    opts?: { editedHtml?: string; sessionId?: string; skipValidation?: boolean },
  ) => void;
  /** AI-detected parameters (overrides FIELDS_BY_TYPE; enables param CRUD controls) */
  customParams?: { key: string; label: string }[];
  /** Template content to use as initial baseDraft (sets hasDraft=true immediately) */
  baseTemplate?: string;
  /** Template ID from backend — when provided, Step2 fetches real fields from API */
  templateId?: string;
  /** Fired whenever field values change — lets parent collect them for generate/session APIs */
  onFieldsChange?: (fieldValues: Record<string, string>) => void;
  /** Phase 2: id session đang làm việc (resume/edit) — để lưu version + generate từ bản sửa */
  sessionId?: string | null;
  /** Phase 2: gọi khi Step2 tự tạo session (lúc lưu version đầu tiên) */
  onSessionCreated?: (id: string) => void;
  /** Increment để trigger Step2 highlight các field còn trống (dùng từ exit dialog flow) */
  triggerHighlightEmpty?: number;
}

export type Step2Tab = 'edit' | 'version';
export type Step2FillMode = 'manual' | 'ai';

export interface MockComment {
  id: string;
  author: string;
  avatar: string;
  time: string;
  content: string;
}

export interface MockVersion {
  id: string;
  label: string;
  time: string;
  content: string;
}

// ─── Step 3 Props ─────────────────────────────────────────────────────────────
export interface Step3Props {
  docType: WizardDocType;
  templateContent: string;
  savedHistory: HistoryItem[];
  onSavedHistoryChange: (h: HistoryItem[]) => void;
}


// ─── Toast ────────────────────────────────────────────────────────────────────
export type ToastState = { id: number; message: string; type: 'info' | 'success' };

// ─── My Documents Drawer ──────────────────────────────────────────────────────
export type DetailTab = 'overview' | 'versions' | 'activity';

// ─── Full-screen Preview Overlay ─────────────────────────────────────────────
export interface FullPreviewOverlayProps {
  doc: HistoryItem;
  version?: string | null;
  onClose: () => void;
  onDownload: (doc: HistoryItem) => void;
}

// ─── Document Detail Panel ────────────────────────────────────────────────────
export interface DocDetailPanelProps {
  doc: HistoryItem;
  onClose: () => void;
  onResume: (doc: HistoryItem) => void;
  onDownload: (doc: HistoryItem) => void;
  onOpenPreview: (version?: string) => void;
}

// ─── Templates Management ────────────────────────────────────────────────────
export interface TemplateItem {
  id: string;
  name: string;
  description?: string;
  status: 'Active' | 'Draft';
  updatedAt: string;
  placeholders: string[];
  version: string;
}

// ─── Kho Tri Thuc fake data (file picker modal) ────────────────────────────────
export type KhoTriThucFileTab = 'recent' | 'mine' | 'shared';
export type KhoTriThucFile = { id: string; name: string; size: string; type: string; uploadedAt: string; tabs: KhoTriThucFileTab[] };

// ─── Saved Templates Sub-Tab ─────────────────────────────────────────────────
export interface SavedTemplatesPanelProps {
  onPick: (card: SavedTplCard) => void;
  onPickWithTemplate?: (card: SavedTplCard, params: { key: string; label: string }[], template: string, prefill?: Record<string, string>) => void;
  pushToast?: (msg: string, type?: 'info' | 'success', duration?: number) => void;
}

// ─── Main Component ───────────────────────────────────────────────────────────
export type TopTab = 'create' | 'templates';

export interface DocFolder { id: string; name: string }
