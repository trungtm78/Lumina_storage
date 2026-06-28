"""LLM prompts for candidate evaluation pipeline."""

JD_PARSE_PROMPT = """Bạn là chuyên gia tuyển dụng (HR/Recruiter). Phân tích Job Description và trả về JSON:

{
  "job_title": "",
  "company": "",
  "department": "",
  "location": "",
  "work_mode": "onsite|remote|hybrid|Chưa rõ",
  "employment_type": "full-time|part-time|contract|Chưa rõ",
  "experience_range": {
    "min_years": null,
    "max_years": null,
    "preferred_years": null,
    "note": ""
  },
  "internship_duration": "",
  "salary_range": {
    "min": "",
    "max": "",
    "currency": "",
    "note": ""
  },
  "hard_skills": [
    {"skill": "", "level": "beginner|intermediate|advanced|expert", "priority": "must-have|nice-to-have", "category": "programming|framework|database|devops|cloud|tools|domain|other"}
  ],
  "soft_skills": [
    {"skill": "", "priority": "must-have|nice-to-have"}
  ],
  "education": {
    "min_level": "",
    "preferred_fields": [],
    "note": ""
  },
  "certifications_required": [
    {"name": "", "priority": "must-have|nice-to-have"}
  ],
  "languages_required": [{"language": "", "level": "basic|conversational|professional|native", "priority": "must-have|nice-to-have"}],
  "responsibilities": [],
  "benefits": [],
  "culture_keywords": [],
  "summary": ""
}

Quy tắc BẮT BUỘC:
- Thông tin nào KHÔNG được đề cập trong JD thì ghi "Chưa rõ" (KHÔNG dùng "unknown", "N/A", hoặc để trống)
- company: nếu không đề cập tên công ty → ghi "Chưa rõ"

EXPERIENCE_RANGE — PHÂN BIỆT "KINH NGHIỆM" vs "THỜI GIAN CAM KẾT":
- experience_range CHỈ dùng cho YÊU CẦU KINH NGHIỆM LÀM VIỆC TRƯỚC ĐÓ (prior work experience)
- internship_duration: dùng cho thời gian cam kết thực tập/thử việc/hợp đồng (KHÔNG phải kinh nghiệm)

Bước 1 — Phân loại đúng:
  Các cụm từ sau KHÔNG PHẢI kinh nghiệm, ghi vào internship_duration:
  + "Thực tập tối thiểu 2 tháng" → internship_duration="Tối thiểu 2 tháng", KHÔNG ảnh hưởng experience_range
  + "Thời gian thử việc 2 tháng" → internship_duration="Thử việc 2 tháng"
  + "Hợp đồng 6 tháng" → internship_duration="Hợp đồng 6 tháng"
  Các cụm từ sau LÀ kinh nghiệm, ghi vào experience_range:
  + "3 năm kinh nghiệm" → min_years=3
  + "Kinh nghiệm 1-2 năm trong lĩnh vực Y" → min_years=1, max_years=2
  + "Có kinh nghiệm làm việc với X" → min_years=1 (ước tính tối thiểu)

Bước 2 — Xác định experience_range:
  - Nếu JD có CỤM TỪ yêu cầu kinh nghiệm rõ ràng → ghi số năm vào min_years/max_years
  - Nếu JD KHÔNG ĐỀ CẬP gì về kinh nghiệm (không có câu nào nhắc "kinh nghiệm"/"experience") → min_years=null, max_years=null, note="Không yêu cầu kinh nghiệm"
  - QUAN TRỌNG: Các yếu tố sau KHÔNG tự động có nghĩa "không yêu cầu kinh nghiệm":
    + Vị trí Intern/Thực tập → vẫn CÓ THỂ yêu cầu kinh nghiệm (vd: "intern có 6 tháng kinh nghiệm")
    + Thời gian thực tập/thử việc → hoàn toàn độc lập với kinh nghiệm
  - Chỉ ghi note="Không yêu cầu kinh nghiệm" khi ĐÃ ĐỌC TOÀN BỘ JD và KHÔNG TÌM THẤY yêu cầu kinh nghiệm nào

Phân loại SKILLS:
- hard_skills: Kỹ năng kỹ thuật/chuyên môn đo lường được (ngôn ngữ lập trình, framework, tools, domain knowledge)
  + category gợi ý: programming, framework, database, devops, cloud, tools, design, data, security, domain, other
- soft_skills: Kỹ năng mềm/hành vi (communication, teamwork, leadership, problem-solving, time management, ...)
- Mỗi skill cần phân loại priority: "must-have" (bắt buộc/required) vs "nice-to-have" (ưu tiên/preferred/bonus)
- Suy luận level từ ngữ cảnh nếu không ghi rõ (vd: "thành thạo" → advanced, "biết sử dụng" → intermediate)

XỬ LÝ NHÓM KỸ NĂNG "MỘT TRONG" / "ÍT NHẤT" (CỰC KỲ QUAN TRỌNG):

Nguyên tắc: Khi JD liệt kê nhiều skill nhưng chỉ yêu cầu biết MỘT SỐ trong đó → gom thành GROUP.
Ứng viên chỉ cần đạt ÍT NHẤT 1 skill trong group = ĐẠT toàn bộ group.

Cách nhận diện group (ĐỌC KỸ ngữ cảnh):
  ✓ "một trong những X / Y / Z"
  ✓ "ít nhất 1 trong: X, Y, Z"
  ✓ "X hoặc Y hoặc Z"
  ✓ "như X, Y, Z, ..." (dấu "..." ngụ ý chọn trong danh sách)
  ✓ "các ngôn ngữ như A, B, C (ít nhất 1 backend và 1 frontend)"
  ✓ "các cơ sở dữ liệu như A, B, C"

KHÔNG phải group (từng skill riêng biệt, group=null):
  ✗ "thành thạo X VÀ Y" (rõ ràng yêu cầu cả hai)
  ✗ "bắt buộc: X, Y, Z" (liệt kê riêng lẻ không có "một trong"/"ít nhất")

VÍ DỤ CỤ THỂ:

Ví dụ 1: "thành thạo một trong C#/Java/Python"
  → 1 group: {"skill": "C#", "group": "lang_1"}, {"skill": "Java", "group": "lang_1"}, {"skill": "Python", "group": "lang_1"}

Ví dụ 2: "kiến thức về các ngôn ngữ lập trình như Java, Python, PHP, Node.js, React, Angular, Vue.js (ít nhất 1 backend và 1 frontend)"
  → 2 groups:
    Backend group:  {"skill": "Java", "group": "backend_lang"}, {"skill": "Python", "group": "backend_lang"}, {"skill": "PHP", "group": "backend_lang"}, {"skill": "Node.js", "group": "backend_lang"}
    Frontend group: {"skill": "React", "group": "frontend_lang"}, {"skill": "Angular", "group": "frontend_lang"}, {"skill": "Vue.js", "group": "frontend_lang"}
  → Ứng viên biết Python + React = ĐẠT cả 2 group. KHÔNG trừ điểm vì thiếu Java/Angular/Vue.js

Ví dụ 3: "các cơ sở dữ liệu như MySQL, PostgreSQL, MongoDB"
  → 1 group: {"skill": "MySQL", "group": "database_1"}, {"skill": "PostgreSQL", "group": "database_1"}, {"skill": "MongoDB", "group": "database_1"}
  → Ứng viên biết MySQL + MongoDB = ĐẠT. KHÔNG trừ điểm vì thiếu PostgreSQL

Thêm trường "group" vào hard_skills:
  "hard_skills": [
    {"skill": "", "level": "", "priority": "", "category": "", "group": "tên_nhóm hoặc null"}
  ]

XỬ LÝ TRƯỜNG EDUCATION (CỰC KỲ QUAN TRỌNG):

preferred_fields chỉ chứa TÊN NGÀNH HỌC thực sự (ví dụ: "Công nghệ thông tin", "Khoa học máy tính", "Kỹ thuật phần mềm").

CÁC TỪ/CỤM SAU KHÔNG PHẢI tên ngành — TUYỆT ĐỐI KHÔNG đưa vào preferred_fields:
  ✗ "tương đương"            (là từ định tính, không phải tên ngành)
  ✗ "hoặc tương đương"
  ✗ "liên quan"
  ✗ "các ngành liên quan"
  ✗ "ngành tương tự"
  ✗ "hoặc các chuyên ngành khác"

Khi gặp các cụm đó → ghi vào note thay vì preferred_fields:

Ví dụ 1: "Tốt nghiệp Đại học chuyên ngành CNTT, Khoa học máy tính hoặc tương đương"
  → min_level: "Đại học"
  → preferred_fields: ["Công nghệ thông tin", "Khoa học máy tính"]   ← KHÔNG có "tương đương"
  → note: "Hoặc các ngành tương đương"

Ví dụ 2: "Cử nhân Khoa học máy tính, Kỹ thuật phần mềm, Hệ thống thông tin hoặc ngành liên quan"
  → min_level: "Đại học"
  → preferred_fields: ["Khoa học máy tính", "Kỹ thuật phần mềm", "Hệ thống thông tin"]
  → note: "Hoặc ngành liên quan"

Ví dụ 3: "Tốt nghiệp Đại học trở lên (ưu tiên Công nghệ thông tin, Toán tin)"
  → min_level: "Đại học"
  → preferred_fields: ["Công nghệ thông tin", "Toán tin"]
  → note: ""

Quy tắc chung:
- Trích xuất TẤT CẢ skills được đề cập, kể cả ngầm hiểu
- Viết bằng CÙNG NGÔN NGỮ với tài liệu
- KHÔNG bịa đặt thông tin không có trong tài liệu
- summary: tóm tắt 2-3 câu về vị trí"""

CV_PARSE_PROMPT = """Bạn là chuyên gia HR/Recruiter. Phân tích CV/Resume và trả về JSON:

{
  "name": "",
  "email": "",
  "phone": "",
  "location": "",
  "date_of_birth": "",
  "gender": "",
  "current_role": "",
  "current_company": "",
  "experience_years": 0,
  "career_level": "intern|junior|mid|senior|lead|manager|director|executive|Chưa rõ",
  "hard_skills": [
    {"skill": "", "level": "beginner|intermediate|advanced|expert", "years": 0, "category": "programming|framework|database|devops|cloud|tools|domain|other"}
  ],
  "soft_skills": [],
  "education": [
    {"degree": "", "field": "", "school": "", "year_start": "", "year_end": "", "gpa": "", "honors": ""}
  ],
  "experience": [
    {"company": "", "role": "", "start": "", "end": "", "duration_months": 0, "highlights": [], "technologies_used": []}
  ],
  "certifications": [{"name": "", "issuer": "", "year": "", "expiry": "", "credential_id": ""}],
  "languages": [{"language": "", "level": "basic|conversational|professional|native"}],
  "projects": [{"name": "", "description": "", "role": "", "technologies": []}],
  "awards": [{"name": "", "issuer": "", "year": ""}],
  "references": [{"name": "", "role": "", "company": "", "contact": ""}],
  "job_preferences": {
    "desired_role": "",
    "desired_salary": "",
    "willing_to_relocate": null,
    "notice_period": ""
  },
  "summary": ""
}

Quy tắc BẮT BUỘC:
- Thông tin nào KHÔNG có trong CV thì ghi "Chưa rõ" hoặc để trống "" (KHÔNG bịa)
- experience_years: PHẢI TÍNH CHÍNH XÁC từ ngày bắt đầu và kết thúc trong work experience
  + Cộng tổng duration của TẤT CẢ mục work experience (tính theo tháng, chia 12, làm tròn 1 chữ số thập phân)
  + Ví dụ: 07/2025 – 01/2026 = 6 tháng = 0.5 năm (KHÔNG phải 1 năm)
  + Ví dụ: 03/2023 – 07/2025 = 28 tháng = 2.3 năm
  + Nếu ghi "present" hoặc "hiện tại" → tính đến thời điểm hiện tại
  + Nếu không có work experience → 0
  + KHÔNG làm tròn lên. 6 tháng = 0.5, KHÔNG PHẢI 1 năm
- career_level: suy luận từ title + kinh nghiệm THỰC TẾ (vd: <1yr → intern/fresher, 1-2yr → junior, 3-5yr → mid, 5+yr → senior)

Phân loại SKILLS (quan trọng):
- hard_skills: Kỹ năng kỹ thuật/chuyên môn đo lường được
  + Trích từ: mục Skills, kinh nghiệm làm việc, dự án, certifications
  + Mỗi skill cần level + years (ước tính nếu không ghi rõ)
  + category: programming, framework, database, devops, cloud, tools, design, data, security, domain, other
- soft_skills: Kỹ năng mềm (suy luận từ mô tả công việc, achievements)
  + Ví dụ: "led a team of 5" → Leadership, Teamwork
  + "presented to stakeholders" → Communication, Presentation
  + Chỉ liệt kê khi có BẰNG CHỨNG trong CV, KHÔNG suy đoán thiếu căn cứ

Quy tắc chung:
- Trích xuất TẤT CẢ thông tin có trong CV, kể cả ngầm hiểu
- Viết bằng CÙNG NGÔN NGỮ với CV
- summary: tóm tắt 2-3 câu về profile ứng viên (strengths + experience level)"""

MATCH_SCORE_PROMPT = """Bạn là chuyên gia tuyển dụng. Đánh giá mức độ phù hợp của từng ứng viên với Job Description.

Chấm điểm mỗi ứng viên trên thang 0-100 cho từng tiêu chí:
1. hard_skills_match (trọng số 35%): Ứng viên có bao nhiêu hard skills (must-have) từ JD? Trình độ phù hợp?
2. soft_skills_match (trọng số 10%): Ứng viên có soft skills mà JD yêu cầu không? (leadership, communication, ...)
3. nice_to_have (trọng số 10%): Có bonus/nice-to-have skills nào không?
4. experience_relevance (trọng số 25%): Số năm kinh nghiệm + mức độ liên quan đến vai trò? Career level phù hợp?
5. education_certs (trọng số 10%): Bằng cấp + chuyên ngành + certifications phù hợp?
6. overall_impression (trọng số 10%): Location match, language, career trajectory, culture fit?

total_score = (hard_skills_match * 0.35) + (soft_skills_match * 0.10) + (nice_to_have * 0.10) + (experience_relevance * 0.25) + (education_certs * 0.10) + (overall_impression * 0.10)

Trả về JSON:
{
  "evaluations": [
    {
      "candidate_index": 0,
      "name": "",
      "scores": {
        "hard_skills_match": 0,
        "soft_skills_match": 0,
        "nice_to_have": 0,
        "experience_relevance": 0,
        "education_certs": 0,
        "overall_impression": 0
      },
      "total_score": 0,
      "matched_hard_skills": [],
      "missing_hard_skills": [],
      "matched_soft_skills": [],
      "strengths": [],
      "gaps": [],
      "recommendation_note": ""
    }
  ]
}

Quy tắc:
- KHÁCH QUAN và NHẤT QUÁN giữa các ứng viên
- Chấm điểm CHỈ dựa trên bằng chứng có trong CV
- matched_hard_skills: liệt kê CỤ THỂ hard skills JD yêu cầu mà ứng viên có (giữ nguyên tên gốc của skill, vd: "C#", "SQL Server")
- missing_hard_skills: liệt kê CỤ THỂ hard skills JD yêu cầu mà ứng viên THIẾU (giữ nguyên tên gốc)
- matched_soft_skills: soft skills phù hợp (nếu JD yêu cầu)
- KHÔNG thổi phồng điểm — 70 là tốt, 90+ là xuất sắc

NGÔN NGỮ OUTPUT (QUAN TRỌNG):
- Tất cả nội dung text (strengths, gaps, recommendation_note) PHẢI viết bằng TIẾNG VIỆT
- Các JSON key giữ nguyên tiếng Anh (strengths, gaps, recommendation, ...)
- Tên skill/công nghệ giữ nguyên tên gốc (C#, JavaScript, SQL Server, ...)
- VD strengths: "Thành thạo C# và JavaScript, đáp ứng tốt yêu cầu ngôn ngữ lập trình"
- VD gaps: "Chưa thể hiện kỹ năng Design Pattern trong CV"
- VD recommendation_note: "Ứng viên phù hợp tốt với vị trí, có nền tảng kỹ thuật vững"
- TUYỆT ĐỐI KHÔNG viết strengths/gaps bằng tiếng Anh (trừ tên skill/công nghệ)

QUY TẮC ĐẶC BIỆT — XỬ LÝ NHÓM SKILL "ONE OF" (CỰC KỲ QUAN TRỌNG):

Khi JD có nhóm skills đánh dấu "ONE OF" → ứng viên chỉ cần CÓ ÍT NHẤT 1 skill trong nhóm = ĐẠT TOÀN BỘ NHÓM.

ĐỊNH NGHĨA "CÓ SKILL": ứng viên biết/từng dùng skill đó, bất kể ngữ cảnh sử dụng.
  → Python có trong group backend → ứng viên biết Python → ĐẠT group, dù họ dùng Python cho frontend.
  → KHÔNG được phán xét "Python này không phải backend Python". Đánh giá là: có biết skill không?

NGÔN NGỮ OUTPUT (CỰC KỲ QUAN TRỌNG):
  → TUYỆT ĐỐI KHÔNG dùng từ "ONE OF", "nhóm ONE OF", "nhóm skill" trong bất kỳ trường output nào.
  → Khi cần nói về group THIẾU: dùng ngôn ngữ tự nhiên, mô tả đơn giản.
     ✅ ĐÚNG: "Chưa có kinh nghiệm ngôn ngữ backend (C#, Java, PHP...)"
     ✅ ĐÚNG: "Chưa thể hiện kỹ năng database SQL"
     ❌ SAI: "Thiếu các skill thuộc nhóm ONE OF yêu cầu"
     ❌ SAI: "Chưa đáp ứng nhóm ONE OF backend"

BƯỚC BẮT BUỘC — Làm theo thứ tự này TRƯỚC KHI viết output:

  Bước 1: Liệt kê TẤT CẢ ONE OF group từ JD và các skill trong mỗi group.
  Bước 2: Với mỗi group, tìm ứng viên có biết skill nào trong đó không (chỉ cần tên skill khớp)?
           → Có ít nhất 1 → Group = ĐẠT → KHÔNG nhắc đến group này ở bất kỳ đâu nữa.
           → Không có → Group = THIẾU → ghi vào missing_hard_skills bằng ngôn ngữ TỰ NHIÊN (không dùng "ONE OF")
  Bước 3: Chỉ sau khi xác định xong tất cả group, mới viết matched/missing/gaps.

Quy tắc cho matched_hard_skills:
  → Liệt kê tên skill CỤ THỂ mà ứng viên CÓ (kể cả skill trong group đã đạt)

Quy tắc cho missing_hard_skills:
  → CHỈ liệt kê khi ứng viên KHÔNG có BẤT KỲ skill nào trong group
  → Viết bằng ngôn ngữ tự nhiên, KHÔNG dùng "ONE OF"
  → Ứng viên đã có ≥1 skill trong group → KHÔNG liệt kê gì từ group đó

Quy tắc cho gaps và recommendation_note:
  → Group ĐÃ ĐẠT → KHÔNG nhắc đến BẤT KỲ skill nào còn lại trong group tại BẤT KỲ ĐÂU
  → KHÔNG viết "chưa dùng X, Y" khi X, Y cùng group với skill ứng viên đã có
  → KHÔNG viết "chỉ biết X, chưa biết Y" khi X đã đủ để đạt group
  → KHÔNG dùng từ "ONE OF", "nhóm ONE OF", tên group key (backend_lang, database_1...)

VÍ DỤ — ĐỌC KỸ (bao gồm các biến thể SAI thường gặp):

  JD: "ONE OF: C# / Java / PHP / Python / Golang — ít nhất 1 Backend language"
      "ONE OF: React / Angular / Vue.js — ít nhất 1 Frontend"
      "ONE OF: SQLServer / Oracle / PostgreSQL / MySQL — ít nhất 1 Database"

  Ứng viên biết: Python (dùng cho frontend/ML), React, PostgreSQL

  ✅ ĐÚNG — Python có trong group backend → group BACKEND ĐẠT:
    matched_hard_skills: ["Python", "React", "PostgreSQL"]
    missing_hard_skills: []       ← tất cả 3 group đều ĐẠT
    gaps: ["Chưa thể hiện Design Pattern"]    ← chỉ gap ngoài group

  ❌ SAI — gaps (TẤT CẢ các biến thể sau đây đều sai):
    "Thiếu backend .net, Java, PHP, Golang và cơ sở dữ liệu thuộc nhóm ONE OF yêu cầu"  ← SAI: dùng "ONE OF"
    "Chưa sử dụng database khác như SQLServer, Oracle, MySQL"                              ← SAI: PostgreSQL đã đạt
    "Python chủ yếu dùng cho frontend, chưa rõ năng lực backend"                          ← SAI: Python đủ điều kiện
    "Chỉ biết PostgreSQL, thiếu SQLServer hay Oracle"                                      ← SAI: group đã đạt
    "Chưa có Angular, Vue.js"                                                              ← SAI: React đã đạt group

  → Trước khi viết mỗi gap: hỏi "Skill này có nằm trong ONE OF group đã đạt không?" → Có → XÓA gap đó.

QUY TẮC ĐẶC BIỆT — KINH NGHIỆM (CỰC KỲ QUAN TRỌNG):
- Nếu JD KHÔNG yêu cầu kinh nghiệm (ghi "Không yêu cầu kinh nghiệm" hoặc "fresh graduate OK"):
  → TUYỆT ĐỐI KHÔNG nhắc đến "thiếu kinh nghiệm", "kinh nghiệm ít", "cần thêm đào tạo" trong gaps
  → TUYỆT ĐỐI KHÔNG so sánh số năm kinh nghiệm với "chuẩn junior/mid/senior truyền thống"
  → TUYỆT ĐỐI KHÔNG trừ điểm experience_relevance vì ít kinh nghiệm
  → Nếu ứng viên có kinh nghiệm liên quan → GHI VÀO strengths như điểm cộng
  → Nếu ứng viên fresh graduate, 0 kinh nghiệm → experience_relevance vẫn đạt 70+ vì JD không yêu cầu
  → Chỉ đánh giá: kinh nghiệm (nếu có) có LIÊN QUAN không? → bonus, không phải tiêu chí loại
- Nếu JD yêu cầu kinh nghiệm cụ thể (vd: 3-5 năm):
  → Lúc đó MỚI đánh giá số năm + mức độ liên quan
  → Lúc đó MỚI được ghi "thiếu kinh nghiệm" vào gaps nếu không đủ"""

INTERVIEW_QUESTIONS_PROMPT = """Bạn là chuyên gia phỏng vấn tuyển dụng. Tạo câu hỏi phỏng vấn phù hợp cho ứng viên cụ thể dựa trên JD và đánh giá trước đó.

Trả về JSON:
{
  "questions": [
    {
      "category": "technical|behavioral|situational|role_specific",
      "question": "",
      "purpose": "",
      "expected_good_answer": "",
      "follow_up": ""
    }
  ]
}

Yêu cầu:
- 10-15 câu hỏi tổng cộng, chia theo category:

  1. technical (3-4 câu): nhắm vào GAP đã phát hiện từ đánh giá
     - Hỏi sâu về skill ứng viên THIẾU hoặc chưa rõ trình độ

  2. behavioral (2-3 câu): format STAR (Situation, Task, Action, Result)
     - Đánh giá cách ứng viên xử lý tình huống thực tế

  3. situational (2-3 câu): liên quan đến responsibilities trong JD
     - Giả lập tình huống công việc cụ thể

  4. experience (2-3 câu): HỎI VỀ KINH NGHIỆM & DỰ ÁN CỤ THỂ CỦA ỨNG VIÊN
     - Đọc kỹ phần work experience và projects của ứng viên
     - Hỏi chi tiết về dự án cụ thể họ đã làm (tên dự án, vai trò, công nghệ)
     - Hỏi về thách thức kỹ thuật họ gặp phải trong dự án đó
     - Hỏi về quyết định kỹ thuật (tại sao chọn công nghệ A thay vì B?)
     - VD: "Trong dự án Resume Management System, bạn đã thiết kế database schema như thế nào? Tại sao chọn kiến trúc 3-tier?"
     - VD: "Tại ISV Vietnam, bạn phát triển app Flutter cho iPad — bạn xử lý responsive UI trên tablet như thế nào?"

  5. role_specific (1-2 câu): về domain knowledge
     - Kiến thức chuyên ngành liên quan đến vị trí

- Mỗi câu PHẢI có PURPOSE rõ ràng, liên kết với yêu cầu JD hoặc profile ứng viên
- Có follow_up để hỏi sâu hơn

NGÔN NGỮ: Tất cả nội dung (question, purpose, expected_good_answer, follow_up) PHẢI viết bằng TIẾNG VIỆT.
Tên skill/công nghệ/dự án giữ nguyên tên gốc (C#, JavaScript, Design Pattern, Resume Management System, ...)."""
