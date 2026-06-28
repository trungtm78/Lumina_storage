"""HTML report rendering for document analysis PDF output."""

from __future__ import annotations

from datetime import datetime, timezone

SEVERITY_BADGE = {
    "high": '<span style="background:#DC2626;color:#fff;padding:2px 8px;border-radius:3px;font-size:9pt;font-weight:bold">HIGH</span>',
    "critical": '<span style="background:#DC2626;color:#fff;padding:2px 8px;border-radius:3px;font-size:9pt;font-weight:bold">CRITICAL</span>',
    "medium": '<span style="background:#F59E0B;color:#fff;padding:2px 8px;border-radius:3px;font-size:9pt;font-weight:bold">MEDIUM</span>',
    "warning": '<span style="background:#F59E0B;color:#fff;padding:2px 8px;border-radius:3px;font-size:9pt;font-weight:bold">WARNING</span>',
    "low": '<span style="background:#3B82F6;color:#fff;padding:2px 8px;border-radius:3px;font-size:9pt;font-weight:bold">LOW</span>',
    "info": '<span style="background:#3B82F6;color:#fff;padding:2px 8px;border-radius:3px;font-size:9pt;font-weight:bold">INFO</span>',
}

STATUS_BADGE = {
    "correct": '<span style="background:#10B981;color:#fff;padding:2px 6px;border-radius:3px;font-size:9pt">&#10003;</span>',
    "mismatch": '<span style="background:#DC2626;color:#fff;padding:2px 6px;border-radius:3px;font-size:9pt">&#10007;</span>',
    "met": '<span style="background:#10B981;color:#fff;padding:2px 6px;border-radius:3px;font-size:9pt">&#10003;</span>',
    "not_met": '<span style="background:#DC2626;color:#fff;padding:2px 6px;border-radius:3px;font-size:9pt">&#10007;</span>',
    "compliant": '<span style="background:#10B981;color:#fff;padding:2px 6px;border-radius:3px;font-size:9pt">&#10003;</span>',
    "non_compliant": '<span style="background:#DC2626;color:#fff;padding:2px 6px;border-radius:3px;font-size:9pt">&#10007;</span>',
}

DOMAIN_TITLES = {
    "legal": "Phân Tích Pháp Lý",
    "finance": "Phân Tích Tài Chính",
    "hr": "Phân Tích Nhân Sự",
    "general": "Phân Tích Tài Liệu",
}

CSS = """
@page { size: A4; margin: 15mm; }
body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 10.5pt; line-height: 1.5; color: #1a1a1a; margin: 0; }
.header { background: #1E3A5F; color: white; padding: 20px 25px; margin: -15mm -15mm 20px; }
.header h1 { margin: 0 0 4px; font-size: 16pt; }
.header p { margin: 0; font-size: 9pt; opacity: 0.85; }
.summary { background: #F0F4F8; border-left: 4px solid #1E3A5F; padding: 12px 16px; margin-bottom: 20px; font-size: 10.5pt; }
.warn-banner { background: #FEF2F2; border: 1px solid #FECACA; border-radius: 4px; padding: 10px 14px; margin-bottom: 16px; }
.warn-banner p { margin: 4px 0; font-size: 10pt; }
.section { margin-bottom: 22px; }
.section h2 { color: #1E3A5F; border-bottom: 2px solid #E5E7EB; padding-bottom: 4px; font-size: 12pt; margin-bottom: 10px; }
table { width: 100%; border-collapse: collapse; font-size: 9.5pt; margin-bottom: 8px; }
th { background: #F3F4F6; text-align: left; padding: 6px 8px; border: 1px solid #D1D5DB; font-weight: 600; }
td { padding: 6px 8px; border: 1px solid #D1D5DB; vertical-align: top; }
tr:nth-child(even) { background: #F9FAFB; }
.footer { margin-top: 30px; border-top: 1px solid #E5E7EB; padding-top: 8px; font-size: 8pt; color: #9CA3AF; text-align: center; }
"""


def _badge(level: str) -> str:
    return SEVERITY_BADGE.get(level.lower(), level)


def _status(val: str) -> str:
    return STATUS_BADGE.get(val.lower(), val)


def _esc(text) -> str:
    if text is None:
        return ""
    return str(text).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def _table(headers: list[str], rows: list[dict], badge_col: str | None = None, status_col: str | None = None) -> str:
    if not rows:
        return "<p><em>Không có dữ liệu</em></p>"
    keys = [h.lower().replace(" ", "_") for h in headers]
    html = "<table><thead><tr>"
    for h in headers:
        html += f"<th>{_esc(h)}</th>"
    html += "</tr></thead><tbody>"
    for row in rows:
        html += "<tr>"
        for k, h in zip(keys, headers):
            val = row.get(k, row.get(h, ""))
            if k == badge_col:
                html += f"<td>{_badge(str(val))}</td>"
            elif k == status_col:
                html += f"<td>{_status(str(val))}</td>"
            else:
                html += f"<td>{_esc(val)}</td>"
        html += "</tr>"
    html += "</tbody></table>"
    return html


def render_report(analysis: dict, domain: str, filename: str) -> str:
    """Render analysis JSON into full HTML for PDF conversion."""
    doc_info = analysis.get("document_info", {})
    warnings = analysis.get("warnings", [])
    now = datetime.now(timezone.utc).strftime("%d/%m/%Y %H:%M UTC")

    parts = []

    # Head
    parts.append(f"<!DOCTYPE html><html><head><meta charset='utf-8'><style>{CSS}</style></head><body>")

    # Header
    title = DOMAIN_TITLES.get(domain, "Phân Tích Tài Liệu")
    parts.append(f"""
    <div class="header">
        <h1>{_esc(title)}</h1>
        <p>File: {_esc(filename)} &nbsp;|&nbsp; Loại: {_esc(doc_info.get('type', ''))} &nbsp;|&nbsp; Ngày phân tích: {now}</p>
    </div>
    """)

    # Summary
    parts.append(f'<div class="summary">{_esc(analysis.get("summary", ""))}</div>')

    # Warnings banner
    critical = [w for w in warnings if w.get("level") in ("critical", "warning")]
    if critical:
        parts.append('<div class="warn-banner">')
        for w in critical:
            parts.append(f'<p>{_badge(w["level"])} {_esc(w["message"])}</p>')
        parts.append("</div>")

    # Document info
    parts.append('<div class="section"><h2>Thông tin tài liệu</h2>')
    info_rows = [{"item": k, "detail": str(v)} for k, v in doc_info.items() if v and k != "parties"]
    if doc_info.get("parties"):
        for p in doc_info["parties"]:
            info_rows.append({"item": p.get("role", "Bên"), "detail": f'{p.get("name", "")} — ĐD: {p.get("representative", "")}'})
    parts.append(_table(["Item", "Detail"], info_rows))
    parts.append("</div>")

    # Domain-specific sections
    if domain == "legal":
        _render_legal(parts, analysis)
    elif domain == "finance":
        _render_finance(parts, analysis)
    elif domain == "hr":
        _render_hr(parts, analysis)
    else:
        _render_general(parts, analysis)

    # Comparison
    comp = analysis.get("comparison")
    if comp:
        _render_comparison(parts, comp)

    # All warnings (info level too)
    info_warnings = [w for w in warnings if w.get("level") == "info"]
    if info_warnings:
        parts.append('<div class="section"><h2>Ghi chú</h2>')
        for w in info_warnings:
            parts.append(f'<p>{_badge("info")} {_esc(w["message"])}</p>')
        parts.append("</div>")

    # Footer
    parts.append(f'<div class="footer">Báo cáo tạo tự động bởi Lumina AI &nbsp;|&nbsp; {now}</div>')
    parts.append("</body></html>")

    return "\n".join(parts)


def _render_legal(parts: list, a: dict):
    if a.get("key_terms"):
        parts.append('<div class="section"><h2>Điều khoản chính</h2>')
        parts.append(_table(["Term", "Detail", "Article"], a["key_terms"]))
        parts.append("</div>")

    if a.get("risk_analysis"):
        parts.append('<div class="section"><h2>Phân tích rủi ro</h2>')
        parts.append(_table(["Severity", "Category", "Description", "Clause_reference", "Recommendation"], a["risk_analysis"], badge_col="severity"))
        parts.append("</div>")

    if a.get("unfavorable_clauses"):
        parts.append('<div class="section"><h2>Điều khoản bất lợi</h2>')
        parts.append(_table(["Clause", "Article", "Issue", "Favors"], a["unfavorable_clauses"]))
        parts.append("</div>")

    if a.get("missing_protections"):
        parts.append('<div class="section"><h2>Thiếu bảo vệ</h2>')
        parts.append(_table(["Protection", "Importance", "Explanation"], a["missing_protections"], badge_col="importance"))
        parts.append("</div>")

    if a.get("obligations_summary"):
        parts.append('<div class="section"><h2>Tóm tắt nghĩa vụ</h2>')
        parts.append(_table(["Party", "Obligation", "Deadline", "Penalty"], a["obligations_summary"]))
        parts.append("</div>")

    if a.get("spelling_errors"):
        parts.append('<div class="section"><h2>Lỗi chính tả / Lỗi thuật ngữ</h2>')
        parts.append(_table(["Original", "Suggestion", "Location"], a["spelling_errors"]))
        parts.append("</div>")


def _render_finance(parts: list, a: dict):
    if a.get("extracted_figures"):
        parts.append('<div class="section"><h2>Số liệu trích xuất</h2>')
        parts.append(_table(["Label", "Value", "Unit", "Notes"], a["extracted_figures"]))
        parts.append("</div>")

    if a.get("calculations_check"):
        parts.append('<div class="section"><h2>Kiểm tra phép tính</h2>')
        parts.append(_table(["Description", "Expected", "Actual", "Status", "Discrepancy"], a["calculations_check"], status_col="status"))
        parts.append("</div>")

    if a.get("anomalies"):
        parts.append('<div class="section"><h2>Bất thường</h2>')
        parts.append(_table(["Severity", "Type", "Description", "Recommendation"], a["anomalies"], badge_col="severity"))
        parts.append("</div>")

    if a.get("key_metrics"):
        parts.append('<div class="section"><h2>Chỉ số chính</h2>')
        parts.append(_table(["Metric", "Value", "Interpretation"], a["key_metrics"]))
        parts.append("</div>")


def _render_hr(parts: list, a: dict):
    profile = a.get("profile_analysis")
    if profile:
        parts.append('<div class="section"><h2>Phân tích hồ sơ</h2>')
        rows = []
        if profile.get("experience_years"):
            rows.append({"item": "Kinh nghiệm", "detail": profile["experience_years"]})
        if profile.get("education_level"):
            rows.append({"item": "Học vấn", "detail": profile["education_level"]})
        if profile.get("career_trajectory"):
            rows.append({"item": "Career trajectory", "detail": profile["career_trajectory"]})
        if profile.get("key_skills"):
            rows.append({"item": "Kỹ năng", "detail": ", ".join(profile["key_skills"])})
        if profile.get("strengths"):
            rows.append({"item": "Điểm mạnh", "detail": "; ".join(profile["strengths"])})
        if profile.get("concerns"):
            rows.append({"item": "Lưu ý", "detail": "; ".join(profile["concerns"])})
        parts.append(_table(["Item", "Detail"], rows))
        parts.append("</div>")

    if a.get("contract_terms_review"):
        parts.append('<div class="section"><h2>Đánh giá điều khoản</h2>')
        parts.append(_table(["Term", "Value", "Assessment", "Notes"], a["contract_terms_review"], badge_col="assessment"))
        parts.append("</div>")

    if a.get("compliance_check"):
        parts.append('<div class="section"><h2>Kiểm tra tuân thủ</h2>')
        parts.append(_table(["Requirement", "Status", "Reference", "Detail"], a["compliance_check"], status_col="status"))
        parts.append("</div>")

    if a.get("recommendations"):
        parts.append('<div class="section"><h2>Khuyến nghị</h2>')
        parts.append(_table(["Area", "Suggestion", "Priority"], a["recommendations"], badge_col="priority"))
        parts.append("</div>")


def _render_general(parts: list, a: dict):
    if a.get("key_information"):
        parts.append('<div class="section"><h2>Thông tin quan trọng</h2>')
        parts.append(_table(["Item", "Detail"], a["key_information"]))
        parts.append("</div>")

    struct = a.get("structure_analysis")
    if struct:
        parts.append('<div class="section"><h2>Cấu trúc tài liệu</h2>')
        rows = []
        if struct.get("sections"):
            rows.append({"item": "Sections", "detail": ", ".join(struct["sections"])})
        if struct.get("completeness"):
            rows.append({"item": "Completeness", "detail": struct["completeness"]})
        if struct.get("missing_elements"):
            rows.append({"item": "Missing", "detail": ", ".join(struct["missing_elements"])})
        parts.append(_table(["Item", "Detail"], rows))
        parts.append("</div>")

    if a.get("action_items"):
        parts.append('<div class="section"><h2>Action Items</h2>')
        parts.append(_table(["Action", "Responsible", "Deadline", "Status"], a["action_items"]))
        parts.append("</div>")

    if a.get("important_dates"):
        parts.append('<div class="section"><h2>Ngày quan trọng</h2>')
        parts.append(_table(["Date", "Event"], a["important_dates"]))
        parts.append("</div>")

    if a.get("spelling_errors"):
        parts.append('<div class="section"><h2>Lỗi chính tả / Lỗi ngữ pháp</h2>')
        parts.append(_table(["Original", "Suggestion", "Location"], a["spelling_errors"]))
        parts.append("</div>")


def _render_comparison(parts: list, comp: dict):
    parts.append('<div class="section"><h2>So sánh tài liệu</h2>')
    parts.append(f'<div class="summary"><strong>Quan hệ:</strong> {_esc(comp.get("relationship", ""))} — {_esc(comp.get("summary", ""))}</div>')

    if comp.get("differences"):
        parts.append(_table(["Aspect", "Document_a", "Document_b", "Significance", "Recommendation"], comp["differences"], badge_col="significance"))

    if comp.get("additions_in_b"):
        parts.append(f'<p><strong>Thêm trong Document B:</strong> {_esc(", ".join(comp["additions_in_b"]))}</p>')
    if comp.get("removals_in_b"):
        parts.append(f'<p><strong>Bỏ trong Document B:</strong> {_esc(", ".join(comp["removals_in_b"]))}</p>')

    parts.append("</div>")
