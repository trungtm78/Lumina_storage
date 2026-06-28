"""Document analysis pipeline — classify, analyze, render PDF report.

Agent calls:
    run_script("skills/document-analysis/tools/analyze.py",
               '{"document_ids": ["<id>"], "user_request": "phân tích hợp đồng này"}')
"""

from __future__ import annotations

import json
import re
import sys
from io import BytesIO
from pathlib import Path

# Allow sibling imports
sys.path.insert(0, str(Path(__file__).resolve().parent))
from _prompts import CLASSIFY_PROMPT, COMPARISON_WRAPPER, DOMAIN_PROMPTS
from _report import render_report

MAX_CHARS_SINGLE = 280_000
MAX_CHARS_COMPARE = 140_000


async def _extract_text(ctx, document_id: str) -> tuple[str, str]:
    """Extract text and filename from a document."""
    from markitdown import MarkItDown

    doc_bytes = await ctx.get_document_bytes(document_id)

    # Get filename
    from sqlalchemy import text as sa_text
    result = await ctx.db.execute(
        sa_text("SELECT original_filename FROM documents_document WHERE id = :id"),
        {"id": document_id},
    )
    row = result.fetchone()
    filename = row[0] if row else "document"
    ext = Path(filename).suffix.lower()

    md = MarkItDown()
    try:
        converted = md.convert_stream(BytesIO(doc_bytes), file_extension=ext)
        text = converted.text_content or ""
    except Exception:
        # Fallback for complex formats (e.g. heavily-formatted tables): retry
        # without file_extension hint so MarkItDown auto-detects content type.
        try:
            converted = md.convert_stream(BytesIO(doc_bytes))
            text = converted.text_content or ""
        except Exception as e:
            raise RuntimeError(
                f"Không thể đọc nội dung file '{filename}'. "
                f"File có thể bị lỗi hoặc định dạng không được hỗ trợ ({e})"
            ) from e

    # Warn if table content was likely mangled (heuristic: many pipe chars)
    pipe_density = text.count("|") / max(len(text), 1)
    if ext in (".docx", ".doc") and pipe_density > 0.05:
        # Tables converted to Markdown pipes — flag for the LLM
        text = (
            "[LƯU Ý: Tài liệu có nhiều bảng dữ liệu. "
            "Nội dung bảng được chuyển đổi sang dạng văn bản, "
            "có thể mất một số định dạng.]\n\n" + text
        )

    return text, filename


async def _classify(ctx, text: str, domain_hint: str | None) -> tuple[str, str]:
    """Classify document domain and type. Returns (domain, doc_type)."""
    if domain_hint and domain_hint in DOMAIN_PROMPTS:
        return domain_hint, domain_hint

    result = await ctx.llm_call(
        [
            {"role": "system", "content": CLASSIFY_PROMPT},
            {"role": "user", "content": text[:3000]},
        ],
        response_format={"type": "json_object"},
        temperature=0,
    )
    try:
        data = json.loads(result)
        domain = data.get("domain", "general")
        doc_type = data.get("doc_type", "other")
        confidence = data.get("confidence", 0)
        if confidence < 0.6 or domain not in DOMAIN_PROMPTS:
            domain = "general"
        return domain, doc_type
    except json.JSONDecodeError:
        return "general", "other"


async def _analyze(ctx, prompt: str, text: str, user_request: str) -> dict:
    """Run main analysis LLM call."""
    user_content = f"Tài liệu:\n\n{text}"
    if user_request:
        user_content += f"\n\nYêu cầu của user: {user_request}"

    result = await ctx.llm_call(
        [
            {"role": "system", "content": prompt},
            {"role": "user", "content": user_content},
        ],
        response_format={"type": "json_object"},
        temperature=0,
    )

    try:
        return json.loads(result)
    except json.JSONDecodeError:
        # Try extract JSON from markdown code block
        match = re.search(r"```json\s*(.*?)\s*```", result, re.DOTALL)
        if match:
            return json.loads(match.group(1))
        return {"summary": result[:500], "warnings": [{"level": "warning", "message": "Phân tích trả về dạng text, không phải JSON."}]}


async def _analyze_compare(ctx, prompt: str, text_a: str, text_b: str, user_request: str) -> dict:
    """Run comparison analysis."""
    user_content = f"Document A:\n\n{text_a}\n\n---\n\nDocument B:\n\n{text_b}"
    if user_request:
        user_content += f"\n\nYêu cầu: {user_request}"

    result = await ctx.llm_call(
        [
            {"role": "system", "content": COMPARISON_WRAPPER + prompt},
            {"role": "user", "content": user_content},
        ],
        response_format={"type": "json_object"},
        temperature=0,
    )

    try:
        return json.loads(result)
    except json.JSONDecodeError:
        match = re.search(r"```json\s*(.*?)\s*```", result, re.DOTALL)
        if match:
            return json.loads(match.group(1))
        return {"summary": result[:500], "warnings": [{"level": "warning", "message": "Phân tích trả về dạng text."}]}


async def _html_to_pdf(html: str, gotenberg_url: str) -> bytes:
    """Convert HTML to PDF via Gotenberg Chromium endpoint."""
    import httpx

    async with httpx.AsyncClient(timeout=60) as client:
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
    """Main analysis pipeline."""

    document_ids: list[str] = args.get("document_ids", [])
    user_request: str = args.get("user_request", "")
    domain_hint: str | None = args.get("domain_hint")

    if not document_ids:
        return {"error": "Cần cung cấp ít nhất 1 document_id trong document_ids"}

    if len(document_ids) > 2:
        return {"error": "Tối đa 2 tài liệu cùng lúc (1 phân tích, 2 so sánh)"}

    is_compare = len(document_ids) == 2

    # Step 1: Extract text
    texts = {}
    filenames = {}
    for doc_id in document_ids:
        try:
            text, filename = await _extract_text(ctx, doc_id)
            texts[doc_id] = text
            filenames[doc_id] = filename
        except Exception as e:
            return {"error": f"Không thể đọc tài liệu {doc_id}: {e}"}

    # Truncate if needed
    max_chars = MAX_CHARS_COMPARE if is_compare else MAX_CHARS_SINGLE
    truncated = False
    for doc_id in texts:
        if len(texts[doc_id]) > max_chars:
            texts[doc_id] = texts[doc_id][:max_chars] + "\n\n[... Tài liệu bị cắt do quá dài]"
            truncated = True

    # Step 2: Classify
    first_id = document_ids[0]
    domain, doc_type = await _classify(ctx, texts[first_id], domain_hint)

    # Step 3: Analyze
    prompt = DOMAIN_PROMPTS.get(domain, DOMAIN_PROMPTS["general"])

    if is_compare:
        text_a = texts[document_ids[0]]
        text_b = texts[document_ids[1]]
        # Detect identical documents before calling LLM (TC#45, TC#63)
        normalized_a = " ".join(text_a.split())
        normalized_b = " ".join(text_b.split())
        if normalized_a == normalized_b:
            single_analysis = await _analyze(ctx, prompt, text_a, user_request)
            single_analysis["comparison"] = {
                "relationship": "versions",
                "summary": "Hai tài liệu hoàn toàn giống nhau, không có sự khác biệt.",
                "is_identical": True,
                "differences": [],
                "missing_clauses": [],
                "conflict_terms": [],
                "additions_in_b": [],
                "removals_in_b": [],
                "unchanged": [],
            }
            single_analysis.setdefault("warnings", []).append({
                "level": "info",
                "message": "Hai tài liệu so sánh có nội dung giống hệt nhau (No difference).",
            })
            analysis = single_analysis
        else:
            analysis = await _analyze_compare(ctx, prompt, text_a, text_b, user_request)
    else:
        analysis = await _analyze(ctx, prompt, texts[first_id], user_request)

    # Ensure minimum fields
    analysis.setdefault("summary", "Phân tích hoàn tất.")
    analysis.setdefault("document_info", {"title": filenames.get(first_id, ""), "type": doc_type})
    analysis.setdefault("warnings", [])

    if truncated:
        analysis["warnings"].append({"level": "warning", "message": "Tài liệu quá dài, chỉ phân tích phần đầu."})

    # Step 4: Render HTML
    filename_display = filenames.get(first_id, "document")
    if is_compare:
        filename_display = f"{filenames.get(document_ids[0], 'A')} vs {filenames.get(document_ids[1], 'B')}"

    html = render_report(analysis, domain, filename_display)

    # Step 5: HTML → PDF
    try:
        pdf_bytes = await _html_to_pdf(html, ctx.settings.gotenberg_url)
    except Exception as e:
        return {
            "error": f"Không thể tạo PDF: {e}",
            "summary": analysis.get("summary", ""),
            "analysis": analysis,
        }

    # Step 6: Save
    rendered_id = await ctx.save_rendered_document(
        pdf_bytes, first_id,
        filename_suffix="_analysis",
        mime_type="application/pdf",
        extension="pdf",
    )

    warning_count = len([w for w in analysis.get("warnings", []) if w.get("level") in ("critical", "warning", "high")])

    return {
        "rendered_document_id": str(rendered_id),
        "preview_pdf_id": str(rendered_id),
        "domain": domain,
        "doc_type": doc_type,
        "summary": analysis.get("summary", ""),
        "warning_count": warning_count,
        "is_comparison": is_compare,
    }
