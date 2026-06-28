"""HTML report rendering for candidate evaluation PDF output."""

from __future__ import annotations

import re
from datetime import datetime, timezone

SCORE_COLOR = {
    "high": "#10B981",    # green >=75
    "medium": "#F59E0B",  # yellow 50-74
    "low": "#EF4444",     # red <50
}

REC_BADGE = {
    "strong_fit": '<span style="background:#10B981;color:#fff;padding:2px 8px;border-radius:3px;font-size:9pt;font-weight:bold">Rất phù hợp</span>',
    "good_fit": '<span style="background:#3B82F6;color:#fff;padding:2px 8px;border-radius:3px;font-size:9pt;font-weight:bold">Phù hợp</span>',
    "moderate_fit": '<span style="background:#F59E0B;color:#fff;padding:2px 8px;border-radius:3px;font-size:9pt;font-weight:bold">Tạm được</span>',
    "weak_fit": '<span style="background:#EF4444;color:#fff;padding:2px 8px;border-radius:3px;font-size:9pt;font-weight:bold">Yếu</span>',
    "not_recommended": '<span style="background:#6B7280;color:#fff;padding:2px 8px;border-radius:3px;font-size:9pt;font-weight:bold">Không phù hợp</span>',
}

CSS = """
@page { size: A4; margin: 15mm; }
body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 10.5pt; line-height: 1.5; color: #1a1a1a; margin: 0; }
.header { background: #1E3A5F; color: white; padding: 20px 25px; margin: -15mm -15mm 20px; }
.header h1 { margin: 0 0 4px; font-size: 16pt; }
.header p { margin: 0; font-size: 9pt; opacity: 0.85; }
.summary-box { background: #F0F4F8; border-left: 4px solid #1E3A5F; padding: 12px 16px; margin-bottom: 20px; }
.section { margin-bottom: 22px; page-break-inside: avoid; }
.section h2 { color: #1E3A5F; border-bottom: 2px solid #E5E7EB; padding-bottom: 4px; font-size: 12pt; margin-bottom: 10px; }
.section h3 { color: #374151; font-size: 11pt; margin: 12px 0 6px; }
table { width: 100%; border-collapse: collapse; font-size: 9.5pt; margin-bottom: 8px; }
th { background: #F3F4F6; text-align: left; padding: 6px 8px; border: 1px solid #D1D5DB; font-weight: 600; }
td { padding: 6px 8px; border: 1px solid #D1D5DB; vertical-align: top; }
tr:nth-child(even) { background: #F9FAFB; }
.score-cell { text-align: center; font-weight: bold; }
.candidate-card { border: 1px solid #E5E7EB; border-radius: 6px; padding: 14px; margin-bottom: 14px; page-break-inside: avoid; }
.candidate-card h3 { margin: 0 0 8px; color: #1E3A5F; }
.tag { display: inline-block; background: #E5E7EB; padding: 1px 6px; border-radius: 3px; font-size: 8.5pt; margin: 1px; }
.tag-green { background: #D1FAE5; color: #065F46; }
.tag-red { background: #FEE2E2; color: #991B1B; }
.q-category { font-weight: bold; color: #1E3A5F; margin-top: 8px; }
.footer { margin-top: 30px; border-top: 1px solid #E5E7EB; padding-top: 8px; font-size: 8pt; color: #9CA3AF; text-align: center; }
"""


def _esc(text) -> str:
    if text is None:
        return ""
    return str(text).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def _render_skill_tags(skill_items: list, extra_class: str) -> str:
    """Render a list of JD hard-skill dicts as HTML tags.

    Grouped skills (same "group" value) are collapsed into a single
    "Một trong: X / Y / Z" tag instead of separate tags.
    """
    cls = f'class="tag {extra_class}"'.strip() if extra_class else 'class="tag"'

    grouped: dict[str, list] = {}
    ungrouped: list[str] = []

    for s in skill_items:
        if isinstance(s, dict):
            g = s.get("group")
            name = s.get("skill", "")
            if g:
                grouped.setdefault(g, []).append(name)
            else:
                ungrouped.append(name)
        else:
            ungrouped.append(str(s))

    parts_out = []
    for name in ungrouped:
        parts_out.append(f'<span {cls}>{_esc(name)}</span>')
    for names in grouped.values():
        label = "Một trong: " + " / ".join(names)
        parts_out.append(f'<span {cls}>{_esc(label)}</span>')

    return " ".join(parts_out)


def _fmt_skill(skill: str) -> str:
    """Normalize ONE_OF / ONE OF prefix to readable Vietnamese before HTML escaping.

    LLM sometimes copies the prompt's "ONE OF: X / Y" format verbatim into
    matched_hard_skills / missing_hard_skills.  Convert to human-readable form.

    "ONE OF: VB .net / Python"   → "Một trong: VB .net / Python"
    "ONE_OF: Oracle / PostgreSQL" → "Một trong: Oracle / PostgreSQL"
    """
    s = str(skill).strip() if skill else ""
    s = re.sub(r"^ONE[_ ]OF\s*:\s*", "Một trong: ", s, flags=re.IGNORECASE)
    # Strip trailing parenthetical level hints added by the prompt formatter
    s = re.sub(r"\s*\([^)]*\)\s*$", "", s).strip()
    return _esc(s)


def _score_color(score: int | float) -> str:
    score = int(score) if score else 0
    if score >= 75:
        return SCORE_COLOR["high"]
    elif score >= 50:
        return SCORE_COLOR["medium"]
    return SCORE_COLOR["low"]


def _score_cell(score: int | float) -> str:
    color = _score_color(score)
    return f'<td class="score-cell" style="color:{color};font-size:10pt">{int(score)}</td>'


def _rec_badge(rec: str) -> str:
    return REC_BADGE.get(rec, _esc(rec))


def render_evaluation_report(state: dict) -> str:
    """Render full evaluation report as HTML."""
    jd = state.get("jd", {})
    candidates = state.get("candidates", [])
    rankings = state.get("rankings", [])
    interview_questions = state.get("interview_questions", {})
    top_n = state.get("top_n", len(rankings))
    now = datetime.now(timezone.utc).strftime("%d/%m/%Y %H:%M UTC")

    parts = []

    # Head
    parts.append(f"<!DOCTYPE html><html><head><meta charset='utf-8'><style>{CSS}</style></head><body>")

    # Header
    title = jd.get("job_title", "Candidate Evaluation")
    company = jd.get("company", "")
    parts.append(f"""
    <div class="header">
        <h1>Báo Cáo Đánh Giá Ứng Viên</h1>
        <p>Vị trí: {_esc(title)}{f' — {_esc(company)}' if company else ''} &nbsp;|&nbsp; Ngày: {now}</p>
    </div>
    """)

    # Summary box
    valid_candidates = [c for c in candidates if not c.get("error")]
    shortlist_count = min(top_n, len(rankings))
    parts.append(f"""
    <div class="summary-box">
        <strong>Tổng quan:</strong> Đã sàng lọc {len(valid_candidates)} ứng viên, shortlist top {shortlist_count}.
    </div>
    """)

    # JD Summary
    parts.append('<div class="section"><h2>1. Thông tin vị trí tuyển dụng</h2>')
    jd_rows = []
    if jd.get("job_title"):
        jd_rows.append(f"<tr><td><strong>Vị trí</strong></td><td>{_esc(jd['job_title'])}</td></tr>")
    if jd.get("company"):
        jd_rows.append(f"<tr><td><strong>Công ty</strong></td><td>{_esc(jd['company'])}</td></tr>")
    if jd.get("location"):
        jd_rows.append(f"<tr><td><strong>Địa điểm</strong></td><td>{_esc(jd['location'])}</td></tr>")
    exp = jd.get("experience_range", {})
    if exp:
        min_y = exp.get("min_years")
        max_y = exp.get("max_years")
        if min_y is None and max_y is None:
            exp_text = _esc(exp.get("note") or "Không yêu cầu kinh nghiệm")
        elif min_y is not None and max_y is not None:
            exp_text = f"{min_y}–{max_y} năm"
        elif min_y is not None:
            exp_text = f"{min_y}+ năm"
        else:
            exp_text = f"≤{max_y} năm"
        jd_rows.append(f"<tr><td><strong>Kinh nghiệm</strong></td><td>{exp_text}</td></tr>")
    if jd.get("work_mode") and jd["work_mode"] != "unknown":
        jd_rows.append(f"<tr><td><strong>Hình thức</strong></td><td>{_esc(jd['work_mode'])}</td></tr>")

    # Hard skills
    hard_must = [s.get("skill", "") for s in jd.get("hard_skills", []) if s.get("priority") == "must-have"]
    hard_nice = [s.get("skill", "") for s in jd.get("hard_skills", []) if s.get("priority") == "nice-to-have"]
    # Fallback old format
    if not hard_must and not hard_nice:
        hard_must = [s.get("skill", "") for s in jd.get("required_skills", [])]
        hard_nice = [s.get("skill", "") for s in jd.get("nice_to_have_skills", [])]

    soft_skills = [s.get("skill", "") for s in jd.get("soft_skills", [])]

    if hard_must:
        # Group by "group" field to render "Một trong: X / Y / Z" for grouped skills
        must_tags = _render_skill_tags(hard_must, "tag-green")
        jd_rows.append(f"<tr><td><strong>Hard Skills (bắt buộc)</strong></td><td>{must_tags}</td></tr>")
    if hard_nice:
        nice_tags = _render_skill_tags(hard_nice, "")
        jd_rows.append(f"<tr><td><strong>Hard Skills (ưu tiên)</strong></td><td>{nice_tags}</td></tr>")
    if soft_skills:
        tags = " ".join(f'<span class="tag" style="background:#E0E7FF;color:#3730A3">{_esc(s)}</span>' for s in soft_skills)
        jd_rows.append(f"<tr><td><strong>Soft Skills</strong></td><td>{tags}</td></tr>")

    parts.append(f"<table>{''.join(jd_rows)}</table></div>")

    # Rankings table
    if rankings:
        parts.append('<div class="section"><h2>2. Bảng xếp hạng ứng viên</h2>')
        parts.append("""<table>
        <thead><tr>
            <th style="width:30px">#</th>
            <th>Ứng viên</th>
            <th style="width:50px">Tổng</th>
            <th style="width:50px">Hard</th>
            <th style="width:50px">Soft</th>
            <th style="width:50px">Exp.</th>
            <th style="width:50px">Edu.</th>
            <th style="width:85px">Đánh giá</th>
        </tr></thead><tbody>""")

        for ev in rankings:
            scores = ev.get("scores", {})
            # Support both old and new field names
            hard_score = scores.get("hard_skills_match", scores.get("required_skills", 0))
            soft_score = scores.get("soft_skills_match", 0)
            exp_score = scores.get("experience_relevance", 0)
            edu_score = scores.get("education_certs", scores.get("education_fit", 0))
            parts.append(f"""<tr>
                <td style="text-align:center;font-weight:bold">{ev.get('rank', '-')}</td>
                <td>{_esc(ev.get('name', '?'))}</td>
                {_score_cell(ev.get('total_score', 0))}
                {_score_cell(hard_score)}
                {_score_cell(soft_score)}
                {_score_cell(exp_score)}
                {_score_cell(edu_score)}
                <td>{_rec_badge(ev.get('recommendation', ''))}</td>
            </tr>""")

        parts.append("</tbody></table></div>")

    # Detailed candidate cards (top N)
    shortlist = rankings[:shortlist_count]
    candidate_map = {c.get("index"): c for c in candidates}

    if shortlist:
        parts.append('<div class="section"><h2>3. Chi tiết ứng viên shortlist</h2>')

        for ev in shortlist:
            c = candidate_map.get(ev.get("candidate_index"), {})
            scores = ev.get("scores", {})

            parts.append(f"""<div class="candidate-card">
                <h3>#{ev.get('rank', '?')} — {_esc(ev.get('name', '?'))} ({ev.get('total_score', 0)}/100) {_rec_badge(ev.get('recommendation', ''))}</h3>
                <p><strong>Vị trí hiện tại:</strong> {_esc(c.get('current_role', '?'))} — {_esc(c.get('current_company', '?'))}</p>
                <p><strong>Kinh nghiệm:</strong> {c.get('experience_years', '?')} năm</p>
            """)

            # Skills
            skills = c.get("skills", [])
            if skills:
                tags = " ".join(f'<span class="tag">{_esc(s)}</span>' for s in skills[:15])
                parts.append(f"<p><strong>Skills:</strong> {tags}</p>")

            # Score breakdown
            parts.append("""<table style="margin-top:8px">
                <tr><th>Tiêu chí</th><th>Điểm</th><th>Trọng số</th></tr>""")
            criteria = [
                ("Kỹ năng chuyên môn", scores.get("hard_skills_match", scores.get("required_skills", 0)), "35%"),
                ("Kỹ năng mềm", scores.get("soft_skills_match", 0), "10%"),
                ("Kỹ năng ưu tiên", scores.get("nice_to_have", scores.get("nice_to_have_skills", 0)), "10%"),
                ("Kinh nghiệm", scores.get("experience_relevance", 0), "25%"),
                ("Bằng cấp & Chứng chỉ", scores.get("education_certs", scores.get("education_fit", 0)), "10%"),
                ("Ấn tượng chung", scores.get("overall_impression", 0), "10%"),
            ]
            for label, score, weight in criteria:
                color = _score_color(score)
                parts.append(f'<tr><td>{label}</td><td style="color:{color};font-weight:bold;text-align:center">{int(score)}</td><td style="text-align:center">{weight}</td></tr>')
            parts.append("</table>")

            # Matched / Missing skills
            matched = ev.get("matched_hard_skills", [])
            missing = ev.get("missing_hard_skills", [])
            if matched:
                tags = " ".join(f'<span class="tag tag-green">{_fmt_skill(s)}</span>' for s in matched)
                parts.append(f"<p><strong>Kỹ năng chuyên môn đạt:</strong> {tags}</p>")
            if missing:
                tags = " ".join(f'<span class="tag tag-red">{_fmt_skill(s)}</span>' for s in missing)
                parts.append(f"<p><strong>Kỹ năng chuyên môn thiếu:</strong> {tags}</p>")

            matched_soft = ev.get("matched_soft_skills", [])
            if matched_soft:
                tags = " ".join(f'<span class="tag" style="background:#E0E7FF;color:#3730A3">{_esc(s)}</span>' for s in matched_soft)
                parts.append(f"<p><strong>Kỹ năng mềm đạt:</strong> {tags}</p>")

            # Strengths
            if ev.get("strengths"):
                parts.append("<p><strong>Điểm mạnh:</strong></p><ul>")
                for s in ev["strengths"]:
                    parts.append(f"<li>{_esc(s)}</li>")
                parts.append("</ul>")

            # Gaps
            if ev.get("gaps"):
                parts.append("<p><strong>Điểm cần cải thiện:</strong></p><ul>")
                for g in ev["gaps"]:
                    parts.append(f"<li>{_esc(g)}</li>")
                parts.append("</ul>")

            if ev.get("recommendation_note"):
                parts.append(f"<p><em>{_esc(ev['recommendation_note'])}</em></p>")

            parts.append("</div>")

        parts.append("</div>")

    # Interview questions
    if interview_questions:
        parts.append('<div class="section"><h2>4. Câu hỏi phỏng vấn</h2>')

        for ev in shortlist:
            idx = str(ev.get("candidate_index", ""))
            questions = interview_questions.get(idx, [])
            if not questions:
                continue

            parts.append(f'<h3>{_esc(ev.get("name", "?"))}</h3>')

            # Group by category
            categories = {}
            for q in questions:
                cat = q.get("category", "other")
                categories.setdefault(cat, []).append(q)

            cat_labels = {
                "technical": "Câu hỏi kỹ thuật",
                "behavioral": "Câu hỏi hành vi (STAR)",
                "situational": "Câu hỏi tình huống",
                "experience": "Câu hỏi về kinh nghiệm & dự án",
                "role_specific": "Câu hỏi chuyên môn",
                "other": "Câu hỏi khác",
            }

            for cat, qs in categories.items():
                parts.append(f'<p class="q-category">{cat_labels.get(cat, cat)} ({len(qs)} câu)</p>')
                parts.append("<ol>")
                for q in qs:
                    parts.append(f"<li><strong>{_esc(q.get('question', ''))}</strong>")
                    if q.get("purpose"):
                        parts.append(f"<br><em style='color:#6B7280;font-size:9pt'>Mục đích: {_esc(q['purpose'])}</em>")
                    if q.get("follow_up"):
                        parts.append(f"<br><em style='color:#6B7280;font-size:9pt'>Follow-up: {_esc(q['follow_up'])}</em>")
                    parts.append("</li>")
                parts.append("</ol>")

        parts.append("</div>")

    # Footer
    parts.append(f'<div class="footer">Báo cáo tạo tự động bởi Lumina AI &nbsp;|&nbsp; {now}</div>')
    parts.append("</body></html>")

    return "\n".join(parts)
