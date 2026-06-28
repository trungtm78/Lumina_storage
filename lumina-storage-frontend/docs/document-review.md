# Document Review & Analysis — System Reference

> **Scope**: Toàn bộ frontend + backend của tính năng Document Review & Analysis trong hệ thống Lumina Driver.
> **Cập nhật**: 2026-06-17
> **Repo**: `lumina-driver-frontend` + `lumina-driver-backend`

---

## Mục lục

1. [Database Schema](#1-database-schema)
2. [Backend — API Endpoints](#3-backend--api-endpoints)
3. [Backend — Core Logic](#4-backend--core-logic)
4. [Frontend — File Map](#5-frontend--file-map)
5. [Frontend — Component Tree](#6-frontend--component-tree)
6. [Frontend — State Management](#7-frontend--state-management)
7. [API Contract (FE ↔ BE)](#8-api-contract-fe--be)
8. [Flows chính](#9-flows-chính)
9. [Scoring Algorithm](#10-scoring-algorithm)
10. [Document Extraction Pipeline](#11-document-extraction-pipeline)
11. [Highlight & Keyword Matching](#12-highlight--keyword-matching)
12. [Export Pipeline](#13-export-pipeline)
13. [Migration History](#14-migration-history)

---

## 1. Database Schema

### Bảng `review_reviewjob`

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | |
| `user_id` | UUID FK | |
| `document_id` | UUID FK | |
| `compare_document_id` | UUID FK | nullable |
| `document_name` | VARCHAR | |
| `review_type` | VARCHAR(32) | |
| `compare_mode` | VARCHAR(16) | `tracked` \| `semantic` \| null |
| `risk_score` | INTEGER | |
| `report` | JSONB | snapshot `AnalysisResult` |
| `status` | VARCHAR(16) | default `reviewing` |
| `session_events` | JSONB | default `[]` |
| `pdf_document_id` | UUID FK | nullable → documents_document |
| `deleted_at` | TIMESTAMPTZ | soft delete |

### Bảng `review_reviewjobversion`

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | |
| `job_id` | UUID FK → review_reviewjob | CASCADE delete |
| `version_num` | INTEGER | số thứ tự trong session |
| `label` | VARCHAR(64) | nhãn hiển thị |
| `version_type` | VARCHAR(32) | `ai_review` \| `apply_suggestion` \| `ai_request` \| `user_edit` \| `restore` |
| `score` | INTEGER | risk score tại version này |
| `review_type` | VARCHAR(32) | nullable |
| `result` | JSONB | snapshot AnalysisResult + `_appliedEdits` internal |
| `created_at` / `updated_at` | TIMESTAMPTZ | |

**Index:** `idx_reviewjobversion_job_num` on `(job_id, version_num)`

---

## 3. Backend — API Endpoints

### `POST /review/start`

**Mục đích:** Khởi động toàn bộ review pipeline — extract text, gọi LLM, lưu DB.
**Auth:** JWT Bearer required
**Body:** `ReviewConfig`

```python
class ReviewConfig(BaseModel):
    document_id: str
    doc_source: Literal["drive", "upload", "url"] = "drive"
    source_url: str | None = None
    review_type: Literal["Legal","Business","Financial","Admin","Compliance","Custom"]
    checklist_item_ids: list[str] = []
    compare_enabled: bool = False
    compare_document_ids: list[str] = []      # tối đa 3 docs
    template_source: Literal["drive","upload"] | None = None
    additional_requirements: str | None = None
    reference_enabled: bool = False
    reference_doc_ids: list[str] = []          # tối đa 5 docs
    reference_content: str | None = None
```

**Response:**
```json
{
  "job_id": "uuid",
  "status": "completed",
  "compare_mode": "tracked|semantic|null",
  "revisions_detected": {
    "document": 12,
    "template": 0
  }
}
```

**Pipeline nội bộ:**
1. `_read_document_bytes()` → đọc file từ Storage backend
2. `asyncio.to_thread(_extract_text)` → extract text (mammoth/fitz/MarkItDown)
3. `_extract_track_changes()` → đọc track changes từ DOCX XML
4. Nếu `compare_enabled`: đọc thêm tối đa 3 template docs, mỗi doc cắt `per_cap` chars
5. Nếu `reference_enabled`: đọc tối đa 5 reference docs
6. `_resolve_checklist_labels()` → map checklist IDs → labels
7. `_detect_bilingual()` → phát hiện song ngữ Việt–Anh
8. `_run_review()` → build prompt + `_call_llm()` + parse response + tính score + build highlights
9. Lưu `ReviewJob` vào PostgreSQL
10. `asyncio.create_task(_persist_eval_pdf())` → fire-and-forget PDF pre-generation
11. Trả về `{job_id, status, compare_mode, revisions_detected}`

> ⚠️ **Đây là synchronous blocking request** — FE `await`s hoàn toàn. Thời gian: 20–90 giây tuỳ document.

---

### `GET /review/result/{job_id}`

Đọc `ReviewJob.report` từ DB, merge `session_events` vào response.
**Không gọi LLM** — chỉ đọc snapshot đã lưu.

---

### `GET /review/document-text/{document_id}`

Extract text + page count từ file. Dùng cho FE để preview nội dung ở step 2.

```json
{
  "document_id": "uuid",
  "filename": "hop_dong_abc.docx",
  "text": "...",
  "page_count": 12
}
```

---

### `GET /review/history`

```
?limit=50&offset=0
```

Trả danh sách `ReviewHistoryItem[]` (không bao gồm soft-deleted).

---

### `DELETE /review/history/{job_id}`

Soft delete: `deleted_at = now()`.

---

### `PATCH /review/history/{job_id}/status`

```json
{ "status": "reviewing" | "completed" }
```

---

### `POST /review/suggest-checklist`

Gọi LLM nhẹ với 5000 ký tự đầu của doc để chọn 4–8 checklist IDs phù hợp nhất.

```json
// Request
{ "document_id": "uuid", "review_type": "Legal" }

// Response
{ "suggested_ids": ["l-leg-1", "l-pay-1", "l-ris-1"] }
```

---

### `POST /review/start/quick-action`

Post-review action không gọi review lại toàn bộ — chỉ gợi ý 1–5 edits mới.

```python
class QuickActionRequest(BaseModel):
    job_id: str
    action_type: Literal["improve", "optimize", "reduce"]
    user_instruction: str | None = None     # custom prompt từ user
    additional_requirements: str | None = None
```

**Response:** `QuickActionResult` (summary + newScore + suggested_edits)
Score **không thay đổi** ở bước này — chỉ thay đổi khi gọi `recalculate-score`.

---

### `POST /review/jobs/{job_id}/recalculate-score`

Tính lại score dựa trên danh sách edits đã apply — **không gọi LLM**.
Cập nhật `ReviewJob.risk_score` và `ReviewJob.report.riskScore`.
Xóa `pdf_document_id` để invalidate cached PDF.

```json
// Request
{
  "applied_edits": {
    "modified_text_1": { "suggested": "...", "riskLevel": "high" },
    "modified_text_2": { "suggested": "...", "riskLevel": "medium" }
  }
}
// Response
{ "newScore": 42, "originalScore": 65, "delta": 23, "summary": "..." }
```

---

### `POST /review/jobs/{job_id}/versions`

Lưu snapshot version (201 Created).

```python
class SaveVersionRequest(BaseModel):
    version_num: int
    label: str
    type: str    # ai_review | apply_suggestion | ai_request | user_edit | restore
    score: int
    review_type: str | None = None
    result: dict
    applied_edits: dict | None = None
```

`applied_edits` được merge vào `result._appliedEdits` trong DB (tách biệt khỏi result schema).

---

### `GET /review/jobs/{job_id}/versions`

Trả `VersionResponse[]` theo thứ tự `version_num` tăng dần.

---

### `PATCH /review/jobs/{job_id}/session-events`

```json
{
  "events": [
    { "id": "file_selected-123", "type": "file_selected", "label": "...", "timestamp": "ISO8601" }
  ]
}
```

Ghi đè toàn bộ `session_events` của job (debounced 3s từ FE).

---

### `GET /review/result/{job_id}/tracked-changes.docx`

Xuất file DOCX với track changes markup. Hai paths:
- **Path A** (ưu tiên): python-docx, patch trực tiếp vào file gốc với `w:del`/`w:ins` tags
- **Path B** (fallback): tái tạo document từ plain text với tracked changes

---

### `GET /review/result/{job_id}/eval-report.pdf`

Xuất PDF evaluation report qua Gotenberg.
- **Fast path**: serve PDF đã pre-generate (lưu ở `pdf_document_id`)
- **Slow path**: generate on-demand qua Gotenberg, lưu lại cho lần sau
- **Fallback**: trả HTML nếu Gotenberg không có

---

## 4. Backend — Core Logic

### `_extract_text(content: bytes, filename: str) → str`

Thứ tự ưu tiên extract text:

```
.doc  → [1] Gotenberg → LibreOffice → PDF → fitz markdown
        [2] Fallback: MarkItDown + _strip_inline_md

.docx → [1] mammoth.extract_raw_text()  ← CÙNG ENGINE với mammoth.js frontend
                                           → text output GIỐNG HỆT DOM textContent
        [2] MarkItDown + _strip_inline_md
        [3] python-docx structural walk (fallback cuối)

.pdf  → [1] fitz get_text("markdown") → _strip_inline_md
        [2] MarkItDown (pdfminer)

others → MarkItDown + _strip_inline_md
```

> **Tại sao mammoth là ưu tiên #1 cho DOCX?**
> FE dùng `mammoth.js` để render DOCX trong DOM. Nếu BE cũng dùng `mammoth`, text LLM nhận được GIỐNG HỆT `textContent` của DOM → `modified_text`/`anchor_text` match 100% khi FE tìm để highlight.

---

### `_strip_inline_md(text: str) → str`

Xóa toàn bộ markdown formatting (bold, italic, headers, table pipes) khỏi text trước khi đưa vào LLM. Giải quyết vấn đề "dính chữ" (`Công**ty**` → `Công ty`) và table cells.

---

### `_detect_bilingual(text: str) → bool`

Heuristic phát hiện tài liệu song ngữ Việt–Anh: cần ≥2 VI markers VÀ ≥2 EN markers.
Khi `is_bilingual=True`, mỗi edit phải có đủ 6 fields (VI + EN parallel).

---

### `_build_review_prompt(...)` + `_SYSTEM_REVIEW_PROMPT`

Prompt engineering:
- System prompt: role + rules + bilingual requirements
- User prompt: MAIN_DOCUMENT + TRACK_CHANGES + TEMPLATE + REFERENCE + CHECKLIST + USER_REQUIREMENTS + BILINGUAL + ANALYSIS_STRATEGY + RISK_SCORE guide + EVIDENCE_RULES + OUTPUT schema

Tất cả user-provided data được bọc trong `<untrusted_data>` tags để ngăn prompt injection.

---

### `_call_llm(prompt, db) → dict`

```python
# Lấy LLM config từ bảng ai_model_config (default config của org)
_llm_kwargs = (await get_default_litellm_config(db, "chat")).to_kwargs()
response = await litellm.acompletion(
    messages=[
        {"role": "system", "content": _SYSTEM_REVIEW_PROMPT},
        {"role": "user", "content": prompt},
    ],
    stream=False,
    temperature=0,
    **_llm_kwargs,  # model, api_key, base_url, max_tokens...
)
```

`temperature=0` để đảm bảo deterministic output cho JSON parsing.

---

### `_calculate_formula_score(...)` — Risk Scoring Algorithm

Xem chi tiết ở [mục 10](#10-scoring-algorithm).

---

### `_build_highlights(edits, checklist_results, ...) → list[DocHighlight]`

Build danh sách keyword highlights cho FE:
- Từ `edits`: dùng `anchor_text` (ưu tiên) hoặc `modified_text[:40]` làm keyword
- Từ `checklist_results`: items có status `warning`/`risk` và có `anchorKeyword`
- Từ `reference_results`: findings có `anchorKeyword`
- Dedup theo keyword lowercase, giữ severity cao nhất

---

### `_check_verbatim_match(modified_text, doc_text) → bool`

Kiểm tra LLM không hallucinate `modified_text`:
1. Check prefix 80/60/40 chars có trong `doc_text` (normalized whitespace)
2. Nếu text > 100 chars: check thêm đoạn giữa để loại bỏ prefix-match-only hallucination

---

### `_sanitize_user_input(text, max_len=800) → str`

Strip `</untrusted_data>` tag để ngăn prompt injection từ user input, truncate đến 800 chars.

---

## 5. Frontend — File Map

```
src/app/
├── pages/
│   └── DocumentReviewPage.tsx          # Main page (1200+ lines) — state hub
│
├── components/doc-review/
│   ├── HorizontalStepBar.tsx           # Step 1/2/3 progress bar
│   ├── FilePicker.tsx                  # Modal chọn file từ knowledge base
│   ├── CenterDocViewer.tsx             # DOCX preview + AI highlight overlay
│   ├── RightStep2Config.tsx            # Step 2: config panel (type, checklist, compare, ref)
│   ├── LeftWizard.tsx                  # Legacy wizard sidebar (step 1-5, đang deprecate)
│   ├── RightAnalysisSidebar.tsx        # Step 3: kết quả + edits + versions (83KB)
│   ├── ReviewedHistoryDrawer.tsx       # Drawer lịch sử review đã hoàn tất
│   ├── ProgressHistoryDrawer.tsx       # Drawer timeline session events
│   ├── RiskGauge.tsx                   # Gauge chart điểm rủi ro
│   ├── SectionTitle.tsx                # Tiêu đề section nhỏ
│   ├── StepLabel.tsx                   # Label số bước với icon done/active
│   └── mockData.ts                     # Mock data cho dev/test
│
├── api/endpoints/
│   └── review.ts                       # Types + reviewApi client (917 lines)
│
├── api/
│   └── endpoints.ts                    # API_ENDPOINTS constants
│
└── utils/doc-review/
    ├── highlights.ts                   # buildHighlightedHTML, locateKeyword, AppliedEdit
    ├── sections.ts                     # parseDocSections → DocSection[]
    └── risk.ts                         # Risk color/label helpers
```

---

## 6. Frontend — Component Tree

```
DocumentReviewPage
│
├── [modal] FilePicker
│       props: open, onConfirm(files[]), onClose, multiple
│       dùng cho: tài liệu chính / compare docs / reference docs
│
├── HorizontalStepBar
│       props: step (1|2|3), maxStep, onStepClick
│
├── [step=1] EmptyChoose
│       → click → setPickerOpen(true)
│
├── [step=2, selectedDoc] Layout gồm:
│   ├── FileScanCard (doc info + page count badge)
│   ├── CenterDocViewer
│   │       props: sections, highlights=[], appliedEdits={}
│   │       state: mammoth HTML render, tooltip
│   │       nội bộ: axiosClient.get(/documents/{id}/preview) → mammoth HTML
│   │       dùng diff-match-patch để fuzzy match keywords trong DOM
│   │
│   └── RightStep2Config
│           props: reviewType, checklist, compareEnabled, compareDocIds,
│                  referenceEnabled, referenceDocIds, additionalRequirements,
│                  suggestingChecklist, onRunReview, isReviewing
│           → "Bắt đầu Review" → DocumentReviewPage.handleRunReview()
│
├── [step=3] Layout gồm:
│   ├── CenterDocViewer
│   │       + highlights từ result.highlights
│   │       + appliedEdits từ committedEdits + pendingEdits
│   │       + onHighlightClick → scroll RightAnalysisSidebar đến edit card
│   │
│   └── RightAnalysisSidebar
│           tabs: "review" | "version"
│           sections (review tab):
│             - ScoreHeader: RiskGauge + riskLabel + context chip
│             - KeyInfo: keyInformation extract
│             - Summary + riskExplanation
│             - Checklist (grouped by category, pass/warning/risk)
│             - KeyIssues + MissingItems + Suggestions
│             - EditSuggestions (improve/reduce/rewrite tabs)
│             - QuickAction (improve/optimize/reduce)
│             - ReferenceResults
│             - DetectedErrors
│             - RiskBreakdown
│           sections (version tab):
│             - VersionHistory list
│             - onSwitchVersion / onRestoreVersion
│
├── [drawer] ReviewedHistoryDrawer
│       data: historyResp.items
│       onReopen(item) → DocumentReviewPage.handleReopenHistory()
│       onDelete(jobId) → deleteHistoryMutation
│
└── [drawer] ProgressHistoryDrawer
        data: sessionEvents[]
        sessionEventType: file_selected | ai_scan | review_start |
                          review_done | fix_applied | version_saved |
                          restored | completed
```

---

## 7. Frontend — State Management

`DocumentReviewPage` là **state hub** duy nhất, không dùng global store. Tất cả state đều là `useState` local, prop-drilled xuống các child components.

### Nhóm state chính

```typescript
// ── Step navigation
step: ReviewStep (1|2|3)
maxStep: ReviewStep

// ── Doc selection
selectedDoc: ReviewDocItem | null
pickerOpen / comparePickerOpen / referencePickerOpen: boolean

// ── Config (Step 2)
reviewType: ReviewType
checklist: ReviewChecklistItem[]
compareEnabled: boolean
compareDocIds: string[]
referenceEnabled: boolean
referenceDocIds: string[]
referenceContent: string
additionalRequirements: string
suggestingChecklist: boolean
aiSuggestedIds: string[] | null
checkedItemIds: Set<string>  // IDs đã tick khi bắt đầu review

// ── Analysis (Step 3)
uiState: "empty" | "loading" | "success"
result: AnalysisResult | null
jobId: string | null
displayScore: number  // animated (0 → riskScore trong 30 ticks)
compareMode: "tracked" | "semantic" | null
revisionsDetected: { document: number; template: number }

// ── Doc viewer
sections: DocSection[]
templateSections: DocSection[]
viewingTemplate: boolean

// ── Edit tracking
pendingEdits: Record<modifiedText, {suggested, riskLevel, clauseName?}>
committedEdits: Record<modifiedText, {suggested, riskLevel, clauseName?}>
ignoredEditIds: Set<string>
appliedFixes: Record<keyword, text>

// ── Quick action
quickActionResult: QuickActionResult | null
quickActionLoading: boolean
newEditIds: Set<string>  // auto-clear sau 8s để hiện badge "Mới"

// ── Versions
versionHistory: VersionEntry[]
activeVersionNum: number | null
sessionVersionCountRef: useRef<number>
versionAnchorJobIdRef: useRef<string | null>

// ── Session events
sessionEvents: SessionEvent[]
// Auto-save debounced 3s sau mỗi thay đổi
```

### Ref vars (không trigger re-render)

```typescript
reviewCountRef          // đếm số lần review trong session
sessionVersionCountRef  // đếm version (không reset khi reopen)
versionAnchorJobIdRef   // job_id gốc của review (không đổi khi switch version)
fixCountRef
docReadyRef
jobMarkedCompletedRef
restoringVersionsRef    // ngăn toast khi restore từ BE
suggestTriggeredRef     // ngăn suggest-checklist fire nhiều lần
```

---

## 8. API Contract (FE ↔ BE)

### TypeScript types (review.ts)

```typescript
// ── Core types
type ReviewType = "Legal"|"Business"|"Financial"|"Admin"|"Compliance"|"Custom"
type DocSource = "drive"|"upload"|"url"
type HighlightSeverity = "pass"|"warning"|"risk"
type RiskLevel = "safe"|"low"|"medium"|"high"|"very_high"

// ── Request
interface ReviewConfig {
  document_id: string
  doc_source: DocSource
  review_type: ReviewType
  checklist_item_ids: string[]
  compare_enabled: boolean
  compare_document_ids?: string[]
  additional_requirements?: string
  reference_enabled?: boolean
  reference_doc_ids?: string[]
  reference_content?: string
}

// ── Response root
interface AnalysisResult {
  summary: string
  riskExplanation: string
  keyIssues: string[]
  missingItems: string[]
  suggestions: string[]
  checklist: ChecklistResult[]
  riskScore: number             // 0-100
  highlights: DocHighlight[]
  fixes: FixSuggestion[]
  comparison?: ComparisonResult
  keyInformation?: KeyInfoItem[]
  detectedErrors?: string[]
  referenceResults?: ReferenceResult[]
  riskFactors?: string[]
  riskBreakdown?: Array<{category: string; score: number; issues: string[]}>
  sessionEvents?: {...}[]
  truncation_warning?: string
  is_bilingual?: boolean
  quickActionResult?: QuickActionResult    // persist khi reopen
  additionalRequirements?: string          // persist context
}

// ── Edit suggestion (từ comparison.edits)
interface EditEvaluation {
  id: string
  clause_name: string
  original_text: string
  modified_text: string        // verbatim từ document
  anchor_text?: string         // 20-40 chars đầu của modified_text
  verdict: "agree"|"disagree"
  reason: string
  suggested_text: string
  risk_level: "high"|"medium"|"low"
  suggestion_category?: "improve"|"reduce"|"rewrite"
  verbatim_match?: boolean
  // Bilingual fields (song ngữ VI-EN):
  bilingual_anchor_text?: string | null
  bilingual_modified_text?: string | null
  bilingual_suggested_text?: string | null
}

// ── Highlight
interface DocHighlight {
  keyword: string
  severity: "pass"|"warning"|"risk"
  tooltip: string
  severity_label: "low"|"medium"|"high"
  highlight_type?: "analysis"|"compare"|"reference"
  ref_id?: string          // link về edit card hoặc checklist item
  bilingual_keyword?: string | null
}
```

### API Client (reviewApi)

```typescript
const reviewApi = {
  start(data: ReviewConfig): Promise<ReviewStartResponse>
  getResult(jobId: string): Promise<ReviewReport>
  getDocumentText(docId: string): Promise<DocumentTextResponse>
  quickAction(jobId, type, userInstruction?, additionalRequirements?): Promise<QuickActionResult>
  recalculateScore(jobId, appliedEdits): Promise<{newScore, originalScore, delta, summary}>
  getHistory(params?): Promise<ReviewHistoryResponse>
  deleteHistoryItem(jobId): Promise<{status, job_id}>
  suggestChecklist(documentId, reviewType): Promise<SuggestChecklistResponse>
  updateStatus(jobId, status): Promise<{job_id, status}>
  saveSessionEvents(jobId, events): Promise<{job_id, count}>
  saveVersion(jobId, data): Promise<ReviewVersionResponse>
  getVersions(jobId): Promise<ReviewVersionResponse[]>
  downloadTrackedChanges(jobId, filename): Promise<void>    // trigger browser download
  downloadEvalReport(jobId, filename): Promise<void>
}
```

---

## 9. Flows chính

### Flow 1: Review tài liệu lần đầu

```
User chọn file (Step 1)
  → setSelectedDoc()
  → useQuery("review-doc-text", getDocumentText) — lấy text để preview
  → parseDocSections(text) → sections[]
  → Tự động: suggest-checklist API (debounced, trigger khi step=2 và text ready)
  → Checklist được auto-tick theo AI suggestion

User vào Step 2 (config)
  → setStep(2)
  → Cấu hình: reviewType, checklist, compareEnabled, referenceEnabled, additionalRequirements

User click "Bắt đầu Review"
  → handleRunReview()
  → setUiState("loading")
  → reviewApi.start(config)    ← BLOCKING 20-90s
  → reviewApi.getResult(job_id) ← Đọc kết quả ngay (sync, không poll)
  → setResult(report)
  → setUiState("success")
  → setStep(3)
  → reviewApi.saveVersion(v1, "AI Review")   ← fire async
  → animateScore: setInterval 30ms → displayScore tăng dần lên target
```

### Flow 2: Apply edit suggestion

```
User tick checkbox edit trong RightAnalysisSidebar
  → onApplyEdit(editId, modifiedText, suggested, riskLevel, clauseName)
  → setPendingEdits(prev => {...prev, [modifiedText]: {suggested, riskLevel}})
  → CenterDocViewer nhận appliedEdits mới → highlight strikethrough + new text

User click "Apply All" hoặc "Save Version"
  → onSaveVersion()
  → committedEdits = {...committedEdits, ...pendingEdits}
  → reviewApi.recalculateScore(jobId, committedEdits) → newScore
  → setDisplayScore(newScore) (animate)
  → reviewApi.saveVersion(vN, "Applied Edits") → lưu snapshot
  → sessionVersionCountRef.current++
```

### Flow 3: Quick Action

```
User chọn action: improve / optimize / reduce
  → hoặc nhập custom instruction + click gửi

  → onQuickAction(type, userInstruction?)
  → setQuickActionLoading(true)
  → reviewApi.quickAction(jobId, type, instruction, additionalRequirements)
    [BE: gọi LLM, 1-5 edits mới, không lưu vào DB chính]
  → setQuickActionResult(result)
  → newEditIds = Set(result.suggested_edits.map(e => generateId()))
  → setTimeout 8s → clearNewEditIds()

User apply 1 edit từ quick action
  → tương tự Flow 2 nhưng edit đến từ quickActionResult.suggested_edits
```

### Flow 4: Reopen lịch sử

```
User mở ReviewedHistoryDrawer
  → click item → handleReopenHistory(item)
  → Promise.all([getResult(item.id), getVersions(item.id)])
  → restore: result, versions, checklist, compareMode, appliedEdits, additionalRequirements
  → setStep(3), setUiState("success")
  → suggestTriggeredRef = `${doc.id}:${review_type}` ← ngăn auto-suggest fire lại
```

### Flow 5: Version switching

```
User click version N trong tab "version"
  → onSwitchVersion(N)
  → setActiveVersionNum(N)
  → sidebarResult = versionHistory.find(v => v.num === N)?.result
  → committedEdits = entry.appliedEdits
  → CenterDocViewer render với appliedEdits của version N

User click "Khôi phục version này"
  → handleRestoreVersion(N)
  → lấy entry từ versionHistory
  → setResult(entry.result), setCommittedEdits(entry.appliedEdits)
  → tạo version mới type="restore"
  → reviewApi.saveVersion(anchorJobId, restorePayload)
```

### Flow 6: Export

```
Download DOCX (tracked changes):
  → reviewApi.downloadTrackedChanges(jobId, filename)
  → axiosClient.get(/review/result/{id}/tracked-changes.docx, {responseType:"blob"})
  → triggerBrowserDownload(blob, filename)

Download PDF (eval report):
  → reviewApi.downloadEvalReport(jobId, filename)
  → BE: check pdf_document_id → serve from storage (fast path)
  → Fallback: Gotenberg HTML→PDF → serve + store for next time
  → Fallback Gotenberg down: trả HTML file
```

---

## 10. Scoring Algorithm

Score là **điểm RỦI RO** (0 = an toàn, 100 = cực kỳ rủi ro).

### `_calculate_formula_score()`

```python
# 1. Checklist risk — proportional accumulation
checklist_items = [(item.status, _CHECKLIST_RATE) for item in evaluated
                   if item.status in {"risk", "warning"}]
# _CHECKLIST_RATE = {"risk": 0.14, "warning": 0.06}
checklist_risk = _apply_proportional_risk(0.0, checklist_items)

# 2. Edit risk — proportional accumulation
edit_items = [(edit.risk_level, _EDIT_RATE) for edit in edits]
# _EDIT_RATE = {"high": 0.12, "medium": 0.07, "low": 0.03}
edit_risk = _apply_proportional_risk(0.0, edit_items)

# 3. Blend 50/50 (checklist compliance vs redline signal)
formula_risk = checklist_risk * 0.5 + edit_risk * 0.5

# 4. Missing items + detected errors (log scale, diminishing returns)
formula_risk += log1p(len(missing_items)) * 6
formula_risk += log1p(len(detected_errors)) * 2

# 5. Blend formula + AI score
# Nếu có objective signals: formula 70% + AI 30%
# Nếu không có: formula 40% + AI 60%
formula_weight = 0.70 if has_objective_signals else 0.40
blended = round(formula_risk * formula_weight + ai_score * (1 - formula_weight))
return max(5, min(100, blended))
```

### `_apply_proportional_risk(base, items)`

```python
# Mỗi item chiếm rate% headroom còn lại đến 100
# → N vấn đề nhỏ không bao giờ đạt = 1 vấn đề nghiêm trọng
risk = base
for risk_level, rate_map in items:
    rate = rate_map.get(risk_level, 0.0)
    risk = risk + (100.0 - risk) * rate
return risk
```

### Recalculate khi apply edits

```python
# Mirror: làm ngược (giảm rủi ro thay vì tăng)
rc_safety = 100.0 - float(original_score)
new_score = max(5, round(100.0 - _apply_proportional_risk(rc_safety, rc_items)))
```

### Risk labels (FE)

| Score | Label | Color |
|-------|-------|-------|
| 0–20 | An toàn | emerald |
| 21–40 | Rủi ro thấp | yellow |
| 41–60 | Rủi ro trung bình | amber |
| 61–80 | Rủi ro cao | orange |
| 81–100 | Rủi ro rất cao | red |

---

## 11. Document Extraction Pipeline

### Quy trình chọn extractor

```
Input: file bytes + filename

.doc  → Gotenberg (LibreOffice) → PDF → fitz.get_text("markdown") → _strip_inline_md
        ↓ nếu Gotenberg không có
        MarkItDown + _strip_inline_md

.docx → mammoth.extract_raw_text()   ← BEST: plain text, khớp DOM
        ↓ fallback
        MarkItDown + _strip_inline_md
        ↓ fallback
        python-docx structural walk (paragraphs + tables)

.pdf  → fitz.get_text("markdown") → _strip_inline_md
        ↓ fallback
        MarkItDown (pdfminer)

others → MarkItDown + _strip_inline_md
```

### `_extract_track_changes(content, filename)`

Chỉ cho `.docx`. Parse `word/document.xml` bằng lxml, lấy tất cả `w:ins` và `w:del` tags.

```python
revisions = [
  {"type": "ins", "text": "...", "author": "Nguyễn A"},
  {"type": "del", "text": "...", "author": "Trần B"},
]
```

### Giới hạn

- `_MAX_DOC_CHARS = 200_000` — doc text đưa vào LLM
- Template doc: mỗi doc cắt `per_cap = max(5000, 15000 // n_templates)` chars
- Reference doc: mỗi doc cắt `12_000` chars, tối đa 5 docs
- Suggest-checklist: chỉ dùng `5_000` chars đầu
- `_doc_text` lưu vào `report` nếu < 500,000 chars (tránh lưu quá lớn vào JSONB)

---

## 12. Highlight & Keyword Matching

### Backend → Frontend flow

1. BE trả `highlights: DocHighlight[]` trong `AnalysisResult`
2. FE `CenterDocViewer` nhận `highlights[]`
3. Mỗi highlight có `keyword` — BE copy từ `anchor_text` (20-40 chars) của edit

### CenterDocViewer: DOM injection

```typescript
// 1. Fetch mammoth HTML từ BE (/documents/{id}/preview)
// 2. Build text node map: createTreeWalker → {node, offset}[]
// 3. Với mỗi highlight.keyword:
//    locateKeyword(entries, fullText, keyword)
//    → indexOf (case-insensitive, NBSP-normalized)
//    → fallback: diff-match-patch fuzzy search
//    → buildDomRange(entries, startIdx, keyword.length)
//    → wrap với <mark class="highlight-{severity}">
// 4. Với applied edits:
//    tìm modifiedText trong DOM → strikethrough
//    insert suggestedText (green) kế bên
```

### Bilingual highlight

Khi `is_bilingual=True`, mỗi highlight có thêm `bilingual_keyword`.
FE tìm cả 2 keywords trong DOM và highlight song song với cùng severity/ref_id.

### `locateKeyword` logic

```typescript
// Exact match (normalized NBSP)
idx = fullText.toLowerCase().indexOf(keyword.toLowerCase())
if (idx >= 0) → success

// diff-match-patch fuzzy fallback (nếu có sai lệch nhỏ)
dmp.match_main(text, pattern, expectedPosition)
```

---

## 13. Export Pipeline

### Tracked Changes DOCX (`review_export.py`)

**Path A — python-docx (ưu tiên):**
- Đọc file DOCX gốc
- Với mỗi applied edit: tìm `modified_text` trong paragraphs bằng fuzzy match
- Wrap đoạn bị thay bằng `w:del` + thêm `w:ins` với `suggested_text`
- Tác giả: `"Lumina Legal AI"`

**Path B — plain text reconstruction (fallback):**
- Tái tạo document từ `doc_text`
- Thêm tracked changes markup dựa trên vị trí text

### Eval Report PDF (`build_legal_eval_html`)

Tạo HTML với:
- Header: document name, review type, risk score, date
- Sections: summary, key information, checklist, highlights, key issues, missing items, edits, comparison, reference results, suggestions, risk breakdown
- Style: print-friendly, A4

→ Gửi HTML đến Gotenberg `/forms/chromium/convert/html`
→ Lưu PDF vào Storage Backend, link vào `review_reviewjob.pdf_document_id`

---

## 14. Migration History

| Migration | Date | Nội dung |
|-----------|------|---------|
| `20260424_create_review_reviewjob` | 2026-04-24 | Tạo bảng `review_reviewjob` (id, user_id, document_id, compare_document_id, document_name, review_type, compare_mode, risk_score, report JSONB, deleted_at) |
| `20260602_add_status_to_reviewjob` | 2026-06-02 | Thêm cột `status` VARCHAR(16) default `reviewing` |
| `20260603_add_review_job_version` | 2026-06-03 | Tạo bảng `review_reviewjobversion` |
| `20260603_add_session_events_to_reviewjob` | 2026-06-03 | Thêm cột `session_events` JSONB default `[]` |
| `20260610_add_pdf_document_id_to_reviewjob` | 2026-06-10 | Thêm cột `pdf_document_id` FK → documents_document (nullable) |

---

## Appendix A: Checklist Categories & IDs

| Review Type | IDs | Categories |
|-------------|-----|------------|
| Legal | `l-fmt-1`, `l-inf-1`, `l-inf-2`, `l-leg-1`, `l-leg-2`, `l-obl-1`, `l-ben-1`, `l-pay-1`, `l-pen-1`, `l-tim-1`, `l-ris-1`, `l-sum-1`, `l-cmp-1` | Format, Thông tin, Pháp lý, Nghĩa vụ, Quyền lợi, Thanh toán, Phạt vi phạm, Thời hạn, Rủi ro, Tóm tắt, So sánh |
| Business | `b-fmt-1`, `b-inf-1`, `b-inf-2`, `b-obl-1`, `b-ben-1`, `b-pay-1`, `b-tim-1`, `b-ris-1`, `b-sum-1`, `b-cmp-1` | Format, Thông tin, Nghĩa vụ, Quyền lợi, Thanh toán, Thời hạn, Rủi ro, Tóm tắt, So sánh |
| Financial | `f-fmt-1`, `f-inf-1`, `f-inf-2`, `f-pay-1`, `f-pen-1`, `f-tim-1`, `f-ris-1`, `f-sum-1`, `f-cmp-1` | Format, Thông tin, Thanh toán, Phạt vi phạm, Thời hạn, Rủi ro, Tóm tắt, So sánh |
| Admin | `a-fmt-1`, `a-fmt-2`, `a-inf-1`, `a-obl-1`, `a-tim-1`, `a-ris-1`, `a-sum-1` | Format, Thông tin, Nghĩa vụ, Thời hạn, Rủi ro, Tóm tắt |
| Compliance | `c-fmt-1`, `c-inf-1`, `c-leg-1`, `c-leg-2`, `c-obl-1`, `c-pen-1`, `c-tim-1`, `c-ris-1`, `c-sum-1`, `c-cmp-1` | Format, Thông tin, Pháp lý, Nghĩa vụ, Phạt vi phạm, Thời hạn, Rủi ro, Tóm tắt, So sánh |
| Custom | Union of all above (trừ `-cmp-1`) | All categories |

---

## Appendix B: Session Event Types

| Type | Trigger |
|------|---------|
| `file_selected` | User chọn file |
| `ai_scan` | `docTextResp` ready, sections parsed |
| `review_start` | `handleRunReview()` được gọi |
| `review_done` | Review API trả kết quả |
| `fix_applied` | User apply 1 edit |
| `version_saved` | Version mới được tạo |
| `restored` | Switch hoặc restore version |
| `completed` | User đánh dấu "Hoàn tất" |

---

## Appendix C: Quick Action Types

| Type | Default Instruction |
|------|---------------------|
| `improve` | Đề xuất cải thiện rõ ràng, đầy đủ, dễ thực thi hơn |
| `optimize` | Tối ưu thương mại/vận hành: thanh toán, timeline, KPI |
| `reduce` | Giảm thiểu rủi ro: trách nhiệm, phạt, bất khả kháng |

---

## Appendix D: Known Constraints & Gotchas

1. **Blocking review request**: `POST /review/start` không trả về ngay — blocking 20–90s. Không có polling, không có WebSocket. FE hiện chỉ hiện spinner.

2. **mammoth alignment**: BE dùng `mammoth.extract_raw_text()` và FE dùng `mammoth.js` để đảm bảo text giống nhau. Nếu một trong hai đổi library → `modified_text` có thể không match nữa.

3. **`_doc_text` trong report JSONB**: BE lưu extracted text vào `report._doc_text` để quick_action và tracked-changes export dùng đúng text mà LLM đã thấy. Nếu xóa field này → re-extract có thể tạo text khác → modified_text không match.

4. **Version anchor jobId**: FE dùng `versionAnchorJobIdRef` (set lần đầu khi review, không đổi khi re-review). Tất cả versions trong session đều gắn vào cùng 1 job_id gốc.

5. **suggestTriggeredRef**: Dùng key `${docId}:${reviewType}` để ngăn suggest-checklist fire nhiều lần. Khi reopen lịch sử, ref được set trước để ngăn auto-suggest.

6. **Bilingual edits**: Nếu `is_bilingual=True`, edit thiếu `bilingual_modified_text` hoặc `bilingual_suggested_text` sẽ bị BE **loại bỏ hoàn toàn** (không trả về FE).

7. **Score floor**: `_SCORE_FLOOR = 5` — bất kỳ document thực tế nào cũng có ít nhất 5 điểm rủi ro.

8. **PDF caching**: Khi `recalculate-score` được gọi, `pdf_document_id` bị set `None` để invalidate PDF đã cache. PDF sẽ được generate lại ở lần download tiếp theo.