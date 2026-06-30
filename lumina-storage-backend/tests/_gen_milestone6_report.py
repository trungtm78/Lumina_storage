"""Báo cáo Word hoàn thành Phase 6 (DI route + siết layering + import-linter).

Chạy: MSYS_NO_PATHCONV=1 docker compose run --rm -v "C:/Lumina_Storage/docs:/out" \
  test python /app/tests/_gen_milestone6_report.py
"""
from docx import Document
from docx.shared import Pt
from docx.enum.text import WD_ALIGN_PARAGRAPH

doc = Document()
doc.styles["Normal"].font.name = "Calibri"
doc.styles["Normal"].font.size = Pt(11)


def para(t, bold=False, italic=False):
    p = doc.add_paragraph()
    r = p.add_run(t)
    r.bold = bold
    r.italic = italic
    return p


def bullet(t, prefix=None):
    p = doc.add_paragraph(style="List Bullet")
    if prefix:
        p.add_run(prefix).bold = True
    p.add_run(t)
    return p


doc.add_heading("Lumina Storage — Báo cáo Hoàn thành Phase 6", level=0)
s = para("DI route + siết layering: route→service, gỡ reverse-dep, import-linter chặn vi phạm",
         italic=True)
s.alignment = WD_ALIGN_PARAGRAPH.CENTER
m = para("Branch: refactor/milestone-1-foundation | Ngày: 2026-06-30 | 369 test PASS | import-linter 2 kept 0 broken")
m.alignment = WD_ALIGN_PARAGRAPH.CENTER

doc.add_heading("1. Tổng quan & Mục tiêu", 1)
para(
    "Sau Phase 1-5 kiến trúc đã có tầng rõ (api → services → repositories → models; core/schemas "
    "shared) nhưng còn RÒ RỈ TẦNG: vài route gọi THẲNG repository (bỏ qua service) và 1 service "
    "import NGƯỢC lên api. Phase 6 siết lại: route chỉ đi qua service, service không biết api, và "
    "import-linter CHẶN vi phạm tự động (Done = import-linter xanh) → ngăn rò rỉ tái phát. Pure "
    "refactor: KHÔNG đổi hành vi/response, full suite xanh nguyên. Mỗi task STRICT: TDD → suite → "
    "(plan critique outside-voice) → fix → commit."
)
bullet("Gỡ 6 điểm route→repo (auth/users/storage/generator×~16/documents) + 1 reverse-dep service→api.", prefix="Phạm vi: ")
bullet("369 test PASS (+8 test mới); import-linter 2 forbidden-contract KEPT; ZERO route→repo, ZERO service→api.", prefix="Kết quả: ")
bullet("import-linter gate trong pytest → CI bắt vi phạm layering tái phát.", prefix="Bảo vệ: ")

doc.add_heading("2. Chi tiết thay đổi & Lý do (theo task)", 1)
tasks = [
    ("T1 — is_admin → core/authz (fix service→api reverse-dep) (92e561e)",
     "Gỡ services/user.py:6 `from src.api.deps import is_admin` (service phụ thuộc NGƯỢC lên api). "
     "is_admin là logic THUẦN (đọc user.roles) → src/core/authz.py. deps.py re-export (tương thích "
     "import cũ); tasks.py import từ core.authz.",
     "Service KHÔNG được biết tầng HTTP. Logic thuần thuộc core. Re-export giữ backward-compat."),
    ("T2 — GeneratorService gỡ route→repo generator+documents (ae07d58)",
     "generator.py route gọi THẲNG GeneratorSession*Repository (~16 chỗ, 2 repo) + documents.py "
     "template-usage → tạo GeneratorService (delegate 1-1, KHÔNG commit). generator.py: bỏ import "
     "repo, 26 chỗ dùng svc=GeneratorService(db) in-handler (không sửa signature 11 endpoint). "
     "get_generator_service DI ở api/providers.py.",
     "Route không truy cập tầng dữ liệu trực tiếp. Business-logic nặng (patch DOCX/PDF/AI-revise) "
     "GIỮ ở route (không phải repo-access → không vi phạm) → trích vào service ở Phase 7."),
    ("T3 — route→service auth/users/storage (gỡ 3 route→repo cuối) (d3d0395)",
     "UserService.get_by_id_with_permissions → auth.py /me; GroupService.get_auto_group_by_role → "
     "users.py auto-group; StorageConfigService.get_upload_limits (gói get_default + resolve) → "
     "storage.py /upload-limits (bỏ nested-import repo + private internals).",
     "Mỗi route đi qua service. Fix outside-voice: method ban đầu nằm ở REPOSITORY không phải "
     "service → smoke /me AttributeError → thêm delegate (đã có test)."),
    ("T4 — import-linter 2 forbidden-contract + gate (01b9203)",
     "[tool.importlinter]: 'Routes must not import repositories' (allow_indirect_imports=true → chỉ "
     "chặn TRỰC TIẾP; route→service→repo gián tiếp hợp lệ) + 'Services must not import api'. "
     "tests/test_import_linter.py gate (subprocess lint-imports). docker-compose mount pyproject:ro "
     "vào test (config live).",
     "Done-criterion. KHÔNG dùng layers-contract: deps.py→UserRepo (SSO) + worker/extraction "
     "cross-layer (composition-root) là HỢP LỆ → layers-contract sẽ đỏ-giả (chốt từ critique)."),
    ("T5 — Checkpoint (commit này)",
     "Full suite 369 PASS; smoke (app boot + worker + providers import); lint-imports 2 kept 0 broken; "
     "alignment (route→repo=0, service→api=0); báo cáo Word.",
     "Khoá trạng thái sạch + gate bảo vệ."),
]
for name, change, why in tasks:
    doc.add_heading(name, 2)
    p = doc.add_paragraph(); p.add_run("Thay đổi: ").bold = True; p.add_run(change)
    p = doc.add_paragraph(); p.add_run("Lý do: ").bold = True; p.add_run(why)

doc.add_heading("3. Đối chiếu Spec (alignment Phase 6)", 1)
para("Done-criteria spec '*Done: import-linter xanh*' + 'chặn route→repo & service→api' đạt đủ:")
bullet("Route → Depends/service (KHÔNG route→repo): xác minh `grep from src.repositories` trong routes/ = 0.")
bullet("Xóa reverse-dep services/user.py:6 (is_admin → core/authz): `grep from src.api` trong services/ = 0.")
bullet("import-linter chặn route→repo & service→api: 2 contract KEPT, 0 broken; gate trong pytest.")
para("Deviations có cơ sở (chốt từ plan critique outside-voice):", bold=True)
bullet("KHÔNG dùng layers-contract (chỉ 2 forbidden đúng spec): deps.py import UserRepository (SSO user-provisioning) + worker/extraction.selector cross-layer (composition-root) là HỢP LỆ — layers-contract sẽ báo đỏ-giả.")
bullet("GeneratorService delegate 1-1 (chỉ gỡ route→repo); business-logic nặng giữ ở route → trích vào service = Phase 7 (god-route cleanup), ngoài scope Phase 6.")
bullet("allow_indirect_imports=true cho contract route: route→service→repo (gián tiếp) là kiến trúc ĐÚNG; chỉ chặn route import repo TRỰC TIẾP.")

doc.add_heading("4. Kiểm thử & Smoke", 1)
bullet("Full suite 369 PASS (+8 test mới: test_authz×4, test_generator_service×3, test_layering_t3×4, test_import_linter×1 — pure refactor zero-regression).")
bullet("import-linter: `lint-imports` → Analyzed 139 files; 2 contract KEPT, 0 broken.")
bullet("Smoke: create_app boot OK; src.worker.tasks.document + src.api.providers + get_generator_service import OK.")
bullet("Hạ tầng: postgres restart sạch nếu full-suite ProgrammingError leo thang (docker restart thô làm container suy yếu).")

doc.add_heading("5. Rủi ro & Backlog", 1)
bullet("Phase 7 (god-service/route cleanup): trích business-logic generator.py (patch DOCX/PDF/AI-revise) vào GeneratorService; tách agent.py/chat_service.py.")
bullet("Di chuyển toàn bộ route sang centralized DI providers (api/providers.py) — hiện chỉ route vi phạm + generator.")
bullet("Cân nhắc layers-contract chặt hơn khi worker/extraction được tách composition-root rõ ràng.")
bullet("document_permission.py có _is_admin riêng (trùng logic is_admin) → cân nhắc hợp nhất về core/authz.")

doc.add_heading("6. Kết luận", 1)
para(
    "Phase 6 hoàn thành T1-T5 theo quy trình STRICT + plan critique outside-voice (resolve 2 P0 + 4 P1 "
    "TRƯỚC khi code). Kiến trúc tầng được siết: route chỉ đi qua service, service không biết api, "
    "import-linter (2 forbidden-contract) gate trong pytest chặn vi phạm tái phát. 369 test PASS, "
    "ZERO route→repo, ZERO service→api, pure refactor không đổi hành vi. Done-criterion 'import-linter "
    "xanh' đạt (2 kept, 0 broken).",
    bold=True,
)

out = "/out/Lumina_Storage_Milestone6_Bao_cao_Hoan_thanh.docx"
doc.save(out)
print("Saved:", out)
