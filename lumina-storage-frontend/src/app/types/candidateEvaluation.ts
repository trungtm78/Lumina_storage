// ── JD ──────────────────────────────────────────────────────────────────────

export interface HardSkillItem {
  skill: string;
  level: string;
  priority: string;
  category: string;
  group: string | null; // same group = alternatives ("one of"), null = standalone
}

export interface SoftSkillItem {
  skill: string;
  priority: string;
}

export interface ParsedJD {
  job_title: string;
  company: string;
  department: string;
  location: string;
  work_mode: string;
  employment_type: string;
  experience_range: {
    min_years: number | null;
    max_years: number | null;
    preferred_years: number | null;
    note: string;
  };
  salary_range: { min: string; max: string; currency: string; note: string };
  hard_skills: HardSkillItem[];
  soft_skills: SoftSkillItem[];
  education: { min_level: string; preferred_fields: string[]; note: string };
  responsibilities: string[];
  benefits: string[];
  certifications_required: { name: string; priority: string }[];
  languages_required: { language: string; level: string; priority: string }[];
  culture_keywords: string[];
  summary: string;
}

export interface ParseJDResponse {
  jd: ParsedJD;
  jd_summary: string;
  jd_filename: string;
  jd_document_id: string;
}

// ── Candidate ───────────────────────────────────────────────────────────────

export interface ParsedCandidate {
  index: number;
  document_id: string;
  original_filename: string;
  name: string;
  email: string;
  phone: string;
  location: string;
  current_role: string;
  current_company: string;
  experience_years: number;
  hard_skills: {
    skill: string;
    level: string;
    years: number;
    category: string;
  }[];
  soft_skills: string[];
  skills: string[]; // backward compat
  education: {
    degree: string;
    field: string;
    school: string;
    year: string;
    gpa: string;
  }[];
  certifications: { name: string; issuer: string; year: string }[];
  languages: { language: string; level: string }[];
  summary: string;
  error?: string;
}

export interface ParseCVsResponse {
  candidates_count: number;
  new_parsed: number;
  errors: string[] | null;
  candidates_summary: string;
  candidates: ParsedCandidate[];
}

// ── Ranking ─────────────────────────────────────────────────────────────────

export interface ScoreBreakdown {
  hard_skills_match: number;
  soft_skills_match: number;
  nice_to_have: number;
  experience_relevance: number;
  education_certs: number;
  overall_impression: number;
}

export interface CandidateRanking {
  rank: number;
  candidate_index: number;
  name: string;
  total_score: number;
  scores: ScoreBreakdown;
  matched_hard_skills: string[];
  missing_hard_skills: string[];
  matched_soft_skills: string[];
  strengths: string[];
  gaps: string[];
  recommendation: string;
  recommendation_note: string;
}

export interface MatchResponse {
  shortlist_count: number;
  total_evaluated: number;
  rankings_summary: string;
  rankings: CandidateRanking[];
  shortlist_indices: number[];
}

// ── Interview Questions ─────────────────────────────────────────────────────

export interface InterviewQuestion {
  category: string;
  question: string;
  purpose: string;
  expected_good_answer: string;
  follow_up: string;
}

export interface CandidateQuestions {
  candidate_index: number;
  name: string;
  questions: InterviewQuestion[];
}

export interface GenerateQuestionsResponse {
  questions_count: number;
  candidates_count: number;
  questions_summary: string;
  candidate_questions: CandidateQuestions[];
  interview_questions: Record<string, InterviewQuestion[]>;
}

// ── Report ──────────────────────────────────────────────────────────────────

export interface GenerateReportResponse {
  rendered_document_id: string;
  preview_pdf_id: string;
  summary: string;
}

// ── Master List Import ──────────────────────────────────────────────────────

export type ExtractedField =
  | "name"
  | "email"
  | "phone"
  | "location"
  | "current_role"
  | "current_company"
  | "experience_years"
  | "career_level"
  | "hard_skills"
  | "soft_skills"
  | "skills"
  | "education"
  | "certifications"
  | "languages"
  | "summary";

export interface ColumnMappingItem {
  extracted_field: ExtractedField;
  target_column: string;
}

export interface ImportLogEntry {
  candidate_name: string;
  document_id: string;
  status: "success" | "failed" | "needs_review";
  row_number: number | null;
  message: string | null;
}

export interface ScanToMasterListResponse {
  output_document_id: string;
  success_count: number;
  failed_count: number;
  needs_review_count: number;
  import_log: ImportLogEntry[];
}

export interface ReadMasterListHeadersResponse {
  columns: string[];
  sheet_name: string;
}

// Human-readable labels for each extractable field
export const EXTRACTED_FIELD_LABELS: Record<ExtractedField, string> = {
  name: "Họ và tên",
  email: "Email",
  phone: "Số điện thoại",
  location: "Địa chỉ",
  current_role: "Vị trí hiện tại",
  current_company: "Công ty hiện tại",
  experience_years: "Số năm kinh nghiệm",
  career_level: "Cấp độ nghề nghiệp",
  hard_skills: "Kỹ năng chuyên môn",
  soft_skills: "Kỹ năng mềm",
  skills: "Kỹ năng (tổng hợp)",
  education: "Học vấn",
  certifications: "Chứng chỉ",
  languages: "Ngôn ngữ",
  summary: "Tóm tắt",
};

export const ALL_EXTRACTED_FIELDS: ExtractedField[] = [
  "name",
  "email",
  "phone",
  "location",
  "current_role",
  "current_company",
  "experience_years",
  "career_level",
  "hard_skills",
  "soft_skills",
  "education",
  "certifications",
  "languages",
  "summary",
];

// ── Wizard State ────────────────────────────────────────────────────────────

export interface EvaluationState {
  step: number;
  jd: ParsedJD | null;
  jdDocumentId: string | null;
  jdFilename: string | null;
  jdSummary: string | null;
  candidates: ParsedCandidate[];
  rankings: CandidateRanking[];
  shortlistIndices: number[];
  topN: number;
  interviewQuestions: Record<string, InterviewQuestion[]>;
  candidateQuestions: CandidateQuestions[];
  reportDocumentId: string | null;
  reportPreviewId: string | null;
}
