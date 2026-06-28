"""Generate PDF evaluation report from accumulated state.

Agent calls:
    run_script("skills/candidate-evaluation/tools/generate_report.py",
               '{"document_ids": ["<any_source_doc_id>"]}')
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _report import render_evaluation_report


async def _html_to_pdf(html: str, gotenberg_url: str, timeout: float = 120) -> bytes:
    """Convert HTML to PDF via Gotenberg Chromium endpoint.

    Timeout is configurable via `settings.gotenberg_timeout` because large
    reports (100+ candidates with interview questions) can exceed a fixed
    60-second budget."""
    import httpx

    async with httpx.AsyncClient(timeout=timeout) as client:
        resp = await client.post(
            f"{gotenberg_url}/forms/chromium/convert/html",
            files={"files": ("index.html", html.encode("utf-8"), "text/html")},
            data={
                "marginTop": "0.4",
                "marginBottom": "0.4",
                "marginLeft": "0.4",
                "marginRight": "0.4",
                "printBackground": "true",
            },
        )
        if resp.status_code != 200:
            raise RuntimeError(f"Gotenberg HTML→PDF failed: {resp.status_code} {resp.text[:200]}")
        return resp.content


async def run(args: dict, ctx) -> dict:
    """Generate PDF evaluation report."""

    state = args.get("_state", {})
    document_ids: list[str] = args.get("document_ids", [])

    if not state.get("jd"):
        return {"error": "Chưa có dữ liệu JD. Vui lòng phân tích JD trước."}
    if not state.get("rankings"):
        return {"error": "Chưa có kết quả đánh giá. Vui lòng chấm điểm ứng viên trước."}

    # Need a source document ID for save_rendered_document
    source_doc_id = (
        document_ids[0] if document_ids
        else state.get("jd_document_id")
    )
    if not source_doc_id:
        return {"error": "Cần cung cấp document_ids hoặc đã parse JD trước để lấy source document."}

    # Render HTML
    html = render_evaluation_report(state)

    # HTML → PDF
    try:
        timeout = float(getattr(ctx.settings, "gotenberg_timeout", 120))
        pdf_bytes = await _html_to_pdf(html, ctx.settings.gotenberg_url, timeout=timeout)
    except Exception as e:
        return {"error": f"Không thể tạo PDF: {e}"}

    # Save
    rendered_id = await ctx.save_rendered_document(
        pdf_bytes,
        source_doc_id,
        filename_suffix="_candidate_evaluation",
        mime_type="application/pdf",
        extension="pdf",
    )

    jd_title = state.get("jd", {}).get("job_title", "")
    total = len([c for c in state.get("candidates", []) if not c.get("error")])
    shortlist = state.get("top_n", 0)

    return {
        "rendered_document_id": str(rendered_id),
        "preview_pdf_id": str(rendered_id),
        "summary": f"Báo cáo đánh giá ứng viên cho vị trí {jd_title}: {total} ứng viên, top {shortlist} shortlist.",
        "_state": state,
    }
