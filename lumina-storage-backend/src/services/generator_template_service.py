"""Template extraction service — BẢN SAO RIÊNG CHO DOCUMENT GENERATOR V1.

⚠️  Đây là DUPLICATE của `template_service.py` (luồng Beta), tách riêng để V1 dễ
xem xét/chỉnh sửa độc lập mà KHÔNG đụng tới luồng Beta. Mọi thay đổi cho V1 sửa
ở file này; KHÔNG sửa `template_service.py`.

Dùng bởi: `api/v1/routes/generator.py` → endpoint `/generator/document-to-template`.

Extracts fillable fields from a DOCX document and creates a template copy
with named {placeholder} tokens replacing blank fields.

Pipeline:
1. python-docx → extract segments (location → para_ref map)
2. Custom annotated Markdown renderer — tables as MD tables + [§loc] markers per cell/para
3. Single LLM call → detect fields + name placeholders + description
4. Direct lookup: seg ID → segment → ftype + current (no sequential matching)
5. Code replaces blanks with {placeholder} in DOCX (run-level, preserves formatting)
6. Save template file + create DB record
"""

from __future__ import annotations

import json
import logging
import re
import uuid
from io import BytesIO
from pathlib import Path

from sqlalchemy.ext.asyncio import AsyncSession

from src.core.config import Settings
from src.models.document import Document
from src.repositories.document import DocumentRepository
from src.services.storage import get_storage_backend

logger = logging.getLogger(__name__)


# ── Step 1: Extract segments (location → para_ref) ────────────────────

def _extract_table_segments(table, prefix: str, segments: list, seen_cells: set) -> None:
    """Extract segments from a table, handling merged cells and nested tables."""
    for ri, row in enumerate(table.rows):
        for ci, cell in enumerate(row.cells):
            cell_id = id(cell)
            if cell_id in seen_cells:
                continue
            seen_cells.add(cell_id)

            cell_has_text = False
            for pi, para in enumerate(cell.paragraphs):
                text = para.text
                if text.strip():
                    cell_has_text = True
                    loc = f"{prefix}r{ri}c{ci}p{pi}"
                    segments.append({"location": loc, "text": text, "para_ref": para})

            if not cell_has_text and cell.paragraphs:
                para = cell.paragraphs[0]
                loc = f"{prefix}r{ri}c{ci}p0"
                segments.append({"location": loc, "text": "", "para_ref": para})

            for nti, nested_table in enumerate(cell.tables):
                nested_prefix = f"{prefix}r{ri}c{ci}nt{nti}"
                _extract_table_segments(nested_table, nested_prefix, segments, seen_cells)


def _extract_segments(doc) -> list[dict]:
    """Extract all paragraphs with location IDs and para refs.

    Returns list of {location, text, para_ref}.
    Does NOT modify runs — read-only pass.
    """
    segments: list[dict] = []

    for i, para in enumerate(doc.paragraphs):
        text = para.text
        if text.strip():
            segments.append({"location": f"p{i}", "text": text, "para_ref": para})

    for ti, table in enumerate(doc.tables):
        table_seen: set = set()
        _extract_table_segments(table, f"t{ti}", segments, table_seen)

    for si, section in enumerate(doc.sections):
        for part_name, part in [("header", section.header), ("footer", section.footer)]:
            if not part or (not part.is_linked_to_previous and si > 0):
                continue
            for pi, para in enumerate(part.paragraphs):
                text = para.text
                if text.strip():
                    loc = f"s{si}{part_name[0]}{pi}"
                    segments.append({"location": loc, "text": text, "para_ref": para})
            for hti, htable in enumerate(part.tables):
                hdr_seen: set = set()
                _extract_table_segments(htable, f"s{si}{part_name[0]}t{hti}", segments, hdr_seen)

    return segments


# ── Step 2: Renderers (XML or annotated Markdown) ────────────────────

# Switch: "xml" uses original XML renderer; "md" uses annotated Markdown renderer
_RENDER_MODE: str = "xml"


def _render_annotated_xml(doc, seg_by_loc: dict) -> str:
    """Render DOCX body as annotated XML with segment IDs (original approach).

    - <p id="pN"> — body paragraph N
    - <table id="tN"> / <row id="tNrM"> / <cell id="tNrMcK"> — table/row/cell
    - <p id="tNrMcKpJ"> — paragraph J inside a cell
    - <cell id="tNrMcKp0"/> (self-closing) — completely empty cell
    """
    import html as _html
    W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
    parts: list[str] = []
    p_idx = 0
    t_idx = 0

    for child in doc.element.body:
        local = child.tag.replace(f"{{{W}}}", "")

        if local == "p":
            loc = f"p{p_idx}"
            p_idx += 1
            seg = seg_by_loc.get(loc)
            if seg and seg["text"].strip():
                parts.append(f'<p id="{loc}">{_html.escape(seg["text"])}</p>')

        elif local == "tbl":
            ti = t_idx
            t_idx += 1
            table = doc.tables[ti]
            tbl_parts = [f'<table id="t{ti}">']

            for ri, row in enumerate(table.rows):
                row_id = f"t{ti}r{ri}"
                row_parts = [f'<row id="{row_id}">']
                seen_cell_ids: set = set()

                for ci in range(len(row.cells)):
                    cell = row.cells[ci]
                    if id(cell) in seen_cell_ids:
                        continue
                    seen_cell_ids.add(id(cell))

                    cell_base = f"t{ti}r{ri}c{ci}"
                    cell_segs = [
                        (f"{cell_base}p{pi}", seg_by_loc[f"{cell_base}p{pi}"]["text"])
                        for pi in range(len(cell.paragraphs))
                        if f"{cell_base}p{pi}" in seg_by_loc
                    ]

                    if not cell_segs:
                        row_parts.append(f'<cell id="{cell_base}p0"/>')
                    else:
                        inner = "".join(
                            f'<p id="{loc}">{_html.escape(text)}</p>'
                            for loc, text in cell_segs
                        )
                        # No id on <cell> wrapper — only <p> tags carry para-level ids
                        # so LLM cannot accidentally pick cell-level id (t0r1c0 vs t0r1c0p0)
                        row_parts.append(f'<cell>{inner}</cell>')

                row_parts.append("</row>")
                tbl_parts.append("".join(row_parts))

            tbl_parts.append("</table>")
            parts.append("".join(tbl_parts))

    return "\n".join(parts)


def _render_annotated_markdown(doc, seg_by_loc: dict) -> str:
    """Render DOCX body as annotated Markdown with [§loc] segment markers.

    Body paragraphs → `[§p0] text`
    Table cells     → markdown table rows, each cell prefixed `[§t0r1c2p0]`

    LLM uses the `id` values from [§id] markers in the `seg` response field,
    enabling direct dict lookup — no sequential matching needed.
    """
    W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
    lines: list[str] = []
    p_idx = 0
    t_idx = 0

    for child in doc.element.body:
        local = child.tag.replace(f"{{{W}}}", "")

        if local == "p":
            loc = f"p{p_idx}"
            p_idx += 1
            seg = seg_by_loc.get(loc)
            if seg:
                lines.append(f"[§{loc}] {seg['text']}")

        elif local == "tbl":
            ti = t_idx
            t_idx += 1
            table = doc.tables[ti]
            n_cols = max((len(row.cells) for row in table.rows), default=0)
            if n_cols == 0:
                continue

            for ri, row in enumerate(table.rows):
                cells_md: list[str] = []
                for ci in range(n_cols):
                    cell = row.cells[ci] if ci < len(row.cells) else None
                    loc = f"t{ti}r{ri}c{ci}p0"
                    seg = seg_by_loc.get(loc)
                    text = seg["text"] if seg else (cell.text.strip() if cell else "")
                    cells_md.append(f"[§{loc}] {text}")
                lines.append("| " + " | ".join(cells_md) + " |")
                if ri == 0:
                    lines.append("|" + " --- |" * n_cols)

            lines.append("")

    return "\n".join(lines)


# ── Step 3: LLM — detect + name + describe (single call) ─────────────

EXTRACT_PROMPT_XML = """Bạn là công cụ phân tích tài liệu mẫu (template). Tài liệu được render dưới dạng XML với cấu trúc:
- `<p id="pN">` — đoạn văn thứ N ngoài bảng
- `<table id="tN">` / `<row id="tNrM">` / `<cell id="tNrMcK">` — bảng, hàng, ô
- `<p id="tNrMcKpJ">` — đoạn văn thứ J trong ô bảng
- `<cell id="tNrMcKp0"/>` (self-closing) — ô hoàn toàn trống

Trả về JSON:
{
  "fields": [
    {
      "seg": "id_cua_segment",
      "name": "ten_placeholder",
      "label": "Nhãn hiển thị tiếng Việt",
      "description": "Mô tả chi tiết trường này là gì, dùng để làm gì, ví dụ giá trị",
      "current": "chuỗi cần thay thế"
    },
    ...
  ],
  "description": "1-2 câu mô tả tài liệu là loại gì và dùng để làm gì"
}

Với `seg`: **luôn dùng id của thẻ `<p>`** — không dùng id của `<cell>`, `<row>`, hay `<table>`.
- Đúng: `"seg": "t0r1c0p0"`, `"seg": "p3"`
- Sai: `"seg": "t0r1c0"`, `"seg": "t0r1"`

## Nhận diện trường cần điền

Trường cần điền là chỗ mà người dùng phải cung cấp thông tin — không phải nội dung cố định của tài liệu. Dấu hiệu thường gặp: ô trống trong bảng (`<cell.../>`), dấu gạch dài, dấu chấm lửng, ký tự giữ chỗ dạng ngoặc vuông, định dạng ngày tháng chờ điền.

Nội dung KHÔNG phải trường cần điền: tiêu đề, điều khoản pháp lý, dữ liệu cố định đã có giá trị, thông tin của đơn vị phát hành tài liệu, ô trống thuần túy dùng để phân cách bố cục, nội dung lựa chọn/ghi chú mang tính ví dụ đặt trong ngoặc vuông (như [OPT 1], [OPT 2]).

## "current" — chuỗi thay thế

Phải là chuỗi xuất hiện chính xác trong nội dung segment đó. Một segment có thể chứa nhiều trường — khi đó tạo nhiều item riêng, mỗi item có `seg` và `current` tương ứng với từng chỗ trống. Với ô bảng hoàn toàn trống (`<cell.../>`), dùng `"current": ""`.

## Đặt tên placeholder (`name`)

- snake_case, tiếng Việt không dấu, mô tả nội dung cần điền
- Đủ dài để rõ nghĩa, không viết tắt tùy tiện
- Không trùng lặp trong cùng tài liệu
- Nếu tài liệu có nhiều bên, phân biệt rõ trong tên (vd: `ben_a`, `ben_b` hoặc tên bên cụ thể)
- Các thành phần ngày tháng năm nên được tách thành trường riêng với tên mô tả ý nghĩa

## Đặt nhãn hiển thị (`label`)

- Tiếng Việt có dấu, viết hoa chữ đầu
- Ngắn gọn nhưng đủ rõ nghĩa (4-10 từ)
- Nếu có nhiều bên hoặc nhiều đối tượng tương tự, chú thích trong ngoặc đơn để phân biệt
- Ví dụ tốt: "Bên A (Công ty cung cấp)", "Ngày ký hợp đồng", "Số hợp đồng"
- Ví dụ kém: "Ben A" (thiếu dấu), "Tên" (quá ngắn, không rõ tên ai)

## Viết mô tả (`description`)

Mô tả 2-3 câu tiếng Việt có dấu để giúp hệ thống sau này match giá trị từ file nguồn vào đúng trường. Phải bao gồm:

1. **Field này là gì** trong ngữ cảnh tài liệu (1 câu)
2. **Đặc điểm nhận biết** — field này xuất hiện ở đâu trong tài liệu, vai trò gì, phân biệt với các field tương tự (1 câu)
3. **Ví dụ giá trị cụ thể** — 1-2 ví dụ thực tế để minh họa (1 câu, mở đầu bằng "Ví dụ:")

Ví dụ description tốt:
"Tên pháp lý đầy đủ của doanh nghiệp cung cấp dịch vụ (Bên A), xuất hiện ở phần mở đầu hợp đồng. Phân biệt với Bên B — Bên A là đơn vị chủ động đưa ra dịch vụ hoặc sản phẩm. Ví dụ: 'Công ty Cổ phần Công nghệ GotIT' hoặc 'Công ty TNHH Tư vấn ABC'."

Ví dụ description kém (thiếu context):
"Tên công ty" — không biết công ty nào, không có ví dụ
"Bên A" — không rõ vai trò, không phân biệt với Bên B
"Ngày ký" — không có format, không có ví dụ"""


EXTRACT_PROMPT_MD = """Bạn là công cụ phân tích tài liệu mẫu (template). Tài liệu được render dưới dạng Markdown có marker `[§id]` đánh dấu vị trí từng đoạn/ô:
- Đoạn văn ngoài bảng: `[§p0] nội dung`
- Ô trong bảng: `[§t0r1c2p0] nội dung` (bảng 0, hàng 1, cột 2, đoạn 0)

Trả về JSON:
{
  "fields": [
    {
      "seg": "id_segment",
      "name": "ten_placeholder",
      "label": "Nhãn hiển thị tiếng Việt",
      "description": "Mô tả chi tiết trường này là gì, dùng để làm gì, ví dụ giá trị",
      "current": "chuỗi cần thay thế"
    },
    ...
  ],
  "description": "1-2 câu mô tả tài liệu là loại gì và dùng để làm gì"
}

Với `seg`: dùng đúng giá trị `id` từ marker `[§id]` của đoạn/ô chứa trường cần điền.

## Nhận diện trường cần điền

Trường cần điền là chỗ mà người dùng phải cung cấp thông tin — không phải nội dung cố định của tài liệu. Dấu hiệu thường gặp: ô trống trong bảng, dấu gạch dài (___), dấu chấm lửng (...), ký tự giữ chỗ dạng ngoặc vuông như [*], định dạng ngày tháng chờ điền (DD/MM/YYYY).

Nội dung KHÔNG phải trường cần điền: tiêu đề, điều khoản pháp lý, dữ liệu cố định đã có giá trị, thông tin của đơn vị phát hành tài liệu, ô trống thuần túy dùng để phân cách bố cục, nội dung lựa chọn/ghi chú mang tính ví dụ đặt trong ngoặc vuông như [OPT 1] hoặc [OPT 2].

## "current" — chuỗi cần thay thế

Phải là chuỗi xuất hiện chính xác trong nội dung segment đó. Ví dụ: nếu segment có `Số: [*]-DAYONE/...` thì current = `[*]` (chỉ token giữ chỗ, không kèm nội dung bên cạnh). Với ô bảng hoàn toàn trống, dùng `"current": ""`.

Nếu một đoạn/ô chứa nhiều chỗ trống, tạo nhiều item riêng biệt với cùng `seg` nhưng `current` khác nhau.

## Đặt tên placeholder (`name`)

- snake_case, tiếng Việt không dấu, mô tả nội dung cần điền
- Đủ dài để rõ nghĩa, không viết tắt tùy tiện
- Không trùng lặp trong cùng tài liệu
- Nếu tài liệu có nhiều bên, phân biệt rõ trong tên (vd: `ben_a`, `ben_b` hoặc tên bên cụ thể)
- Các thành phần ngày tháng năm nên được tách thành trường riêng với tên mô tả ý nghĩa

## Đặt nhãn hiển thị (`label`)

- Tiếng Việt có dấu, viết hoa chữ đầu
- Ngắn gọn nhưng đủ rõ nghĩa (4-10 từ)
- Nếu có nhiều bên hoặc nhiều đối tượng tương tự, chú thích trong ngoặc đơn để phân biệt
- Ví dụ tốt: "Bên A (Công ty cung cấp)", "Ngày ký hợp đồng", "Số hợp đồng"
- Ví dụ kém: "Ben A" (thiếu dấu), "Tên" (quá ngắn, không rõ tên ai)

## Viết mô tả (`description`)

Mô tả 2-3 câu tiếng Việt có dấu để giúp hệ thống sau này match giá trị từ file nguồn vào đúng trường. Phải bao gồm:

1. **Field này là gì** trong ngữ cảnh tài liệu (1 câu)
2. **Đặc điểm nhận biết** — field này xuất hiện ở đâu trong tài liệu, vai trò gì, phân biệt với các field tương tự (1 câu)
3. **Ví dụ giá trị cụ thể** — 1-2 ví dụ thực tế để minh họa (1 câu, mở đầu bằng "Ví dụ:")

Ví dụ description tốt:
"Tên pháp lý đầy đủ của doanh nghiệp cung cấp dịch vụ (Bên A), xuất hiện ở phần mở đầu hợp đồng. Phân biệt với Bên B — Bên A là đơn vị chủ động đưa ra dịch vụ hoặc sản phẩm. Ví dụ: 'Công ty Cổ phần Công nghệ GotIT' hoặc 'Công ty TNHH Tư vấn ABC'."

Ví dụ description kém (thiếu context):
"Tên công ty" — không biết công ty nào, không có ví dụ
"Bên A" — không rõ vai trò, không phân biệt với Bên B
"Ngày ký" — không có format, không có ví dụ"""


async def _llm_extract(content: str, llm_call, prompt: str) -> tuple[list[dict], str]:
    """Single LLM call: detect fields + name placeholders + generate label/description.

    Returns (fields_list, doc_description).
    fields_list items: {
        "seg": loc_id,
        "name": placeholder_name,
        "label": human_readable_label,
        "description": detailed_field_description,
        "current": exact_text,
    }
    """
    messages = [
        {"role": "system", "content": prompt},
        {"role": "user", "content": content},
    ]
    result = await llm_call(messages, response_format={"type": "json_object"})
    logger.info("LLM raw response (truncated):\n%s", result[:3000])
    # Strip markdown code fences that Anthropic (and some other models) wrap around JSON
    result = (result or "").strip()
    if result.startswith("```"):
        result = result.split("\n", 1)[1] if "\n" in result else result[3:]
        if result.endswith("```"):
            result = result[:-3]
        result = result.strip()
    try:
        data = json.loads(result)
    except (json.JSONDecodeError, TypeError):
        logger.warning("LLM returned invalid JSON for template extraction")
        return [], ""

    fields = []
    for item in data.get("fields", []):
        seg = item.get("seg", "").strip()
        name = item.get("name", "").strip()
        label = (item.get("label") or "").strip()
        description = (item.get("description") or "").strip()
        current = item.get("current", None)
        if seg and name:
            fields.append({
                "seg": seg,
                "name": name,
                "label": label,
                "description": description,
                "current": current,
            })

    logger.info("LLM fields parsed: %s", json.dumps(fields, ensure_ascii=False))
    doc_description = data.get("description", "").strip()[:500]
    return fields, doc_description


# ── Step 4: Classify segments identified by LLM ──────────────────────

_PLACEHOLDER_PAT = re.compile(r'\[([\w\sÀ-ɏ]{2,})\]')
_DATE_PAT = re.compile(r'(?:DD|dd)/(?:MM|mm)/(?:YYYY|YY|yyyy|yy)\d*')
_BLANK_PAT = re.compile(
    r'…[\s(]|[.…]{3,}|_{3,}|-{3,}|\{\{[\w\s]+\}\}|[☐☑]|\[\s*\]|\[\*\]',
    re.UNICODE,
)


_HAS_ALPHA = re.compile(r'[a-zA-ZÀ-ɏÀ-ɏ]')


def _resolve_current(llm_current: str, seg_text: str) -> str:
    """Sanitize LLM's current — trim to just the blank marker when LLM over-specified.

    LLMs sometimes return the marker plus trailing context (e.g. "[*]-DAYONE/...")
    instead of just the minimal token ("[*]"). This trims the excess.
    """
    if not llm_current:
        return llm_current

    # Case 1: LLM returned the entire segment text — find the first marker inside
    if llm_current.strip() == seg_text.strip():
        for pat in (_BLANK_PAT, _DATE_PAT, _PLACEHOLDER_PAT):
            m = pat.search(seg_text)
            if m:
                return m.group()
        return llm_current

    # Case 2: current starts with a marker then has trailing alphabetic text
    # (e.g. "[*]-DAYONE/[CÔNG TY]/..." → trim to "[*]")
    # Safe to skip if trailing part is only separators like "/___/___" (date format)
    for pat in (_BLANK_PAT, _DATE_PAT, _PLACEHOLDER_PAT):
        m = pat.match(llm_current)
        if m:
            marker = m.group()
            after = llm_current[len(marker):]
            if after.strip() and _HAS_ALPHA.search(after):
                return marker

    return llm_current


def _classify_segment(seg: dict) -> tuple[str, str, int | None]:
    """Determine field type + current value + position for a segment.

    Returns (type, current, position) — position only for blank/date/placeholder.
    """
    text = seg["text"]
    loc = seg["location"]
    is_table = bool(re.match(r'(?:s\d+[hf])?t\d+', loc))

    if not text and is_table:
        return "empty", "(trống)", None

    if not text:
        return "empty", "(trống)", None

    m = _PLACEHOLDER_PAT.search(text)
    if m:
        return "placeholder", m.group(), m.start()

    m = _DATE_PAT.search(text)
    if m:
        return "date", m.group(), m.start()

    m = _BLANK_PAT.search(text)
    if m:
        return "blank", m.group()[:30], m.start()

    stripped = text.strip()
    if stripped.endswith(":") or stripped.endswith(": "):
        return "label_empty", text, None

    # Segment has text but no recognizable blank pattern — treat as label_empty
    # (LLM identified it, so trust LLM even if pattern doesn't match)
    return "label_empty", text, None


# ── Step 5: Replace blanks with {placeholder} (run-level) ────────────

def _merge_runs(paragraph) -> None:
    """Merge all runs into run[0]. Used only when run-level replace isn't possible."""
    if not paragraph.runs:
        return
    full = "".join(r.text for r in paragraph.runs)
    paragraph.runs[0].text = full
    for run in paragraph.runs[1:]:
        run._element.getparent().remove(run._element)


def _replace_in_runs(para, old_text: str, new_text: str) -> bool:
    """Replace old_text with new_text in para while preserving run formatting.

    Finds which run(s) span old_text and performs surgical replacement.
    Falls back to _merge_runs only when old_text spans multiple runs
    with different formatting.

    Returns True if replacement was made.
    """
    if not para.runs:
        return False

    full_text = para.text
    pos = full_text.find(old_text)
    if pos == -1:
        return False

    end = pos + len(old_text)

    # Build cumulative run boundaries
    boundaries: list[tuple] = []  # (run, start, end)
    cursor = 0
    for run in para.runs:
        run_end = cursor + len(run.text)
        boundaries.append((run, cursor, run_end))
        cursor = run_end

    # Find which runs are touched by [pos, end)
    touched = [(r, rs, re) for r, rs, re in boundaries if rs < end and re > pos]

    if not touched:
        return False

    if len(touched) == 1:
        # Best case: entirely within one run — no formatting loss
        run, rs, _ = touched[0]
        local_start = pos - rs
        local_end = end - rs
        run.text = run.text[:local_start] + new_text + run.text[local_end:]
        return True

    # Multi-run case: merge only the touched runs, keep others intact
    first_run, first_start, _ = touched[0]
    last_run, _, last_end = touched[-1]

    local_start = pos - first_start
    local_end_in_last = end - (last_end - len(last_run.text))

    new_first_text = first_run.text[:local_start] + new_text + last_run.text[max(0, local_end_in_last):]
    first_run.text = new_first_text

    # Remove all touched runs except first
    for run, _, _ in touched[1:]:
        run._element.getparent().remove(run._element)

    return True


def _apply_field_to_para(para, ftype: str, current: str, placeholder: str) -> bool:
    """Apply placeholder replacement to a paragraph based on field type.

    Returns True if replacement was made.
    """
    token = "{" + placeholder + "}"
    text = para.text

    if ftype == "empty":
        if para.runs:
            para.runs[0].text = token
            for run in para.runs[1:]:
                run._element.getparent().remove(run._element)
        else:
            from docx.oxml.ns import qn
            from lxml import etree
            r = etree.SubElement(para._element, qn("w:r"))
            t = etree.SubElement(r, qn("w:t"))
            t.text = token
        return True

    if ftype == "placeholder":
        return _replace_in_runs(para, current, token)

    if ftype == "date":
        return _replace_in_runs(para, current, token)

    if ftype == "blank":
        # Use the classified current value for exact replacement
        if current and current in text:
            return _replace_in_runs(para, current, token)
        # Fallback: find first matching blank pattern
        m = _BLANK_PAT.search(text)
        if m:
            return _replace_in_runs(para, m.group(), token)
        return False

    if ftype == "label_empty":
        stripped = text.rstrip()
        # Append placeholder after the label
        return _replace_in_runs(para, stripped, stripped + " " + token)

    return False


# ── Unique name enforcement ───────────────────────────────────────────

def _ensure_unique_names(fields: list[dict]) -> list[dict]:
    """Append _2, _3 suffix to duplicate placeholder names."""
    seen: dict[str, int] = {}
    result = []
    for f in fields:
        name = f["name"]
        if name in seen:
            seen[name] += 1
            f = {**f, "name": f"{name}_{seen[name]}"}
        else:
            seen[name] = 1
        result.append(f)
    return result


def _fallback_name(label: str, idx: int) -> str:
    """Generate snake_case name from label when LLM didn't provide one."""
    import unicodedata
    nfkd = unicodedata.normalize("NFKD", label)
    ascii_text = "".join(c for c in nfkd if not unicodedata.combining(c))
    clean = re.sub(r"[^a-zA-Z0-9\s]", "", ascii_text)
    words = clean.lower().split()[:5]
    return "_".join(words) if words else f"field_{idx}"


# ── Draft extraction (no side effects) ─────────────────────────────────

async def extract_template_draft(
    db: AsyncSession,
    document_id: uuid.UUID,
    llm_call=None,
) -> dict:
    """Run LLM extraction on a source DOCX and return a DRAFT result.

    Does NOT modify the DOCX or create a template Document. Output is a pure
    JSON payload meant to be reviewed + edited by the user before calling
    `commit_template()`.

    Returns:
      {
        "fields": [{id, name, label, description, type, current, location}, ...],
        "doc_description": "1-2 câu mô tả tài liệu",
        "source_document_id": "<uuid>",
      }
    or {"error": "..."} on failure.
    """
    from docx import Document as DocxDocument
    from src.models.storage import StorageConfig

    repo = DocumentRepository(db)
    source_doc = await repo.get_by_id_active(document_id)
    if not source_doc:
        return {"error": f"Document {document_id} not found"}

    storage_cfg = await db.get(StorageConfig, source_doc.storage_config_id)
    if not storage_cfg:
        return {"error": "Storage config not found"}
    backend = get_storage_backend(storage_cfg)
    doc_bytes = await backend.read(source_doc.file_path)

    doc = DocxDocument(BytesIO(doc_bytes))

    segments = _extract_segments(doc)
    seg_by_loc = {s["location"]: s for s in segments}

    if _RENDER_MODE == "xml":
        rendered = _render_annotated_xml(doc, seg_by_loc)
        active_prompt = EXTRACT_PROMPT_XML
    else:
        rendered = _render_annotated_markdown(doc, seg_by_loc)
        active_prompt = EXTRACT_PROMPT_MD
    logger.debug("Rendered content length: %d chars (mode=%s)", len(rendered), _RENDER_MODE)

    if not llm_call:
        return {"error": "llm_call is required for template extraction"}

    llm_fields, llm_doc_description = await _llm_extract(rendered, llm_call, active_prompt)

    if not llm_fields:
        return {"error": "LLM không xác định được trường nào cần điền trong tài liệu."}

    logger.info("LLM identified %d fields", len(llm_fields))

    fields: list[dict] = []
    for i, item in enumerate(llm_fields):
        loc = item["seg"]
        name = item["name"]
        llm_label = (item.get("label") or "").strip()
        llm_field_desc = (item.get("description") or "").strip()
        llm_current = item.get("current")

        seg = seg_by_loc.get(loc)
        if not seg:
            seg = seg_by_loc.get(loc + "p0")
        if not seg:
            logger.warning("LLM returned unknown segment ID: %s", loc)
            continue

        # Use resolved location (para-level) so commit_template can look it up
        resolved_loc = seg["location"]

        seg_text = seg["text"]

        if llm_current is None or llm_current == "":
            ftype = "empty" if not seg_text.strip() else "label_empty"
            current = ""
        elif _DATE_PAT.search(llm_current):
            ftype = "date"
            current = _resolve_current(llm_current, seg_text)
        else:
            ftype = "blank"
            current = _resolve_current(llm_current, seg_text)

        label = llm_label or name.replace("_", " ").title()

        fields.append({
            "id": f"f{i}",
            "location": resolved_loc,
            "name": name,
            "label": label,
            "description": llm_field_desc,
            "type": ftype,
            "current": current,
        })

    if not fields:
        return {"error": "Không có segment hợp lệ nào sau khi validate LLM output."}

    fields = _ensure_unique_names(fields)

    return {
        "fields": fields,
        "doc_description": llm_doc_description,
        "source_document_id": str(document_id),
    }


# ── Commit draft → template Document ──────────────────────────────────

async def commit_template(
    db: AsyncSession,
    source_document_id: uuid.UUID,
    fields: list[dict],
    user_id: uuid.UUID,
    doc_description: str | None = None,
) -> dict:
    """Apply user-edited fields to the source DOCX and create a template Document.

    `fields` format (subset of draft output, after user edits):
      [{id, name, label, description, type, current, location}, ...]

    Required per-field keys: name, label, type, current, location.
    Unknown keys are ignored.
    """
    from docx import Document as DocxDocument
    from src.models.storage import StorageConfig

    repo = DocumentRepository(db)
    source_doc = await repo.get_by_id_active(source_document_id)
    if not source_doc:
        return {"error": f"Source document {source_document_id} not found"}

    storage_cfg = await db.get(StorageConfig, source_doc.storage_config_id)
    if not storage_cfg:
        return {"error": "Storage config not found"}
    backend = get_storage_backend(storage_cfg)
    doc_bytes = await backend.read(source_doc.file_path)

    doc = DocxDocument(BytesIO(doc_bytes))

    # Re-extract segments to resolve locations → para_ref (cheap, no LLM)
    segments = _extract_segments(doc)
    seg_by_loc = {s["location"]: s for s in segments}

    # Normalize + validate incoming fields
    normalized: list[dict] = []
    for i, f in enumerate(fields):
        name = (f.get("name") or f.get("placeholder") or "").strip()
        loc = (f.get("location") or "").strip()
        if not name or not loc:
            logger.warning("Skipping invalid field at index %d (missing name/location)", i)
            continue
        normalized.append({
            "id": f.get("id") or f"f{i}",
            "name": name,
            "label": (f.get("label") or name.replace("_", " ").title()).strip(),
            "description": (f.get("description") or "").strip(),
            "type": f.get("type") or "blank",
            "current": f.get("current") or "",
            "location": loc,
        })

    if not normalized:
        return {"error": "Không có field hợp lệ để commit."}

    normalized = _ensure_unique_names(normalized)

    # Replace blanks with {placeholder} in DOCX
    replaced_count = 0
    for field in normalized:
        loc = field["location"]
        seg = seg_by_loc.get(loc)
        if not seg:
            seg = seg_by_loc.get(loc + "p0")
        if not seg:
            logger.warning("Field %s references unknown location %s", field["name"], loc)
            continue
        para = seg["para_ref"]
        ok = _apply_field_to_para(para, field["type"], field["current"], field["name"])
        if ok:
            replaced_count += 1
        else:
            logger.warning("Could not replace field %s at %s (type=%s)", field["name"], field["location"], field["type"])

    logger.info("Committed %d / %d fields into template", replaced_count, len(normalized))

    # Save template DOCX to storage
    output = BytesIO()
    doc.save(output)
    template_bytes = output.getvalue()

    src_path = Path(source_doc.original_filename)
    out_filename = f"{src_path.stem}_template{src_path.suffix}"
    save_result = await backend.save(template_bytes, out_filename)

    # Build template_fields metadata (persisted shape)
    template_fields = [
        {
            "id": f["id"],
            "placeholder": f["name"],
            "label": f["label"],
            "description": f.get("description", ""),
            "location": f["location"],
            "type": f["type"],
        }
        for f in normalized
    ]

    template_doc = Document(
        title=f"{source_doc.title} (template)",
        description=doc_description or None,
        file_name=save_result.file_name,
        original_filename=out_filename,
        file_path=save_result.file_path,
        file_size=save_result.file_size,
        mime_type=source_doc.mime_type,
        extension=src_path.suffix.lstrip("."),
        checksum=save_result.checksum,
        storage_config_id=source_doc.storage_config_id,
        owner_id=user_id,
        source_type="template",
        source_metadata={
            "source_document_id": str(source_document_id),
            "template_fields": template_fields,
            "extraction_status": "completed",
            "replaced_count": replaced_count,
        },
    )
    db.add(template_doc)
    await db.flush()
    await db.refresh(template_doc)
    await db.commit()

    return {
        "template_id": str(template_doc.id),
        "source_document_id": str(source_document_id),
        "field_count": len(normalized),
        "replaced_count": replaced_count,
        "description": doc_description,
        "template_fields": template_fields,
    }


# ── Legacy one-shot extract (backward compat) ─────────────────────────

async def extract_template(
    db: AsyncSession,
    settings: Settings,
    document_id: uuid.UUID,
    user_id: uuid.UUID,
    description: str | None = None,
    llm_call=None,
) -> dict:
    """One-shot extract + commit — legacy path. Prefer draft + commit split for new flows."""
    draft = await extract_template_draft(db=db, document_id=document_id, llm_call=llm_call)
    if draft.get("error"):
        return draft

    return await commit_template(
        db=db,
        source_document_id=document_id,
        fields=draft["fields"],
        user_id=user_id,
        doc_description=description or draft.get("doc_description"),
    )
