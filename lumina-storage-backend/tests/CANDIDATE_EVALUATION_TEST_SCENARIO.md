# Test Scenario: Candidate Evaluation

## Muc tieu

Test toan bo flow 5 buoc cua tinh nang Candidate Evaluation:
1. Upload & phan tich JD
2. Upload & boc tach CV
3. Cham diem & xep hang
4. Tao cau hoi phong van
5. Xuat bao cao PDF

---

## Chuan bi

### Sample files can thiet

| File | Mo ta | Noi dung mau |
|------|-------|--------------|
| `sample_jd.pdf` hoac `.docx` | Job Description mau | Vi tri Senior Backend Engineer, yeu cau Python/FastAPI, 3-5 nam |
| `cv_nguyen_van_a.pdf` | CV ung vien match tot | Backend Engineer, 6 nam Python, FastAPI, PostgreSQL |
| `cv_tran_thi_b.pdf` | CV ung vien khong match | Frontend Developer, 3 nam React/TypeScript |
| `cv_le_van_c.pdf` | CV ung vien match trung binh | Fullstack, 2 nam Python + 2 nam React |

### Dieu kien

- Backend dang chay: `uvicorn main:app --reload --port 1688`
- Redis + Gotenberg dang chay: `docker compose -f docker-compose.local.yml up -d`
- Frontend dang chay: `npm run dev` (port 5173)
- Da dang nhap voi tai khoan co quyen

---

## Buoc 1: Upload & Phan tich JD

### 1.1 Test qua giao dien (FE)

1. Truy cap `http://localhost:5173/candidate-evaluation`
2. O **Step 1 - Job Description**, keo tha file `sample_jd.pdf` vao vung upload
3. Nhan nut **"Phan tich JD"**
4. Cho loading hoan tat

**Ket qua mong doi:**
- Hien thi structured JD voi:
  - Job title (vd: "Senior Backend Engineer")
  - Company name
  - Location
  - Experience range (3-5 nam)
  - Required Skills dang tags xanh (Python, FastAPI, PostgreSQL, ...)
  - Nice-to-have Skills dang tags xam (Kubernetes, AWS, ...)
- Nut "Tiep theo" duoc enable

### 1.2 Test chon tu Storage

1. Nhan nut **"Tu Storage"** thay vi upload
2. Modal DocumentPicker hien thi danh sach file
3. Chon 1 file JD da co san
4. He thong tu dong phan tich

**Ket qua mong doi:** Giong 1.1

### 1.3 Test API truc tiep

```bash
# Upload file JD truoc
curl -X POST http://localhost:1688/api/v1/documents/upload \
  -H "Authorization: Bearer <token>" \
  -F "files=@sample_jd.pdf" \
  -F "source_type=chat_attachment"
```

Response:
```json
[{"id": "uuid-jd-1", "original_filename": "sample_jd.pdf", ...}]
```

```bash
# Parse JD
curl -X POST http://localhost:1688/api/v1/candidate-evaluation/parse-jd \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"document_id": "uuid-jd-1"}'
```

Response mong doi:
```json
{
  "jd": {
    "job_title": "Senior Backend Engineer",
    "company": "Lumina Technology JSC",
    "location": "Ho Chi Minh City",
    "experience_range": {"min_years": 3, "max_years": 5, "preferred_years": 4},
    "required_skills": [
      {"skill": "Python", "level": "advanced", "priority": "must-have"},
      {"skill": "FastAPI", "level": "advanced", "priority": "must-have"},
      {"skill": "PostgreSQL", "level": "intermediate", "priority": "must-have"}
    ],
    "nice_to_have_skills": [
      {"skill": "Kubernetes", "level": "intermediate", "priority": "nice-to-have"}
    ],
    "education": {"min_level": "Bachelor", "preferred_fields": ["Computer Science"]},
    "responsibilities": ["Design and implement backend APIs", "Write tests", ...],
    "summary": "Senior Backend Engineer tai Lumina, yeu cau 3-5 nam Python/FastAPI."
  },
  "jd_summary": "**Senior Backend Engineer** tai Lumina Technology JSC (3-5 nam)\nRequired: Python, FastAPI, PostgreSQL, ...",
  "jd_filename": "sample_jd.pdf",
  "jd_document_id": "uuid-jd-1"
}
```

### 1.4 Test loi

| Case | Input | Ket qua mong doi |
|------|-------|------------------|
| Khong chon file | Nhan "Phan tich" khi chua upload | Nut bi disable |
| File rong | Upload file 0 bytes | Error: "File JD khong co noi dung text" |
| Khong dang nhap | Goi API khong co token | 401 Unauthorized |

---

## Buoc 2: Upload & Boc tach CV

### 2.1 Test qua giao dien

1. Tu Step 1 nhan **"Tiep theo"** sang Step 2
2. Keo tha 3 file CV vao vung upload (hoac nhan "Chon files")
3. Nhan **"Boc tach 3 CV"**
4. Cho loading (moi CV xu ly khoang 5-10s)

**Ket qua mong doi:**
- Hien thi danh sach CandidateCard:
  - Moi card co: Ten, vai tro hien tai, so nam kinh nghiem, skill tags
  - CV loi hien thi card do voi thong bao loi
- Toast: "Da boc tach 3 CV"

### 2.2 Test them CV

1. Sau khi da boc tach 3 CV, upload them 2 CV nua
2. Nhan **"Boc tach 2 CV"**

**Ket qua mong doi:**
- Tong cong 5 candidates hien thi
- CV trung (cung document_id) bi bo qua, khong parse lai

### 2.3 Test API truc tiep

```bash
# Upload 3 CV
curl -X POST http://localhost:1688/api/v1/documents/upload \
  -H "Authorization: Bearer <token>" \
  -F "files=@cv_nguyen_van_a.pdf" \
  -F "files=@cv_tran_thi_b.pdf" \
  -F "files=@cv_le_van_c.pdf" \
  -F "source_type=chat_attachment"
```

```bash
# Parse CVs
curl -X POST http://localhost:1688/api/v1/candidate-evaluation/parse-cvs \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "document_ids": ["uuid-cv-1", "uuid-cv-2", "uuid-cv-3"],
    "jd": { <structured JD tu buoc 1> },
    "jd_document_id": "uuid-jd-1",
    "existing_candidates": []
  }'
```

Response mong doi:
```json
{
  "candidates_count": 3,
  "new_parsed": 3,
  "errors": null,
  "candidates_summary": "Da phan tich 3/3 CV moi.\n\n- Nguyen Van A - Backend Engineer (6 nam) [Python, FastAPI, ...]\n- Tran Thi B - Frontend Developer (3 nam) [React, TypeScript]\n- Le Van C - Fullstack (4 nam) [Python, React]",
  "candidates": [
    {
      "index": 0,
      "document_id": "uuid-cv-1",
      "name": "Nguyen Van A",
      "current_role": "Backend Engineer",
      "experience_years": 6,
      "skills": ["Python", "FastAPI", "PostgreSQL", "Docker"],
      "education": [{"degree": "BS", "field": "Computer Science", "school": "HCMUT"}],
      "summary": "Backend Engineer 6 nam kinh nghiem Python/FastAPI."
    },
    ...
  ]
}
```

### 2.4 Test loi

| Case | Input | Ket qua mong doi |
|------|-------|------------------|
| File khong doc duoc | Upload file .exe | Error per-CV, cac CV khac van duoc parse |
| CV trung lap | Upload lai cung file | "Khong co CV moi", candidates giu nguyen |
| Khong co document_ids | Body rong | 400: "Can cung cap document_ids" |

---

## Buoc 3: Cham diem & Xep hang

### 3.1 Test qua giao dien

1. Sang Step 3
2. Chon **Top 3** (hoac Top 5, All)
3. Nhan **"Cham diem & Xep hang"**

**Ket qua mong doi:**
- Bang xep hang voi cot: #, Ung vien, Tong diem, Skills, Exp, Edu, Danh gia
- Diem so color-coded: xanh (>=75), vang (50-74), do (<50)
- Badge recommendation: "STRONG FIT", "GOOD FIT", "MODERATE", ...
- Click vao ung vien → expand chi tiet: score breakdown, strengths, gaps

### 3.2 Test API truc tiep

```bash
curl -X POST http://localhost:1688/api/v1/candidate-evaluation/match \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "jd": { <structured JD> },
    "candidates": [ <danh sach candidates tu buoc 2> ],
    "top_n": 3
  }'
```

Response mong doi:
```json
{
  "shortlist_count": 3,
  "total_evaluated": 3,
  "rankings_summary": "Da danh gia 3 ung vien. Top 3:\n  1. Nguyen Van A - 85/100 (Strong)\n  2. Le Van C - 62/100 (Moderate)\n  3. Tran Thi B - 35/100 (Not recommended)",
  "rankings": [
    {
      "rank": 1,
      "candidate_index": 0,
      "name": "Nguyen Van A",
      "total_score": 85,
      "scores": {
        "required_skills": 90,
        "nice_to_have_skills": 60,
        "experience_relevance": 88,
        "education_fit": 80,
        "overall_impression": 85
      },
      "strengths": ["Strong Python/FastAPI match", "6 years relevant experience"],
      "gaps": ["No Kubernetes experience"],
      "recommendation": "strong_fit",
      "recommendation_note": "Excellent match for the role."
    },
    ...
  ],
  "shortlist_indices": [0, 2, 1]
}
```

### 3.3 Kiem tra tinh nhat quan

| Tieu chi | Trong so | Y nghia |
|----------|----------|---------|
| required_skills | 40% | Ung vien co bao nhieu required skills, trinh do phu hop? |
| nice_to_have_skills | 15% | Bonus skills? |
| experience_relevance | 25% | So nam + muc do lien quan? |
| education_fit | 10% | Bang cap + chuyen nganh? |
| overall_impression | 10% | Location, language, certifications? |

**Kiem tra:** `total_score` = 0.4*required + 0.15*nice + 0.25*exp + 0.1*edu + 0.1*overall (cho phep sai lech +-2 do lam tron LLM)

### 3.4 Test loi

| Case | Input | Ket qua mong doi |
|------|-------|------------------|
| Chua parse JD | Goi match khi chua co JD | 400: "Chua co JD" |
| Chua parse CV | Goi match khi chua co candidates | 400: "Chua co CV" |
| Tat ca CV loi | Candidates deu co truong "error" | 400: "Khong co CV nao boc tach thanh cong" |

---

## Buoc 4: Tao cau hoi phong van

### 4.1 Test qua giao dien

1. Sang Step 4
2. Nhan **"Tao cau hoi phong van"**
3. Cho loading

**Ket qua mong doi:**
- Tab cho moi ung vien shortlisted
- Cau hoi chia theo category: Ky thuat, Hanh vi (STAR), Tinh huong, Chuyen mon
- Moi cau hoi co: question, purpose, follow-up
- Nut copy (📋) ben canh moi cau hoi

### 4.2 Test API truc tiep

```bash
curl -X POST http://localhost:1688/api/v1/candidate-evaluation/generate-questions \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "jd": { <structured JD> },
    "candidates": [ <candidates> ],
    "rankings": [ <rankings tu buoc 3> ],
    "shortlist_indices": [0, 2],
    "candidate_indices": [0]
  }'
```

Response mong doi:
```json
{
  "questions_count": 10,
  "candidates_count": 1,
  "questions_summary": "Da tao 10 cau hoi phong van cho 1 ung vien.",
  "candidate_questions": [
    {
      "candidate_index": 0,
      "name": "Nguyen Van A",
      "questions": [
        {
          "category": "technical",
          "question": "Hay mo ta kinh nghiem cua ban voi FastAPI middleware va dependency injection.",
          "purpose": "Danh gia do sau kien thuc FastAPI (required skill)",
          "expected_good_answer": "Giai thich cu the ve middleware chain, Depends(), ...",
          "follow_up": "Ban xu ly authentication/authorization nhu the nao?"
        },
        {
          "category": "technical",
          "question": "Ban da lam viec voi Kubernetes chua? Neu chua, ban hieu gi ve container orchestration?",
          "purpose": "Kiem tra gap: khong co K8s experience",
          "expected_good_answer": "...",
          "follow_up": "..."
        },
        {
          "category": "behavioral",
          "question": "Hay ke ve mot lan ban phai xu ly mot bug nghiem trong trong production.",
          "purpose": "Danh gia kha nang xu ly su co (STAR format)",
          "expected_good_answer": "...",
          "follow_up": "Ban da thay doi quy trinh gi sau do?"
        },
        ...
      ]
    }
  ],
  "interview_questions": {
    "0": [ <same questions array> ]
  }
}
```

### 4.3 Kiem tra chat luong cau hoi

- [ ] 8-12 cau hoi tong cong
- [ ] 3-4 cau technical nhac vao GAP da phat hien
- [ ] 2-3 cau behavioral theo format STAR
- [ ] 2-3 cau situational lien quan JD responsibilities
- [ ] Moi cau co purpose ro rang
- [ ] Cau hoi phu hop voi trinh do ung vien

---

## Buoc 5: Xuat bao cao PDF

### 5.1 Test qua giao dien

1. Sang Step 5
2. Xem tong ket: so ung vien, so da xep hang, so co cau hoi PV
3. Nhan **"Xuat bao cao PDF"**
4. Cho loading (5-10s, can Gotenberg)

**Ket qua mong doi:**
- Nut **"Tai bao cao PDF"** xuat hien (mau xanh)
- Nut **"Xem"** xuat hien
- Nhan "Xem" → iframe preview PDF
- Nhan "Tai" → download file PDF

### 5.2 Test API truc tiep

```bash
curl -X POST http://localhost:1688/api/v1/candidate-evaluation/generate-report \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "jd": { <structured JD> },
    "candidates": [ <candidates> ],
    "rankings": [ <rankings> ],
    "interview_questions": { "0": [ <questions> ] },
    "jd_document_id": "uuid-jd-1",
    "top_n": 3
  }'
```

Response mong doi:
```json
{
  "rendered_document_id": "uuid-report-pdf",
  "preview_pdf_id": "uuid-report-pdf",
  "summary": "Bao cao danh gia ung vien cho vi tri Senior Backend Engineer: 3 ung vien, top 3 shortlist."
}
```

### 5.3 Kiem tra noi dung PDF

Mo file PDF da tai ve, kiem tra:

- [ ] **Trang 1 - Header:** "Bao Cao Danh Gia Ung Vien", ten vi tri, ngay
- [ ] **Tong quan:** So ung vien, so shortlist
- [ ] **Thong tin vi tri:** Bang JD summary (title, company, location, skills)
- [ ] **Bang xep hang:** Bang co cot #, Ten, Diem, Skills, Exp, Edu, Danh gia
- [ ] **Diem so color-coded:** xanh/vang/do dung theo nguong 75/50
- [ ] **Chi tiet ung vien:** Card cho moi ung vien shortlist voi score breakdown, strengths, gaps
- [ ] **Cau hoi phong van:** (neu da tao) nhom theo category
- [ ] **Footer:** "Lumina AI" + timestamp

### 5.4 Test loi

| Case | Input | Ket qua mong doi |
|------|-------|------------------|
| Gotenberg khong chay | Gotenberg container tat | 400/500: "Khong the tao PDF" |
| Chua co rankings | Bo qua buoc 3 | 400: "Chua co ket qua danh gia" |
| Chua co JD | Bo qua buoc 1 | 400: "Chua co du lieu JD" |

---

## Test tich hop Chat (Agent mode)

Ngoai No-Prompt UI, skill cung hoat dong trong Chat interface.

### Test trong Chat

1. Truy cap `/chat`, tao session moi
2. Upload file JD, nhan: **"Toi muon danh gia ung vien cho vi tri nay"**
3. Agent se goi `parse_jd.py` → tra ve structured JD
4. Upload 3 CV, nhan: **"Day la CV ung vien"**
5. Agent goi `parse_cvs.py` → tra ve danh sach
6. Nhan: **"Top 2"**
7. Agent goi `match_candidates.py` → tra ranking
8. Nhan: **"Tao cau hoi phong van"**
9. Agent goi `generate_questions.py`
10. Nhan: **"Xuat bao cao"**
11. Agent goi `generate_report.py` → `skill_done` SSE event → FileAttachmentCard hien thi

**Ket qua mong doi:** FileAttachmentCard xuat hien voi nut Download/Preview

---

## Checklist tong hop

### Buoc 1 - JD
- [ ] Upload file JD thanh cong
- [ ] Chon tu Storage thanh cong
- [ ] Structured JD hien thi dung (title, skills, experience)
- [ ] Required/Nice-to-have skills phan biet ro
- [ ] Loi: file rong, khong dang nhap

### Buoc 2 - CV
- [ ] Upload nhieu CV cung luc
- [ ] Boc tach song song (khong doi tung file)
- [ ] CandidateCard hien thi dung thong tin
- [ ] CV loi hien thi card do voi thong bao
- [ ] Dedup: khong parse lai CV da co
- [ ] Upload them CV → merge vao danh sach

### Buoc 3 - Ranking
- [ ] Chon top_n (3, 5, 10, All)
- [ ] Bang xep hang dung thu tu (diem cao nhat tren cung)
- [ ] Score color-coded: xanh >=75, vang 50-74, do <50
- [ ] Expand chi tiet: score breakdown, strengths, gaps
- [ ] Recommendation badge dung
- [ ] total_score ~= weighted average (sai lech +-2)

### Buoc 4 - Phong van
- [ ] Tab cho moi ung vien
- [ ] Cau hoi chia theo category
- [ ] 8-12 cau/ung vien
- [ ] Cau technical nhac vao gap
- [ ] Cau behavioral theo STAR
- [ ] Nut copy hoat dong

### Buoc 5 - Report
- [ ] PDF tao thanh cong (can Gotenberg)
- [ ] Download file PDF
- [ ] Preview trong iframe
- [ ] Noi dung PDF day du (JD, ranking, chi tiet, cau hoi)
- [ ] Diem so color-coded trong PDF

### Cross-cutting
- [ ] Tat ca endpoint yeu cau authentication (401 khi khong co token)
- [ ] Nut "Quay lai" / "Tiep theo" hoat dong dung
- [ ] Step indicator hien thi dung trang thai (completed/current/pending)
- [ ] Chuyen step chi duoc khi buoc truoc hoan tat
- [ ] Hoat dong dung trong Chat agent mode
