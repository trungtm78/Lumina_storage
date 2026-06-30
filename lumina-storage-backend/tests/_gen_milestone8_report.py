"""Báo cáo Word hoàn thành Phase 8 (Worker reliability) + remaining backlog.

Chạy: MSYS_NO_PATHCONV=1 docker compose run --rm -v "C:/Lumina_Storage/docs:/out" \
  test python /app/tests/_gen_milestone8_report.py
"""
from docx import Document
from docx.shared import Pt
from docx.enum.text import WD_ALIGN_PARAGRAPH

doc = Document()
doc.styles["Normal"].font.name = "Calibri"
doc.styles["Normal"].font.size = Pt(11)


def para(t, bold=False, italic=False):
    p = doc.add_paragraph(); r = p.add_run(t); r.bold = bold; r.italic = italic; return p


def bullet(t, prefix=None):
    p = doc.add_paragraph(style="List Bullet")
    if prefix:
        p.add_run(prefix).bold = True
    p.add_run(t)
    return p


doc.add_heading("Lumina Storage — Báo cáo Phase 8 (Worker reliability) + Remaining", level=0)
s = para("Worker: dedupe race fix + DLQ reconcile + correlation-id propagate. "
         "Route split + domain reorg = remaining multi-PR.", italic=True)
s.alignment = WD_ALIGN_PARAGRAPH.CENTER
m = para("Branch: refactor/milestone-1-foundation | Ngày: 2026-06-30 | 381 test PASS | "
         "import-linter 2 kept 0 broken | migration head 20260630a002")
m.alignment = WD_ALIGN_PARAGRAPH.CENTER

doc.add_heading("1. Tổng quan & Phạm vi", 1)
para(
    "Phase 8 (spec: 'L, cuối') gồm 4 workstream lớn ĐA-PR: (a) worker DLQ + sửa race dedupe nuốt "
    "re-ingest + correlation; (b) tách review.py(3743) route→service; (c) tách generator.py(2328) "
    "route→service; (d) module hóa domain/<x>/ (git mv). Session này deliver TRỌN VẸN workstream "
    "GIÁ TRỊ CAO NHẤT — WORKER (3 lỗi correctness/reliability/observability THẬT) với đầy đủ TDD + "
    "outside-voice critique (resolve 3 P0). Các workstream còn lại (refactor cơ học lớn) DOCUMENT làm "
    "remaining với inventory LOC đã map — đa-PR, chất lượng > nhồi nhét."
)
bullet("Worker T1-T3 hoàn tất: 381 test PASS; migration head 20260630a002; 2 cron mới.", prefix="Đã làm: ")
bullet("review.py/generator.py route split + domain git-mv: documented + inventory sẵn.", prefix="Remaining: ")

doc.add_heading("2. Chi tiết Worker fixes (theo task)", 1)
tasks = [
    ("T1 — Sửa dedupe race nuốt re-ingest (fe5dd81)",
     "BUG: _dedupe_job_id ổn định + arq keep_result=3600 → re-ingest trong 1h sau khi job xong/lỗi "
     "bị enqueue_job trả None → NUỐT IM LẶNG (BackgroundTask tạo nhưng không queue). Fix: dedupe theo "
     "IN-FLIGHT BackgroundTask (pending/running) → trả task đang chạy; task xong → tạo mới + enqueue "
     "(job_id UNIQUE=record.id). Partial unique index (task_name,related_id) WHERE status IN "
     "(pending,running) + IntegrityError-recover.",
     "Critique P0#1/#12: chống concurrent double-enqueue ATOMIC (tránh clobber active_ingest_version "
     "blue/green). Migration 20260630a001."),
    ("T2 — DLQ reconcile stale-running cron (206d45e)",
     "reconcile_stale_tasks cron (mỗi 15'): BackgroundTask kẹt 'running' quá 2×job_timeout (1h, hard "
     "crash) → 'failure' (DLQ) → gỡ kẹt in-flight dedup + lộ ra cho re-ingest. Đăng ký WorkerSettings.",
     "Critique P0#3: ingest task ĐÃ mark failure trước raise (mọi exception) → chỉ HARD CRASH mới kẹt "
     "→ cron đủ (không thêm terminal-failure trùng)."),
    ("T3 — Correlation-id propagate API→worker (032e7d1)",
     "BackgroundTask.request_id column (migration 20260630a002); dispatch bắt correlation_id.get() → "
     "lưu record; mark_ingest_status('running') set lại ContextVar; configure_worker_logging + "
     "_WorkerCorrelationFilter (worker stdlib logging gắn request_id [req=...]).",
     "Critique P1#6: worker không structlog → filter stdlib riêng. Nối chuỗi trace API→background job."),
]
for name, change, why in tasks:
    doc.add_heading(name, 2)
    p = doc.add_paragraph(); p.add_run("Thay đổi: ").bold = True; p.add_run(change)
    p = doc.add_paragraph(); p.add_run("Lý do: ").bold = True; p.add_run(why)

doc.add_heading("3. Đối chiếu Spec (alignment Phase 8 — phần worker)", 1)
bullet("Worker DLQ: reconcile cron mark stale → failure (queryable DLQ). ✓")
bullet("Sửa race dedupe nuốt re-ingest: in-flight dedup + partial-unique atomic. ✓")
bullet("Correlation job: request_id propagate API→worker + worker log gắn request_id. ✓")
para("Deviations có cơ sở (chốt từ outside-voice critique):", bold=True)
bullet("T1 đổi hành vi dedupe = SỬA bug (double-enqueue hiếm an toàn vì blue/green idempotent + partial-unique chặn).")
bullet("T2 thu gọn = chỉ cron (exception-path đã mark failure sẵn) — không thêm terminal-failure trùng lặp.")

doc.add_heading("4. PHASE 8 REMAINING (đa-PR, inventory đã map)", 1)
para("3 workstream refactor cơ học lớn — để lại làm dedicated PR (router HTTP-only), inventory sẵn:", bold=True)
bullet("generator.py(2328)→service: pure helper DOCX(47-187)/HTML(1249-1562 ~336 LOC)→generator_docx.py/"
       "generator_html.py (zero-behavior); business-logic _apply_html_edits_to_docx(116)/_execute_generate(83)/"
       "_validate_field_values(46)/_llm_propose_ops(48)→GeneratorService; fat endpoint generate_from_session(232).", prefix="A. ")
bullet("review.py(3743)→ReviewService (CHƯA tồn tại): pure helper review_extraction/parsing/scoring "
       "(~1100 LOC: _extract_text 177, _extract_docx_numbered_items 355); _run_review(311)/_build_review_prompt"
       "(243)/_persist_eval_pdf(106). MEDIUM risk (~14-16h).", prefix="B. ")
bullet("domain/<x>/ git-mv: churn cao, giá trị tổ chức — từng domain 1 PR SAU khi route splits xong.", prefix="C. ")
bullet("chat_service Concern B/D/E (ChatPermission/Title/stream_agent) — tiếp Phase 7.", prefix="D. ")

doc.add_heading("5. Kiểm thử & Smoke", 1)
bullet("Full suite 381 PASS (+6 test: dedupe_race×3, worker_dlq×1, worker_correlation×2).")
bullet("import-linter 2 kept 0 broken; migration head 20260630a002 (2 migration mới P8).")
bullet("Smoke: app boot 194 routes; worker 10 functions + 3 cron (gồm reconcile_stale_tasks); dispatch import OK.")

doc.add_heading("6. Kết luận", 1)
para(
    "Phase 8 deliver TRỌN VẸN workstream worker reliability (3 lỗi THẬT: nuốt re-ingest, kẹt running do "
    "crash, đứt trace correlation) theo quy trình STRICT + outside-voice critique (resolve 3 P0 — đáng "
    "chú ý partial-unique index chống clobber active_ingest_version, reconcile cron gỡ hard-crash). 381 "
    "test PASS, import-linter xanh, 2 migration. Route split (generator/review) + domain reorg là refactor "
    "cơ học đa-PR, documented đầy đủ với inventory LOC để thực hiện ở PR chuyên biệt sau — ưu tiên chất "
    "lượng + correctness hơn nhồi nhét trong 1 lần.",
    bold=True,
)

out = "/out/Lumina_Storage_Milestone8_Bao_cao_Worker_Reliability.docx"
doc.save(out)
print("Saved:", out)
