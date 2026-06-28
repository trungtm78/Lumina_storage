import { http } from "@/app/api/http";
import { API_ENDPOINTS } from "@/app/api/endpoints";

// ─── Enums / Literals ────────────────────────────────────────────────────────

export type ReviewType =
  | "Legal"
  | "Business"
  | "Financial"
  | "Admin"
  | "Compliance"
  | "Custom";
export type DocSource = "drive" | "upload" | "url";
export type TemplateSource = "drive" | "upload";
export type HighlightSeverity = "pass" | "warning" | "risk";
export type RiskLevel = "safe" | "low" | "medium" | "high" | "very_high";

// ─── Checklist ───────────────────────────────────────────────────────────────

/** Category dùng để nhóm checklist items theo spec §7 */
export type ChecklistCategory =
  | "Format"
  | "Thông tin"
  | "Pháp lý"
  | "Nghĩa vụ"
  | "Quyền lợi"
  | "Thanh toán"
  | "Phạt vi phạm"
  | "Thời hạn"
  | "Rủi ro"
  | "Tóm tắt"
  | "So sánh";

export interface ReviewChecklistItem {
  id: string;
  label: string;
  checked: boolean;
  /** Nhóm hiển thị trong checklist panel */
  category?: ChecklistCategory;
  /** Helper text hiển thị dưới dạng tooltip */
  description?: string;
}

export interface ChecklistResult {
  id: string;
  label: string;
  passed: boolean;
  /** 3-state kết quả theo BRD: pass / warning / risk. Fallback về passed nếu BE cũ chưa trả. */
  status?: "pass" | "warning" | "risk";
  /** Nhận xét chi tiết của AI cho từng mục checklist */
  note?: string;
  anchorKeyword?: string;
}

// ─── Highlight + Fix ─────────────────────────────────────────────────────────

export type HighlightType = "analysis" | "compare" | "reference";

export interface DocHighlight {
  keyword: string;
  severity: HighlightSeverity;
  tooltip: string;
  severity_label: "low" | "medium" | "high";
  highlight_type?: HighlightType;
  /** ID của edit hoặc checklist item tương ứng — dùng để link highlight ↔ sidebar card */
  ref_id?: string;
  /** Keyword ngôn ngữ phụ (EN) tương ứng — dùng để highlight song song */
  bilingual_keyword?: string | null;
}

export interface FixSuggestion {
  issueIndex: number;
  suggestion: string;
}

// ─── Per-edit evaluation (Phase 6 — GotIt B2B Legal workflow w2) ───────────

export type EditVerdict = "agree" | "disagree";
export type RiskLevelEdit = "high" | "medium" | "low";

export interface EditEvaluation {
  id: string;
  clause_name: string;
  original_text: string;
  modified_text: string;
  anchor_text?: string;
  verdict: EditVerdict;
  reason: string;
  suggested_text: string;
  risk_level: RiskLevelEdit;
  suggestion_category?: "improve" | "reduce" | "rewrite";
  /** False nếu backend không tìm được modified_text trong tài liệu gốc */
  verbatim_match?: boolean;
  /** Bilingual fields — tài liệu song ngữ Việt–Anh */
  bilingual_anchor_text?: string | null;
  bilingual_modified_text?: string | null;
  bilingual_suggested_text?: string | null;
  is_quick_action?: boolean;
}

// ─── Comparison ─────────────────────────────────────────────────────────────

export interface ComparisonResult {
  is_identical?: boolean;
  differences: string[];
  missingClauses: string[];
  conflictTerms: string[];
  edits: EditEvaluation[];
}

// ─── Reference Results (spec §5.3 UG) ────────────────────────────────────────

export interface ReferenceFinding {
  text: string;
  anchorKeyword?: string | null;
}

export interface ReferenceResult {
  reference_name: string;
  findings: ReferenceFinding[];
}

// ─── Key Information Extract (spec §9) ───────────────────────────────────────

export interface KeyInfoItem {
  /** Nhóm thông tin (Parties, Financial, Payment, …) */
  group: string;
  /** Giá trị extract được; null = "Không tìm thấy" */
  value: string | null;
}

// ─── AnalysisResult ──────────────────────────────────────────────────────────

export interface AnalysisResult {
  summary: string;
  riskExplanation: string;
  keyIssues: string[];
  missingItems: string[];
  suggestions: string[];
  checklist: ChecklistResult[];
  riskScore: number;
  highlights: DocHighlight[];
  fixes: FixSuggestion[];
  comparison?: ComparisonResult;
  /** Thông tin trích xuất tự động từ tài liệu (spec §9) */
  keyInformation?: KeyInfoItem[];
  /** Lỗi format, chính tả, nhất quán được phát hiện (spec §8) */
  detectedErrors?: string[];
  /** Kết quả đối chiếu tài liệu tham chiếu nội bộ (UG §5.3) */
  referenceResults?: ReferenceResult[];
  riskFactors?: string[];
  /** Phân tích rủi ro theo danh mục với điểm số và vấn đề cụ thể */
  riskBreakdown?: Array<{
    category: string;
    score: number;
    issues: string[];
  }>;
  /** Timeline sự kiện của phiên review — được persist để reopen */
  sessionEvents?: { id: string; type: string; label: string; timestamp: string }[];
  /** Cảnh báo khi tài liệu bị cắt do vượt giới hạn ký tự phân tích */
  truncation_warning?: string;
  /** Tài liệu song ngữ Việt–Anh — khi true, mỗi edit có cả VI lẫn EN fields */
  is_bilingual?: boolean;
  /** Kết quả quick action cuối cùng — persist để khôi phục khi reopen/switch version */
  quickActionResult?: QuickActionResult;
  /** Hướng dẫn bổ sung từ Step 2 — persist để khôi phục context khi reopen/switch version */
  additionalRequirements?: string;
  _appliedEdits?: Record<string, { suggested: string; riskLevel: string; clauseName?: string }>;
}

export interface ReviewReport extends AnalysisResult {
  job_id: string;
  document_name: string;
  review_type: ReviewType;
  created_at: string;
}

// ─── Request config ──────────────────────────────────────────────────────────

export interface ReviewConfig {
  document_id: string;
  doc_source: DocSource;
  source_url?: string;
  review_type: ReviewType;
  checklist_item_ids: string[];
  compare_enabled: boolean;
  compare_document_ids?: string[];
  template_source?: TemplateSource;
  additional_requirements?: string;
  reference_enabled?: boolean;
  reference_doc_ids?: string[];
  reference_content?: string;
}

export type QuickActionType = "improve" | "optimize" | "reduce";

export interface QuickActionSuggestedEdit {
  clause_name: string;
  modified_text: string;
  suggested_text: string;
  reason: string;
  risk_level: string;
  verdict?: string;
  anchor_text?: string;
  bilingual_modified_text?: string | null;
  bilingual_suggested_text?: string | null;
  bilingual_anchor_text?: string | null;
}

export interface QuickActionResult {
  type: QuickActionType;
  summary: string;
  newScore: number;
  suggested_edits?: QuickActionSuggestedEdit[];
  /** Câu hỏi/yêu cầu của user — persist để hiển thị lại khi xem version cũ */
  userInstruction?: string;
}

// ─── Checklist presets per review type ───────────────────────────────────────
// Cấu trúc theo spec §7: 11 nhóm category với label + description tooltip

export const REVIEW_CHECKLISTS: Record<ReviewType, ReviewChecklistItem[]> = {
  Legal: [
    {
      id: "l-fmt-1",
      label: "Không có lỗi chính tả hoặc diễn đạt",
      checked: false,
      category: "Format",
      description:
        "AI kiểm tra lỗi ngữ pháp, chính tả và cách dùng từ trong văn bản pháp lý.",
    },
    {
      id: "l-inf-1",
      label: "Tên công ty và người đại diện hợp lệ",
      checked: false,
      category: "Thông tin",
      description:
        "Kiểm tra tên đầy đủ, MST, địa chỉ và thông tin đại diện có nhất quán không.",
    },
    {
      id: "l-inf-2",
      label: "Ngày ký và ngày hiệu lực rõ ràng",
      checked: false,
      category: "Thông tin",
      description: "Xác định ngày ký, ngày có hiệu lực và thời hạn hợp đồng.",
    },
    {
      id: "l-leg-1",
      label: "Điều khoản pháp lý đầy đủ và hợp lệ",
      checked: false,
      category: "Pháp lý",
      description:
        "Rà soát toàn bộ điều khoản pháp lý, phát hiện điều khoản mơ hồ hoặc bất lợi.",
    },
    {
      id: "l-leg-2",
      label: "Luật áp dụng và thẩm quyền xét xử",
      checked: false,
      category: "Pháp lý",
      description:
        "Kiểm tra điều khoản về luật áp dụng và cơ quan giải quyết tranh chấp.",
    },
    {
      id: "l-obl-1",
      label: "Nghĩa vụ các bên được xác định rõ",
      checked: false,
      category: "Nghĩa vụ",
      description:
        "Đánh giá tính cân bằng và rõ ràng của trách nhiệm từng bên.",
    },
    {
      id: "l-ben-1",
      label: "Quyền lợi các bên hợp lý",
      checked: false,
      category: "Quyền lợi",
      description: "Kiểm tra quyền lợi không bị thiếu hoặc bất cân xứng.",
    },
    {
      id: "l-pay-1",
      label: "Điều khoản thanh toán rõ ràng",
      checked: false,
      category: "Thanh toán",
      description:
        "Xác minh số tiền, kỳ hạn, phương thức và điều kiện thanh toán.",
    },
    {
      id: "l-pen-1",
      label: "Điều khoản phạt vi phạm hợp lý",
      checked: false,
      category: "Phạt vi phạm",
      description: "Đánh giá mức phạt, điều kiện kích hoạt và tính cân đối.",
    },
    {
      id: "l-tim-1",
      label: "Thời hạn hợp đồng và gia hạn",
      checked: false,
      category: "Thời hạn",
      description:
        "Kiểm tra thời hạn, điều kiện gia hạn tự động và chấm dứt sớm.",
    },
    {
      id: "l-ris-1",
      label: "Điều khoản bất lợi được nhận diện",
      checked: false,
      category: "Rủi ro",
      description:
        "Phát hiện điều khoản có thể gây rủi ro pháp lý hoặc tài chính.",
    },
    {
      id: "l-sum-1",
      label: "Tóm tắt nội dung chính xác",
      checked: false,
      category: "Tóm tắt",
      description: "AI tóm tắt mục tiêu, phạm vi và bản chất giao dịch.",
    },
    {
      id: "l-cmp-1",
      label: "So sánh với template chuẩn",
      checked: false,
      category: "So sánh",
      description:
        "Chỉ khả dụng khi có tài liệu đối chiếu. So sánh điều khoản và phát hiện sai lệch.",
    },
  ],
  Business: [
    {
      id: "b-fmt-1",
      label: "Format và cấu trúc nhất quán",
      checked: false,
      category: "Format",
      description: "Kiểm tra heading, bullet, bảng biểu và định dạng tổng thể.",
    },
    {
      id: "b-inf-1",
      label: "Thông tin công ty và liên hệ đầy đủ",
      checked: false,
      category: "Thông tin",
      description:
        "Xác nhận tên, địa chỉ, người liên hệ và thông tin doanh nghiệp.",
    },
    {
      id: "b-inf-2",
      label: "Giá trị hợp đồng và số liệu nhất quán",
      checked: false,
      category: "Thông tin",
      description:
        "Kiểm tra tính nhất quán của con số, đơn vị tiền tệ và tỷ lệ.",
    },
    {
      id: "b-obl-1",
      label: "Deliverables và KPI được xác định rõ",
      checked: false,
      category: "Nghĩa vụ",
      description:
        "Đảm bảo phạm vi công việc, sản phẩm bàn giao và tiêu chí nghiệm thu rõ ràng.",
    },
    {
      id: "b-ben-1",
      label: "Quyền lợi và ưu đãi hợp lý",
      checked: false,
      category: "Quyền lợi",
      description: "Kiểm tra tính cạnh tranh và rõ ràng của quyền lợi đề xuất.",
    },
    {
      id: "b-pay-1",
      label: "Cấu trúc giá và điều khoản thanh toán",
      checked: false,
      category: "Thanh toán",
      description:
        "Rà soát breakdown chi phí, lịch thanh toán và điều kiện kích hoạt.",
    },
    {
      id: "b-tim-1",
      label: "Timeline và milestone cụ thể",
      checked: false,
      category: "Thời hạn",
      description: "Xác minh các mốc thời gian, deadline và điều kiện gia hạn.",
    },
    {
      id: "b-ris-1",
      label: "Rủi ro kinh doanh được đánh giá",
      checked: false,
      category: "Rủi ro",
      description:
        "Nhận diện điều khoản có thể ảnh hưởng xấu đến doanh nghiệp.",
    },
    {
      id: "b-sum-1",
      label: "Executive summary đầy đủ",
      checked: false,
      category: "Tóm tắt",
      description:
        "Kiểm tra tóm tắt có phản ánh đúng toàn bộ nội dung tài liệu không.",
    },
    {
      id: "b-cmp-1",
      label: "So sánh với đề xuất tham chiếu",
      checked: false,
      category: "So sánh",
      description: "So sánh với proposal chuẩn hoặc phiên bản trước.",
    },
  ],
  Financial: [
    {
      id: "f-fmt-1",
      label: "Format số liệu nhất quán",
      checked: false,
      category: "Format",
      description:
        "Kiểm tra đơn vị tiền tệ, định dạng số, cách làm tròn và ký hiệu phân cách.",
    },
    {
      id: "f-inf-1",
      label: "Thông tin thanh toán đầy đủ",
      checked: false,
      category: "Thông tin",
      description:
        "Xác nhận số tài khoản, ngân hàng, tên thụ hưởng và thông tin chuyển khoản.",
    },
    {
      id: "f-inf-2",
      label: "Số tiền khớp giữa các phần",
      checked: false,
      category: "Thông tin",
      description:
        "Kiểm tra tổng tiền, subtotal, thuế và số tiền cuối có nhất quán không.",
    },
    {
      id: "f-pay-1",
      label: "Điều khoản thanh toán và kỳ hạn rõ ràng",
      checked: false,
      category: "Thanh toán",
      description:
        "Kiểm tra payment term (Net 30/60/90), điều kiện early payment và late fee.",
    },
    {
      id: "f-pen-1",
      label: "Phí phạt trả chậm hợp lý",
      checked: false,
      category: "Phạt vi phạm",
      description: "Đánh giá mức phạt trả chậm, lãi suất và ngưỡng kích hoạt.",
    },
    {
      id: "f-tim-1",
      label: "Ngày đáo hạn và lịch thanh toán",
      checked: false,
      category: "Thời hạn",
      description: "Xác minh due date, payment schedule và điều kiện gia hạn.",
    },
    {
      id: "f-ris-1",
      label: "Rủi ro tài chính được nhận diện",
      checked: false,
      category: "Rủi ro",
      description:
        "Phát hiện sai lệch số liệu, điều khoản bất lợi hoặc mơ hồ về tài chính.",
    },
    {
      id: "f-sum-1",
      label: "Tóm tắt tài chính chính xác",
      checked: false,
      category: "Tóm tắt",
      description:
        "AI tóm tắt tổng giá trị, cấu trúc thanh toán và điều khoản quan trọng.",
    },
    {
      id: "f-cmp-1",
      label: "So sánh với hóa đơn / PO gốc",
      checked: false,
      category: "So sánh",
      description:
        "Đối chiếu với PO, hợp đồng gốc hoặc báo giá để phát hiện sai lệch.",
    },
  ],
  Admin: [
    {
      id: "a-fmt-1",
      label: "Format văn bản đúng chuẩn hành chính",
      checked: false,
      category: "Format",
      description:
        "Kiểm tra tiêu đề, số hiệu, ngày tháng, chữ ký và định dạng theo mẫu hành chính.",
    },
    {
      id: "a-fmt-2",
      label: "Không có lỗi chính tả hoặc diễn đạt",
      checked: false,
      category: "Format",
      description:
        "Rà soát toàn bộ lỗi ngôn ngữ, lỗi đánh máy và cách dùng từ.",
    },
    {
      id: "a-inf-1",
      label: "Thông tin cơ quan và đơn vị đầy đủ",
      checked: false,
      category: "Thông tin",
      description:
        "Kiểm tra tên đơn vị, địa chỉ, người ký và thông tin liên lạc.",
    },
    {
      id: "a-obl-1",
      label: "Trách nhiệm thực hiện rõ ràng",
      checked: false,
      category: "Nghĩa vụ",
      description:
        "Xác định đơn vị/cá nhân chịu trách nhiệm và thời hạn thực hiện.",
    },
    {
      id: "a-tim-1",
      label: "Thời hạn hiệu lực và thực hiện",
      checked: false,
      category: "Thời hạn",
      description:
        "Kiểm tra ngày ban hành, ngày có hiệu lực và thời hạn hoàn thành.",
    },
    {
      id: "a-ris-1",
      label: "Nội dung không gây hiểu nhầm",
      checked: false,
      category: "Rủi ro",
      description: "Đánh giá các đoạn văn có thể gây nhầm lẫn hoặc mâu thuẫn.",
    },
    {
      id: "a-sum-1",
      label: "Tóm tắt nội dung và yêu cầu",
      checked: false,
      category: "Tóm tắt",
      description:
        "AI tóm tắt mục đích, yêu cầu hành động và đối tượng thực hiện.",
    },
  ],
  Compliance: [
    {
      id: "c-fmt-1",
      label: "Cấu trúc chính sách đúng chuẩn",
      checked: false,
      category: "Format",
      description:
        "Kiểm tra tính đầy đủ của mục lục, phần định nghĩa và phụ lục.",
    },
    {
      id: "c-inf-1",
      label: "Phạm vi áp dụng được xác định rõ",
      checked: false,
      category: "Thông tin",
      description:
        "Kiểm tra đối tượng áp dụng, phạm vi địa lý và thời gian hiệu lực.",
    },
    {
      id: "c-leg-1",
      label: "Tuân thủ quy định pháp luật hiện hành",
      checked: false,
      category: "Pháp lý",
      description:
        "Đối chiếu nội dung với các quy định pháp luật liên quan (Luật, Nghị định, Thông tư).",
    },
    {
      id: "c-leg-2",
      label: "Không có điều khoản vi phạm pháp luật",
      checked: false,
      category: "Pháp lý",
      description:
        "Phát hiện điều khoản có thể trái pháp luật hoặc xung đột với quy định hiện hành.",
    },
    {
      id: "c-obl-1",
      label: "Nghĩa vụ tuân thủ của các bên",
      checked: false,
      category: "Nghĩa vụ",
      description:
        "Xác định rõ ai phải làm gì, quy trình báo cáo và chịu trách nhiệm.",
    },
    {
      id: "c-pen-1",
      label: "Hậu quả và chế tài vi phạm",
      checked: false,
      category: "Phạt vi phạm",
      description:
        "Đánh giá tính rõ ràng và hợp lý của các hình thức xử lý vi phạm.",
    },
    {
      id: "c-tim-1",
      label: "Thời hạn review và cập nhật chính sách",
      checked: false,
      category: "Thời hạn",
      description:
        "Kiểm tra chu kỳ review, điều kiện cập nhật và phiên bản hiệu lực.",
    },
    {
      id: "c-ris-1",
      label: "Rủi ro tuân thủ được nhận diện",
      checked: false,
      category: "Rủi ro",
      description:
        "Phát hiện điều khoản thiếu hoặc mơ hồ có thể dẫn đến vi phạm không chủ ý.",
    },
    {
      id: "c-sum-1",
      label: "Tóm tắt các nghĩa vụ tuân thủ",
      checked: false,
      category: "Tóm tắt",
      description: "AI tổng hợp danh sách nghĩa vụ và hành động cần thực hiện.",
    },
    {
      id: "c-cmp-1",
      label: "So sánh với phiên bản chính sách cũ",
      checked: false,
      category: "So sánh",
      description: "Đối chiếu với phiên bản trước để xác định điểm thay đổi.",
    },
  ],
  Custom: [
    {
      id: "x-fmt-1",
      label: "Lỗi chính tả và format",
      checked: false,
      category: "Format",
      description: "AI kiểm tra lỗi ngôn ngữ, định dạng và cấu trúc trình bày.",
    },
    {
      id: "x-inf-1",
      label: "Thông tin công ty, MST, địa chỉ",
      checked: false,
      category: "Thông tin",
      description: "Extract và kiểm tra thông tin định danh của các bên.",
    },
    {
      id: "x-inf-2",
      label: "Số tiền và ngày tháng",
      checked: false,
      category: "Thông tin",
      description:
        "Xác minh các con số tài chính và mốc thời gian trong tài liệu.",
    },
    {
      id: "x-leg-1",
      label: "Điều khoản pháp lý và rủi ro",
      checked: false,
      category: "Pháp lý",
      description:
        "Rà soát các điều khoản có tính pháp lý và nhận diện rủi ro.",
    },
    {
      id: "x-obl-1",
      label: "Trách nhiệm các bên",
      checked: false,
      category: "Nghĩa vụ",
      description:
        "Kiểm tra sự phân chia trách nhiệm và nghĩa vụ có rõ ràng không.",
    },
    {
      id: "x-ben-1",
      label: "Quyền lợi các bên",
      checked: false,
      category: "Quyền lợi",
      description: "Đánh giá tính hợp lý và đầy đủ của quyền lợi các bên.",
    },
    {
      id: "x-pay-1",
      label: "Điều khoản thanh toán",
      checked: false,
      category: "Thanh toán",
      description: "Kiểm tra điều kiện, kỳ hạn và phương thức thanh toán.",
    },
    {
      id: "x-pen-1",
      label: "Điều khoản phạt vi phạm",
      checked: false,
      category: "Phạt vi phạm",
      description: "Đánh giá mức phạt và điều kiện kích hoạt có hợp lý không.",
    },
    {
      id: "x-tim-1",
      label: "Thời hạn hợp đồng",
      checked: false,
      category: "Thời hạn",
      description: "Kiểm tra thời gian hiệu lực, gia hạn và chấm dứt.",
    },
    {
      id: "x-ris-1",
      label: "Điều khoản bất lợi",
      checked: false,
      category: "Rủi ro",
      description: "Nhận diện điều khoản có thể gây bất lợi cho một bên.",
    },
    {
      id: "x-sum-1",
      label: "Tóm tắt nội dung tài liệu",
      checked: false,
      category: "Tóm tắt",
      description: "AI tóm tắt mục tiêu, phạm vi và nội dung chính.",
    },
    {
      id: "x-cmp-1",
      label: "So sánh với tài liệu chuẩn",
      checked: false,
      category: "So sánh",
      description: "Chỉ khả dụng khi có tài liệu đối chiếu.",
    },
  ],
};

/**
 * Tất cả checklist items từ mọi review type (Legal + Business + Financial + Admin + Compliance),
 * dedup theo ID, dùng cho Custom mode — user tự chọn từ toàn bộ danh sách.
 * Không bao gồm items thuộc category "So sánh" (handled bởi compare toggle riêng).
 */
export const ALL_REVIEW_CHECKLIST_ITEMS: ReviewChecklistItem[] = (() => {
  const seen = new Set<string>();
  const all: ReviewChecklistItem[] = [];
  const types: ReviewType[] = ["Legal", "Business", "Financial", "Admin", "Compliance"];
  for (const type of types) {
    for (const item of REVIEW_CHECKLISTS[type]) {
      if (!seen.has(item.id) && item.category !== "So sánh") {
        seen.add(item.id);
        all.push({ ...item, checked: false });
      }
    }
  }
  return all;
})();

export const REVIEW_TYPE_META: Record<
  ReviewType,
  { label: string; description: string; color: string }
> = {
  Legal: {
    label: "Legal",
    description: "Hợp đồng, NDA, thoả thuận pháp lý",
    color: "text-violet-600",
  },
  Business: {
    label: "Business",
    description: "Proposal, SLA, kinh doanh",
    color: "text-blue-600",
  },
  Financial: {
    label: "Financial",
    description: "Báo giá, thanh toán, tài chính",
    color: "text-emerald-600",
  },
  Admin: {
    label: "Admin",
    description: "Công văn, thông báo, quy trình",
    color: "text-amber-600",
  },
  Compliance: {
    label: "Compliance",
    description: "Quy định, policy, tuân thủ",
    color: "text-rose-600",
  },
  Custom: {
    label: "Custom",
    description: "Tự chọn checklist theo mục đích",
    color: "text-gray-600",
  },
};

// ─── API ─────────────────────────────────────────────────────────────────────

export interface DocumentTextResponse {
  document_id: string;
  filename: string;
  text: string;
  /** Số trang thực tế từ metadata file (DOCX/PDF). null nếu không đọc được. */
  page_count: number | null;
}

export type ReviewJobStatus = "reviewing" | "completed" | "draft";

export interface ReviewHistoryItem {
  id: string;
  document_name: string;
  review_type: ReviewType;
  compare_mode: "tracked" | "semantic" | null;
  status: ReviewJobStatus;
  risk_score: number;
  created_at: string;
}

export interface ReviewHistoryResponse {
  items: ReviewHistoryItem[];
}

export interface ReviewVersionPayload {
  version_num: number;
  label: string;
  type: string;
  score: number;
  review_type?: string;
  result: AnalysisResult;
  applied_edits?: Record<string, { suggested: string; riskLevel: string }>;
}

export interface ReviewVersionResponse extends ReviewVersionPayload {
  id: string;
  created_at: string;
}

export interface SuggestChecklistResponse {
  suggested_ids: string[];
}

export interface ReviewStartResponse {
  job_id: string;
  status: string;
  compare_mode: "tracked" | "semantic" | null;
  revisions_detected: { document: number; template: number };
}

export const reviewApi = {
  start(data: ReviewConfig) {
    return http.post<ReviewStartResponse>(API_ENDPOINTS.review.start, data);
  },

  getResult(jobId: string) {
    return http.get<ReviewReport>(API_ENDPOINTS.review.result(jobId));
  },

  getDocumentText(docId: string) {
    return http.get<DocumentTextResponse>(
      API_ENDPOINTS.review.documentText(docId)
    );
  },

  quickAction(jobId: string, type: QuickActionType, userInstruction?: string, additionalRequirements?: string) {
    return http.post<QuickActionResult>(API_ENDPOINTS.review.quickAction, {
      job_id: jobId,
      action_type: type,
      ...(userInstruction ? { user_instruction: userInstruction } : {}),
      ...(additionalRequirements ? { additional_requirements: additionalRequirements } : {}),
    });
  },

  recalculateScore(jobId: string, appliedEdits: Record<string, { suggested: string; riskLevel: string }>, quickActionEdits?: any[]) {
    return http.post<{ newScore: number; originalScore: number; delta: number; summary: string }>(
      `${API_ENDPOINTS.review.jobs}/${jobId}/recalculate-score`,
      {
        applied_edits: appliedEdits,
        ...(quickActionEdits ? { quick_action_edits: quickActionEdits } : {}),
      }
    );
  },

  getHistory(params?: { limit?: number; offset?: number }) {
    return http.get<ReviewHistoryResponse>(
      API_ENDPOINTS.review.history,
      params
    );
  },

  deleteHistoryItem(jobId: string) {
    return http.delete<{ status: string; job_id: string }>(
      API_ENDPOINTS.review.historyItem(jobId)
    );
  },

  suggestChecklist(documentId: string, reviewType: ReviewType) {
    return http.post<SuggestChecklistResponse>(
      API_ENDPOINTS.review.suggestChecklist,
      { document_id: documentId, review_type: reviewType }
    );
  },

  updateStatus(jobId: string, status: ReviewJobStatus) {
    return http.patch<{ job_id: string; status: ReviewJobStatus }>(
      API_ENDPOINTS.review.historyItemStatus(jobId),
      { status }
    );
  },

  saveSessionEvents(jobId: string, events: { id: string; type: string; label: string; timestamp: string }[]) {
    return http.patch<{ job_id: string; count: number }>(
      API_ENDPOINTS.review.jobSessionEvents(jobId),
      { events }
    );
  },

  saveVersion(jobId: string, data: ReviewVersionPayload) {
    return http.post<ReviewVersionResponse>(
      API_ENDPOINTS.review.jobVersions(jobId),
      data
    );
  },

  getVersions(jobId: string) {
    return http.get<ReviewVersionResponse[]>(
      API_ENDPOINTS.review.jobVersions(jobId)
    );
  },

  async downloadTrackedChanges(jobId: string, filename: string) {
    const { axiosClient } = await import("@/app/api/client");
    const resp = await axiosClient.get(
      API_ENDPOINTS.review.trackedChangesDocx(jobId),
      { responseType: "blob" }
    );
    triggerBrowserDownload(resp.data as Blob, filename);
  },

  async downloadEvalReport(jobId: string, filename: string) {
    const { axiosClient } = await import("@/app/api/client");
    const resp = await axiosClient.get(
      API_ENDPOINTS.review.evalReportPdf(jobId),
      { responseType: "blob" }
    );
    const blob = resp.data as Blob;
    // BE may fall back to HTML if Gotenberg is down; reflect that in extension
    const ext = blob.type.includes("pdf") ? "pdf" : "html";
    triggerBrowserDownload(blob, filename.replace(/\.[^.]+$/, "") + "." + ext);
  },
};

function triggerBrowserDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
