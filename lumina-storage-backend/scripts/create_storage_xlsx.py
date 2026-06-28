import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from copy import copy

wb = openpyxl.load_workbook(r"C:\Users\dangnh\Downloads\Lumina_Danh_Sach_Chuc_Nang_v2.xlsx")
ws = wb.active

# --- Style definitions (from original file) ---
thin_border = Border(
    left=Side(style="thin", color="DDDDDD"),
    right=Side(style="thin", color="DDDDDD"),
    top=Side(style="thin", color="DDDDDD"),
    bottom=Side(style="thin", color="DDDDDD"),
)

# Section header: green bg, white bold
section_fill = PatternFill(start_color="38761D", end_color="38761D", fill_type="solid")
section_font = Font(name="Arial", size=11, bold=True, color="FFFFFF")
section_align = Alignment(horizontal="left", vertical="center")

# Screen header row: light gray bg
screen_fill = PatternFill(start_color="EDF2F4", end_color="EDF2F4", fill_type="solid")
screen_font_a = Font(name="Arial", size=10, bold=True)
screen_font_b = Font(name="Arial", size=9, bold=True, color="555555")
screen_font_c = Font(name="Arial", size=10, bold=True, color="1D3557")
screen_font_rest = Font(name="Arial", size=11)
screen_align_a = Alignment(horizontal="center", vertical="center")
screen_align = Alignment(vertical="center")

# Detail rows: alternating white / light gray
detail_fill_odd = PatternFill(start_color="F8F9FA", end_color="F8F9FA", fill_type="solid")
detail_fill_even = PatternFill(start_color="FFFFFF", end_color="FFFFFF", fill_type="solid")
detail_font_d = Font(name="Arial", size=10)
detail_font_rest = Font(name="Arial", size=10)
detail_align_d = Alignment(vertical="center", wrap_text=True)
detail_align_center = Alignment(horizontal="center", vertical="center")

# --- Unmerge and clear rows 148+ ---
to_unmerge = [str(mr) for mr in ws.merged_cells.ranges if mr.min_row >= 148]
for mr in to_unmerge:
    ws.unmerge_cells(mr)

for row in range(148, ws.max_row + 1):
    for col in range(1, 27):
        cell = ws.cell(row=row, column=col)
        cell.value = None
        cell.fill = PatternFill(fill_type=None)
        cell.font = Font()
        cell.alignment = Alignment()
        cell.border = Border()

# --- Data ---
data = [
    # (type, STT, Product, Screen, Detail, Status)
    # type: "section", "screen", "detail"
    ("section", "LUMINA STORAGE - Qu\u1ea3n l\u00fd d\u1eef li\u1ec7u", None, None, None, None),

    ("screen", "26.0", "LUMINA STORAGE", "M\u00e0n h\u00ecnh Qu\u1ea3n l\u00fd t\u00e0i li\u1ec7u", None, None),
    ("detail", None, None, None, "Upload file \u0111\u01a1n l\u1ebb ho\u1eb7c nhi\u1ec1u file c\u00f9ng l\u00fac, h\u1ed7 tr\u1ee3 drag & drop", "Ho\u00e0n th\u00e0nh"),
    ("detail", None, None, None, "Upload c\u1ea3 th\u01b0 m\u1ee5c, gi\u1eef nguy\u00ean c\u1ea5u tr\u00fac folder con", "Ho\u00e0n th\u00e0nh"),
    ("detail", None, None, None, "H\u1ed7 tr\u1ee3 \u0111a \u0111\u1ecbnh d\u1ea1ng: PDF, DOCX, XLSX, PPTX, h\u00ecnh \u1ea3nh (PNG/JPG), TXT, MD, CSV", "Ho\u00e0n th\u00e0nh"),
    ("detail", None, None, None, "T\u1ef1 \u0111\u1ed9ng t\u1ea1o thumbnail preview v\u00e0 tr\u00edch xu\u1ea5t n\u1ed9i dung b\u1eb1ng VLM (Vision Language Model)", "Ho\u00e0n th\u00e0nh"),
    ("detail", None, None, None, "Xem chi ti\u1ebft, download, preview t\u00e0i li\u1ec7u tr\u1ef1c ti\u1ebfp tr\u00ean tr\u00ecnh duy\u1ec7t", "Ho\u00e0n th\u00e0nh"),
    ("detail", None, None, None, "\u0110\u00e1nh d\u1ea5u sao (Favorite), di chuy\u1ec3n gi\u1eefa th\u01b0 m\u1ee5c, qu\u1ea3n l\u00fd phi\u00ean b\u1ea3n (Versioning)", "Ho\u00e0n th\u00e0nh"),
    ("detail", None, None, None, "X\u00f3a m\u1ec1m (Th\u00f9ng r\u00e1c), kh\u00f4i ph\u1ee5c, x\u00f3a v\u0129nh vi\u1ec5n, x\u00f3a h\u00e0ng lo\u1ea1t (Bulk delete)", "Ho\u00e0n th\u00e0nh"),
    ("detail", None, None, None, "T\u1ea1o th\u01b0 m\u1ee5c l\u1ed3ng nhau (nested), duy\u1ec7t c\u1ea5u tr\u00fac c\u00e2y (tree view)", "Ho\u00e0n th\u00e0nh"),
    ("detail", None, None, None, "T\u00ecm ki\u1ebfm Full-text (t\u1eeb kh\u00f3a) v\u00e0 Semantic Search (ng\u1eef ngh\u0129a) qua Vector Database", "Ho\u00e0n th\u00e0nh"),
    ("detail", None, None, None, "B\u1ed9 l\u1ecdc n\u00e2ng cao: th\u01b0 m\u1ee5c, lo\u1ea1i file, ng\u01b0\u1eddi upload, kho\u1ea3ng th\u1eddi gian; s\u1eafp x\u1ebfp linh ho\u1ea1t", "Ho\u00e0n th\u00e0nh"),
    ("detail", None, None, None, "Chia s\u1ebb t\u00e0i li\u1ec7u/th\u01b0 m\u1ee5c v\u1edbi nh\u00f3m: 3 c\u1ea5p quy\u1ec1n Viewer/Editor/Manager, k\u1ebf th\u1eeba t\u1eeb folder", "Ho\u00e0n th\u00e0nh"),
    ("detail", None, None, None, "Import file/th\u01b0 m\u1ee5c t\u1eeb Google Drive qua URL chia s\u1ebb, gi\u1eef nguy\u00ean c\u1ea5u tr\u00fac", "Ho\u00e0n th\u00e0nh"),
    ("detail", None, None, None, "Theo d\u00f5i tr\u1ea1ng th\u00e1i x\u1eed l\u00fd t\u00e0i li\u1ec7u v\u00e0 import: pending, processing, completed, failed", "Ho\u00e0n th\u00e0nh"),

    ("screen", "27.0", "LUMINA STORAGE", "M\u00e0n h\u00ecnh Chat AI v\u1edbi t\u00e0i li\u1ec7u (RAG)", None, None),
    ("detail", None, None, None, "T\u1ea1o phi\u00ean h\u1ed9i tho\u1ea1i, qu\u1ea3n l\u00fd l\u1ecbch s\u1eed, \u0111\u1eb7t t\u00ean t\u00f9y ch\u1ec9nh", "Ho\u00e0n th\u00e0nh"),
    ("detail", None, None, None, "H\u1ecfi \u0111\u00e1p b\u1eb1ng ng\u00f4n ng\u1eef t\u1ef1 nhi\u00ean, AI tr\u1ea3 l\u1eddi d\u1ef1a tr\u00ean n\u1ed9i dung t\u00e0i li\u1ec7u (RAG) v\u1edbi streaming realtime", "Ho\u00e0n th\u00e0nh"),
    ("detail", None, None, None, "Hi\u1ec3n th\u1ecb ngu\u1ed3n tr\u00edch d\u1eabn (Citation) v\u1edbi s\u1ed1 trang, \u0111o\u1ea1n tr\u00edch v\u00e0 \u0111\u1ed9 li\u00ean quan", "Ho\u00e0n th\u00e0nh"),
    ("detail", None, None, None, "Ch\u1ecdn AI model cho t\u1eebng tin nh\u1eafn (\u0111a provider: OpenAI, Azure, Anthropic, Google Gemini)", "Ho\u00e0n th\u00e0nh"),
    ("detail", None, None, None, "Xem l\u1ecbch s\u1eed tin nh\u1eafn v\u1edbi ph\u00e2n trang, h\u1ed7 tr\u1ee3 Agent tools v\u00e0 Skill execution", "Ho\u00e0n th\u00e0nh"),

    ("screen", "28.0", "LUMINA STORAGE", "M\u00e0n h\u00ecnh Qu\u1ea3n tr\u1ecb h\u1ec7 th\u1ed1ng (Admin)", None, None),
    ("detail", None, None, None, "Qu\u1ea3n l\u00fd ng\u01b0\u1eddi d\u00f9ng: danh s\u00e1ch, t\u00ecm ki\u1ebfm, l\u1ecdc theo vai tr\u00f2/nh\u00f3m, k\u00edch ho\u1ea1t/v\u00f4 hi\u1ec7u h\u00f3a", "Ho\u00e0n th\u00e0nh"),
    ("detail", None, None, None, "Qu\u1ea3n l\u00fd vai tr\u00f2 (Role) v\u00e0 ph\u00e2n quy\u1ec1n menu theo vai tr\u00f2", "Ho\u00e0n th\u00e0nh"),
    ("detail", None, None, None, "Qu\u1ea3n l\u00fd nh\u00f3m: nh\u00f3m th\u1ee7 c\u00f4ng (Manual) v\u00e0 nh\u00f3m t\u1ef1 \u0111\u1ed9ng (Auto) theo vai tr\u00f2, h\u1ed7 tr\u1ee3 Select All v\u1edbi Exclusion", "Ho\u00e0n th\u00e0nh"),
    ("detail", None, None, None, "C\u1ea5u h\u00ecnh Storage Backend: Local, AWS S3, MinIO \u2014 \u0111\u1eb7t m\u1eb7c \u0111\u1ecbnh, h\u1ed7 tr\u1ee3 nhi\u1ec1u backend \u0111\u1ed3ng th\u1eddi", "Ho\u00e0n th\u00e0nh"),
    ("detail", None, None, None, "C\u1ea5u h\u00ecnh AI Model: th\u00eam/test/\u0111\u1eb7t m\u1eb7c \u0111\u1ecbnh cho LLM v\u00e0 Embedding, \u0111a provider", "Ho\u00e0n th\u00e0nh"),
    ("detail", None, None, None, "C\u1ea5u h\u00ecnh h\u1ec7 th\u1ed1ng (key-value), ph\u00e2n bi\u1ec7t Public/Private", "Ho\u00e0n th\u00e0nh"),
    ("detail", None, None, None, "Nh\u1eadt k\u00fd ki\u1ec3m to\u00e1n (Audit Log) v\u00e0 theo d\u00f5i Background Tasks", "Ho\u00e0n th\u00e0nh"),
    ("detail", None, None, None, "X\u00e1c th\u1ef1c JWT (Access + Refresh Token), \u0111\u0103ng k\u00fd/\u0111\u0103ng nh\u1eadp", "Ho\u00e0n th\u00e0nh"),
]

# --- Write with formatting ---
detail_idx = 0  # for alternating colors
row_num = 148

for entry in data:
    row_type = entry[0]

    if row_type == "section":
        # Section header: merge A-J, green bg, white bold
        text = entry[1]
        ws.cell(row=row_num, column=1, value=text)
        for col in range(1, 11):
            c = ws.cell(row=row_num, column=col)
            c.fill = section_fill
            c.font = section_font
            c.alignment = section_align
            c.border = thin_border
        detail_idx = 0

    elif row_type == "screen":
        stt, product, screen = entry[1], entry[2], entry[3]
        ws.cell(row=row_num, column=1, value=stt)
        ws.cell(row=row_num, column=2, value=product)
        ws.cell(row=row_num, column=3, value=screen)
        for col in range(1, 11):
            c = ws.cell(row=row_num, column=col)
            c.fill = screen_fill
            c.border = thin_border
            c.alignment = screen_align
        ws.cell(row=row_num, column=1).font = screen_font_a
        ws.cell(row=row_num, column=1).alignment = screen_align_a
        ws.cell(row=row_num, column=2).font = screen_font_b
        ws.cell(row=row_num, column=3).font = screen_font_c
        for col in range(4, 11):
            ws.cell(row=row_num, column=col).font = screen_font_rest
        detail_idx = 0

    elif row_type == "detail":
        detail_text, status = entry[4], entry[5]
        fill = detail_fill_odd if detail_idx % 2 == 0 else detail_fill_even
        ws.cell(row=row_num, column=4, value=detail_text)
        if status:
            ws.cell(row=row_num, column=10, value=status)
        for col in range(1, 11):
            c = ws.cell(row=row_num, column=col)
            c.fill = fill
            c.border = thin_border
            if col == 4:
                c.font = detail_font_d
                c.alignment = detail_align_d
            else:
                c.font = detail_font_rest
                c.alignment = detail_align_center
        detail_idx += 1

    row_num += 1

wb.save(r"C:\Users\dangnh\Downloads\Lumina_Danh_Sach_Chuc_Nang_v2.xlsx")
print(f"Done! Wrote {len(data)} rows with formatting (row 148 to {row_num - 1})")
