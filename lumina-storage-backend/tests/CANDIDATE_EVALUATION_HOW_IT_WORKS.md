# Candidate Evaluation — Nguyen ly hoat dong chi tiet

## Tong quan kien truc

```
Frontend (React)                    Backend (FastAPI)                    External
┌──────────────┐                   ┌─────────────────┐                 ┌──────────┐
│  Step Wizard  │──POST /parse-jd──│  API Route       │                │          │
│  (5 buoc)     │──POST /parse-cvs─│       │          │                │  LLM     │
│              │──POST /match──────│       ▼          │───llm_call()──│  (Azure/ │
│              │──POST /gen-q──────│  SkillService    │                │  OpenAI) │
│              │──POST /gen-report─│       │          │                │          │
│              │                   │       ▼          │                └──────────┘
│              │                   │  Tool Script     │                ┌──────────┐
│              │                   │  (parse_jd.py,   │                │          │
│              │◄──JSON response───│   parse_cvs.py,  │───HTML→PDF────│ Gotenberg│
│              │                   │   match.py, ...) │                │          │
└──────────────┘                   └─────────────────┘                └──────────┘
                                          │
                                          ▼
                                   ┌─────────────┐
                                   │  Storage     │  (MinIO/S3/Local)
                                   │  PostgreSQL  │
                                   └─────────────┘
```

**Diem quan trong:** Frontend giu toan bo state (JD, candidates, rankings, ...) va truyen xuong BE moi buoc. BE **khong luu state** giua cac request — moi API call la **stateless**. Nho vay FE co the quay lai bat ky buoc nao ma khong mat du lieu.

---

## Buoc 1: Parse JD (`parse_jd.py`)

### Frontend lam gi?
1. User chon file JD (drag-drop hoac tu Storage)
2. FE upload file len `/documents/upload` → nhan lai `document_id`
3. FE goi `POST /candidate-evaluation/parse-jd` voi `{ document_id }`
4. Nhan response → luu `jd`, `jdDocumentId` vao React state

### Backend xu ly nhu the nao?

```
document_id
    │
    ▼
[1] ctx.get_document_bytes(document_id)
    → Doc raw bytes tu Storage (S3/MinIO/Local)
    → Query DB lay original_filename de biet extension
    │
    ▼
[2] MarkItDown.convert_stream(bytes, extension)
    → Thu vien "markitdown" cua Microsoft
    → Chuyen PDF/DOCX/TXT → plain text (markdown format)
    → Vd: file .docx → strip formatting → text thuan
    │
    ▼
[3] Truncate neu qua dai (>120,000 ky tu)
    → Tranh vuot context window cua LLM
    │
    ▼
[4] ctx.llm_call([system: JD_PARSE_PROMPT, user: text])
    → Goi LLM (Azure GPT-4.1-mini hoac model user chon)
    → System prompt huong dan LLM phan tich JD
    → response_format={"type": "json_object"} → bat LLM tra JSON
    │
    ▼
[5] Parse JSON response
    → json.loads(result)
    → Neu LLM tra markdown code block → regex extract JSON
    → Ket qua: structured dict voi job_title, skills, experience, ...
    │
    ▼
[6] Build summary string
    → "**Senior Backend Engineer** tai Lumina (3-5 nam)"
    → "Required: Python, FastAPI, PostgreSQL"
    │
    ▼
[7] Return { jd, jd_summary, jd_filename }
```

### LLM duoc yeu cau gi? (JD_PARSE_PROMPT)

Prompt huong dan LLM:
- Trich xuat **TAT CA skills** duoc de cap
- Phan loai: `required` (must-have) vs `nice-to-have`
- Moi skill co `level`: beginner/intermediate/advanced/expert
- Trich xuat: experience range, education, location, responsibilities
- **KHONG bua** thong tin khong co trong tai lieu
- Viet cung ngon ngu voi tai lieu (VN/EN)
- Tra ve JSON voi schema cu the (20+ fields)

### Du lieu sau buoc 1 (FE state)

```
state.jd = {
  job_title: "Senior Backend Engineer",
  required_skills: [{skill: "Python", level: "advanced"}, ...],
  nice_to_have_skills: [{skill: "K8s", level: "intermediate"}, ...],
  experience_range: {min_years: 3, max_years: 5},
  ...
}
state.jdDocumentId = "uuid-jd-1"
```

---

## Buoc 2: Parse CVs (`parse_cvs.py`)

### Frontend lam gi?
1. User chon nhieu file CV (drag-drop hoac Storage, multi-select)
2. FE upload tat ca files → nhan `document_id[]`
3. FE goi `POST /parse-cvs` voi `{ document_ids, jd, existing_candidates }`
4. Nhan response → luu `candidates` vao state

### Backend xu ly nhu the nao?

```
document_ids = ["cv-1", "cv-2", "cv-3", ...]
    │
    ▼
[1] Deduplication
    → So sanh document_ids voi existing_candidates[].document_id
    → Loai bo nhung CV da parse truoc do (tu turn truoc)
    → Neu tat ca da co → tra ve ngay, KHONG goi LLM
    │
    ▼
[2] Tao asyncio.Semaphore(5)
    → Gioi han toi da 5 LLM calls dong thoi
    → Tranh rate limit tu API provider
    │
    ▼
[3] asyncio.gather(*tasks) — XU LY SONG SONG
    │
    ├──[CV-1]──► _parse_one_cv(ctx, sem, "cv-1", index=0)
    ├──[CV-2]──► _parse_one_cv(ctx, sem, "cv-2", index=1)
    └──[CV-3]──► _parse_one_cv(ctx, sem, "cv-3", index=2)
         │
         ▼  (moi CV chay doc lap)
         [3a] async with sem:  ← doi slot trong semaphore
         [3b] ctx.get_document_bytes(doc_id) → raw bytes
         [3c] MarkItDown.convert_stream() → plain text
         [3d] Truncate neu >60,000 ky tu
         [3e] ctx.llm_call([system: CV_PARSE_PROMPT, user: text])
              → LLM trich xuat: name, skills, experience, education, ...
         [3f] parse JSON response
         [3g] Gan index, document_id, original_filename vao result
         [3h] Neu loi → tra ve {error: "..."}  (khong crash ca batch)
    │
    ▼
[4] _compact_candidate(c)
    → Giu lai chi cac field can thiet cho state
    → Bo raw text, projects details → giam kich thuoc JSONB
    │
    ▼
[5] Merge: all_candidates = existing + new_candidates
    │
    ▼
[6] Build summary string + tra ve
```

### Tai sao xu ly song song?

```
Xu ly tuan tu:   CV1(8s) → CV2(8s) → CV3(8s) = 24s tong
Xu ly song song: CV1(8s) ─┐
                 CV2(8s) ─┤ = 8s tong (nhanh gap 3 lan)
                 CV3(8s) ─┘

Semaphore(5) = toi da 5 dong thoi:
- 10 CV → 2 batch: batch1(5 CV, 8s) + batch2(5 CV, 8s) = ~16s
- 50 CV → 10 batch: ~80s (thay vi 400s tuan tu)
```

### Tai sao compact?

CV goc sau khi LLM parse co the co ~50 fields chi tiet (projects, experience history, ...).
Nhung cho buoc 3 (scoring) chi can: name, skills, experience_years, education summary.
`_compact_candidate()` giu 15 fields thiet yeu, bo phan con lai → giam 60-70% kich thuoc JSON.
Quan trong vi state se duoc truyen di truyen lai giua FE va BE moi buoc.

### Du lieu sau buoc 2

```
state.candidates = [
  {index: 0, name: "Nguyen Van A", skills: ["Python", "FastAPI", ...], experience_years: 6, ...},
  {index: 1, name: "Tran Thi B", skills: ["React", "TypeScript"], experience_years: 3, ...},
  {index: 2, name: "Le Van C", skills: ["Python", "React"], experience_years: 4, ...},
]
```

---

## Buoc 3: Match & Score (`match_candidates.py`)

### Frontend lam gi?
1. User chon top_n (3, 5, 10, All)
2. FE goi `POST /match` voi `{ jd, candidates, top_n }`
3. Nhan response → luu `rankings`, `shortlistIndices` vao state

### Backend xu ly nhu the nao?

```
jd + candidates + top_n
    │
    ▼
[1] Validate
    → Kiem tra jd != null, candidates != empty
    → Loc bo candidates co truong "error" (loi parse tu buoc 2)
    │
    ▼
[2] Format du lieu cho LLM
    │
    ├── _format_jd_for_prompt(jd)
    │   → "Job Title: Senior Backend Engineer"
    │   → "Required Skills:"
    │   → "  - Python (advanced)"
    │   → "  - FastAPI (advanced)"
    │   → ...
    │
    └── _format_candidate_for_prompt(c)  × N candidates
        → "Candidate #0: Nguyen Van A"
        → "  Current: Backend Engineer at ABC Corp"
        → "  Experience: 6 years"
        → "  Skills: Python, FastAPI, PostgreSQL, Docker"
        → "  Education: BS CS (HCMUT)"
    │
    ▼
[3] Chia batch neu >15 candidates
    → Batch 1: candidate 0-14  → 1 LLM call
    → Batch 2: candidate 15-29 → 1 LLM call
    → ...
    → Tranh vuot context window (15 CV × ~500 chars = ~7500 chars, an toan)
    │
    ▼
[4] ctx.llm_call([system: MATCH_SCORE_PROMPT, user: JD + candidates])
    │
    │   LLM duoc yeu cau:
    │   ┌────────────────────────────────────────────────┐
    │   │  Voi MOI ung vien, cham diem 0-100:            │
    │   │                                                │
    │   │  required_skills     (trong so 40%)            │
    │   │    → Ung vien co bao nhieu required skills?    │
    │   │    → Trinh do (advanced/intermediate) phu hop? │
    │   │                                                │
    │   │  nice_to_have_skills (trong so 15%)            │
    │   │    → Co bonus skills nao tu JD?                │
    │   │                                                │
    │   │  experience_relevance (trong so 25%)           │
    │   │    → So nam kinh nghiem phu hop?               │
    │   │    → Kinh nghiem co lien quan den vai tro?     │
    │   │                                                │
    │   │  education_fit       (trong so 10%)            │
    │   │    → Bang cap + chuyen nganh phu hop?          │
    │   │                                                │
    │   │  overall_impression  (trong so 10%)            │
    │   │    → Location, language, certifications?       │
    │   │                                                │
    │   │  total = 0.4*req + 0.15*nice + 0.25*exp       │
    │   │        + 0.1*edu + 0.1*overall                 │
    │   │                                                │
    │   │  + strengths[] (diem manh cu the)              │
    │   │  + gaps[] (thieu sot cu the)                   │
    │   │  + recommendation: strong/good/moderate/weak   │
    │   └────────────────────────────────────────────────┘
    │
    ▼
[5] Parse JSON response → list evaluations
    │
    ▼
[6] Sort by total_score DESC
    → Ung vien diem cao nhat xep dau
    │
    ▼
[7] Gan rank (1, 2, 3, ...)
    │
    ▼
[8] Lay top_n → shortlist_indices
    │
    ▼
[9] Return { rankings, shortlist_count, shortlist_indices }
```

### Vi du cu the voi 3 ung vien

```
LLM nhan:

JOB DESCRIPTION:
  Job Title: Senior Backend Engineer
  Required Skills: Python (advanced), FastAPI (advanced), PostgreSQL (intermediate)
  Experience: 3-5 years

CANDIDATES:
  #0: Nguyen Van A — Backend Engineer, 6yr, [Python, FastAPI, PostgreSQL, Docker]
  #1: Tran Thi B — Frontend Developer, 3yr, [React, TypeScript]
  #2: Le Van C — Fullstack Developer, 4yr, [Python, React, Node.js]

LLM tra ve:

  #0 Nguyen Van A:  req=90  nice=60  exp=88  edu=80  overall=85  → total=85  → STRONG FIT
                    strengths: "Strong Python/FastAPI match, 6yr relevant exp"
                    gaps: "No Kubernetes experience"

  #1 Tran Thi B:    req=20  nice=10  exp=30  edu=70  overall=40  → total=35  → NOT RECOMMENDED
                    strengths: "Good education"
                    gaps: "No Python, Frontend not Backend"

  #2 Le Van C:      req=55  nice=30  exp=60  edu=75  overall=55  → total=55  → MODERATE FIT
                    strengths: "Some Python experience"
                    gaps: "Limited FastAPI, more frontend than backend"

Sau sort: [#0(85), #2(55), #1(35)]
Top 2 shortlist: [0, 2]
```

---

## Buoc 4: Generate Questions (`generate_questions.py`)

### Frontend lam gi?
1. FE goi `POST /generate-questions` voi `{ jd, candidates, rankings, shortlist_indices }`
2. Nhan response → luu `candidateQuestions` vao state

### Backend xu ly nhu the nao?

```
jd + candidates + rankings + shortlist_indices
    │
    ▼
[1] Xac dinh target candidates
    → Neu user chi dinh candidate_indices → dung do
    → Neu khong → dung shortlist_indices tu buoc 3
    → Neu khong co shortlist → tat ca candidates
    │
    ▼
[2] Voi MOI ung vien, build context rieng
    │
    │   _build_candidate_context(jd, candidate, ranking):
    │   ┌──────────────────────────────────────────┐
    │   │  JOB DESCRIPTION:                        │
    │   │    Title: Senior Backend Engineer         │
    │   │    Required Skills: Python, FastAPI, ...  │
    │   │    Responsibilities: Design APIs, ...     │
    │   │                                          │
    │   │  CANDIDATE: Nguyen Van A                 │
    │   │    Current Role: Backend Engineer         │
    │   │    Skills: Python, FastAPI, PostgreSQL    │
    │   │                                          │
    │   │  EVALUATION SCORE: 85/100                │
    │   │    Strengths: Strong Python match         │
    │   │    Gaps: No Kubernetes experience   ◄──── QUAN TRONG
    │   │    Recommendation: strong_fit             │
    │   └──────────────────────────────────────────┘
    │
    ▼
[3] Song song: asyncio.gather(*tasks), semaphore=5
    │
    ├──[Candidate 0]──► ctx.llm_call(INTERVIEW_QUESTIONS_PROMPT + context)
    └──[Candidate 2]──► ctx.llm_call(INTERVIEW_QUESTIONS_PROMPT + context)
    │
    ▼
[4] LLM tao 8-12 cau hoi/ung vien:
    │
    │   ┌─────────────────────────────────────────────────────┐
    │   │  3-4 TECHNICAL (nhám vao GAP)                       │
    │   │    "Ban co kinh nghiem voi Kubernetes khong?"        │
    │   │     purpose: "Kiem tra gap: khong co K8s experience" │
    │   │                                                     │
    │   │  2-3 BEHAVIORAL (STAR format)                       │
    │   │    "Ke ve mot lan xu ly bug production"              │
    │   │     purpose: "Danh gia kha nang xu ly su co"        │
    │   │                                                     │
    │   │  2-3 SITUATIONAL (lien quan JD responsibilities)    │
    │   │    "Neu phai thiet ke API cho 10K concurrent..."     │
    │   │     purpose: "Danh gia kha nang thiet ke he thong"  │
    │   │                                                     │
    │   │  1-2 ROLE SPECIFIC (domain knowledge)               │
    │   │    "Giai thich event-driven architecture"            │
    │   │     purpose: "Kiem tra kien thuc chuyen sau"        │
    │   └─────────────────────────────────────────────────────┘
    │
    ▼
[5] Gom ket qua → index by candidate_index
    │
    ▼
[6] Return { candidate_questions, interview_questions }
```

### Diem then chot: Cau hoi duoc "tailored"

LLM khong chi tao cau hoi chung chung. No nhan duoc **gaps** tu buoc 3:
- Neu gap = "No Kubernetes" → tao cau hoi ve container orchestration
- Neu gap = "Limited team lead" → tao cau hoi ve leadership
- Neu strength = "Strong Python" → tao cau hoi advanced Python

→ Moi ung vien co bo cau hoi **khac nhau**, tap trung vao diem yeu cua ho.

---

## Buoc 5: Generate Report (`generate_report.py`)

### Frontend lam gi?
1. FE goi `POST /generate-report` voi toan bo state
2. Nhan `rendered_document_id` → hien nut Download + Preview

### Backend xu ly nhu the nao?

```
toan bo state (jd + candidates + rankings + interview_questions)
    │
    ▼
[1] Validate: phai co jd + rankings
    │
    ▼
[2] render_evaluation_report(state) → HTML string
    │
    │   _report.py build HTML:
    │   ┌──────────────────────────────────────────────────────┐
    │   │  <html>                                              │
    │   │  <style> CSS A4 layout, tables, colors </style>      │
    │   │                                                      │
    │   │  ┌─ HEADER (mau xanh dam) ─────────────────────────┐ │
    │   │  │ BAO CAO DANH GIA UNG VIEN                       │ │
    │   │  │ Vi tri: Senior Backend Engineer | Ngay: 13/04    │ │
    │   │  └─────────────────────────────────────────────────┘ │
    │   │                                                      │
    │   │  ┌─ SUMMARY BOX ───────────────────────────────────┐ │
    │   │  │ Sang loc 3 ung vien, shortlist top 2            │ │
    │   │  └─────────────────────────────────────────────────┘ │
    │   │                                                      │
    │   │  ┌─ SECTION 1: THONG TIN VI TRI ──────────────────┐ │
    │   │  │ Bang: title, company, location, exp, skills     │ │
    │   │  │ Required Skills: [Python] [FastAPI] [PostgreSQL]│ │
    │   │  │ Nice-to-have:    [Kubernetes] [AWS]             │ │
    │   │  └─────────────────────────────────────────────────┘ │
    │   │                                                      │
    │   │  ┌─ SECTION 2: BANG XEP HANG ─────────────────────┐ │
    │   │  │ # │ Ten          │Tong│Skills│Exp │Edu│Danh gia│ │
    │   │  │ 1 │ Nguyen Van A │ 85 │  90  │ 88 │ 80│STRONG  │ │
    │   │  │ 2 │ Le Van C     │ 55 │  55  │ 60 │ 75│MODERATE│ │
    │   │  │ 3 │ Tran Thi B   │ 35 │  20  │ 30 │ 70│NOT REC │ │
    │   │  │                                                 │ │
    │   │  │ Diem so color-coded:                            │ │
    │   │  │   >=75: XANH    50-74: VANG    <50: DO         │ │
    │   │  └─────────────────────────────────────────────────┘ │
    │   │                                                      │
    │   │  ┌─ SECTION 3: CHI TIET SHORTLIST ────────────────┐ │
    │   │  │ Card #1 — Nguyen Van A (85/100) [STRONG FIT]   │ │
    │   │  │   Vi tri: Backend Engineer @ ABC Corp           │ │
    │   │  │   Skills: [Python] [FastAPI] [PostgreSQL]       │ │
    │   │  │   Score breakdown:                              │ │
    │   │  │     Required Skills    90  (40%)                │ │
    │   │  │     Nice-to-have       60  (15%)                │ │
    │   │  │     Experience         88  (25%)                │ │
    │   │  │     Education          80  (10%)                │ │
    │   │  │     Overall            85  (10%)                │ │
    │   │  │   Strengths: + Strong Python/FastAPI match      │ │
    │   │  │   Gaps:      - No Kubernetes experience         │ │
    │   │  └─────────────────────────────────────────────────┘ │
    │   │                                                      │
    │   │  ┌─ SECTION 4: CAU HOI PHONG VAN (neu co) ────────┐ │
    │   │  │ Nguyen Van A:                                   │ │
    │   │  │   Ky thuat (4 cau)                              │ │
    │   │  │     1. Describe FastAPI middleware experience    │ │
    │   │  │        Muc dich: Assess FastAPI proficiency      │ │
    │   │  │   Hanh vi (3 cau)                               │ │
    │   │  │     ...                                         │ │
    │   │  └─────────────────────────────────────────────────┘ │
    │   │                                                      │
    │   │  ┌─ FOOTER ───────────────────────────────────────┐ │
    │   │  │ Lumina AI | 13/04/2026 14:30 UTC                │ │
    │   │  └─────────────────────────────────────────────────┘ │
    │   │  </html>                                             │
    │   └──────────────────────────────────────────────────────┘
    │
    ▼
[3] _html_to_pdf(html, gotenberg_url)
    │
    │   ┌────────────────────────────────────────────────┐
    │   │  POST http://gotenberg:3000                    │
    │   │       /forms/chromium/convert/html              │
    │   │                                                │
    │   │  Body: multipart form                          │
    │   │    files: index.html (HTML string)             │
    │   │    marginTop: 0.4                              │
    │   │    marginBottom: 0.4                           │
    │   │    printBackground: true                       │
    │   │                                                │
    │   │  Gotenberg ben trong:                          │
    │   │    1. Mo Chromium headless                     │
    │   │    2. Render HTML nhu trinh duyet              │
    │   │    3. "Print to PDF" voi trang A4              │
    │   │    4. Tra ve PDF bytes                         │
    │   └────────────────────────────────────────────────┘
    │
    ▼
[4] ctx.save_rendered_document(pdf_bytes, source_doc_id)
    │
    │   ┌────────────────────────────────────────────────┐
    │   │  1. Lay source document tu DB (file JD goc)    │
    │   │  2. Lay StorageConfig (S3/MinIO/Local)         │
    │   │  3. Tao ten file: "jd_candidate_evaluation.pdf"│
    │   │  4. Upload PDF len storage backend             │
    │   │  5. Tao record moi trong documents_document    │
    │   │     - source_type: "skill_temp"                │
    │   │     - mime_type: "application/pdf"             │
    │   │     - source_metadata: {source_document_id}    │
    │   │  6. Tra ve UUID cua document moi               │
    │   └────────────────────────────────────────────────┘
    │
    ▼
[5] Return { rendered_document_id, preview_pdf_id }
    │
    ▼
[6] Frontend nhan UUID
    → Hien nut "Tai bao cao PDF"
    → Click → GET /documents/{uuid}/download → browser download
    → Hien nut "Xem"
    → Click → iframe src="/documents/{uuid}/preview"
```

---

## Toan bo data flow (5 buoc)

```
                    ┌─────── FE React State ───────┐
                    │                               │
Buoc 1: Parse JD    │  jd ──────────────────────┐   │
        (1 LLM call)│  jdDocumentId             │   │
                    │                           │   │
Buoc 2: Parse CVs   │  candidates ──────────┐   │   │
        (N LLM call)│                       │   │   │
                    │                       ▼   ▼   │
Buoc 3: Match       │  rankings ────────┐  JD+CVs  │
        (1-K LLM)   │  shortlistIndices │   │       │
                    │                   │   │       │
                    │                   ▼   ▼       │
Buoc 4: Questions   │  interviewQs ─┐  JD+CVs      │
        (M LLM call)│               │  +Rankings    │
                    │               │   │           │
                    │               ▼   ▼           │
Buoc 5: Report      │  reportDocId  ALL DATA        │
        (0 LLM call)│  (chi render HTML→PDF)        │
                    │                               │
                    └───────────────────────────────┘

Tong LLM calls cho 10 CV, top 5:
  Buoc 1: 1 call  (parse JD)
  Buoc 2: 10 calls (1/CV, song song, max 5 dong thoi)
  Buoc 3: 1 call  (score 10 candidates cung luc)
  Buoc 4: 5 calls (1/shortlisted candidate, song song)
  Buoc 5: 0 calls (chi render HTML → Gotenberg → PDF)
  ─────────────────
  Tong: 17 LLM calls

Thoi gian uoc tinh (8s/LLM call):
  Buoc 1: ~8s
  Buoc 2: ~16s (10 CV / 5 dong thoi = 2 batch × 8s)
  Buoc 3: ~8s
  Buoc 4: ~8s  (5 candidates / 5 dong thoi = 1 batch)
  Buoc 5: ~5s  (Gotenberg render)
  ─────────────────
  Tong: ~45s cho toan bo flow
```

---

## So sanh: No-Prompt UI vs Chat Agent

| Khia canh | No-Prompt UI (trang rieng) | Chat Agent |
|-----------|---------------------------|------------|
| Ai dieu phoi? | **Frontend** (step wizard) | **Agent** (LangGraph ReAct) |
| State luu o dau? | **FE React state** (truyen xuong moi request) | **DB ChatMessage.skill_result** (_state JSONB) |
| Bao nhieu request? | **5 request** (1 per step) | **5 tool calls** (trong 1 hoac nhieu turns) |
| User control? | **Cao** (chon top_n, chon candidates, quay lai) | **Thap** (agent tu quyet dinh) |
| Cung tool scripts? | **Co** — API routes goi `SkillService.run_tool()` | **Co** — Agent goi `run_script()` |
| LLM goi giong nhau? | **Co** — cung prompts, cung ctx.llm_call() | **Co** — chinh xac |
