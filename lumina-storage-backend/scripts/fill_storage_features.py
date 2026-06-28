import openpyxl

wb = openpyxl.load_workbook(r"C:\Users\dangnh\Downloads\Lumina_Danh_Sach_Chuc_Nang_v2.xlsx")
ws = wb.active

# Step 1: Unmerge ALL merged cells in the range, then clear
# Collect merged ranges that overlap with our area
to_unmerge = []
for merged_range in ws.merged_cells.ranges:
    if merged_range.min_row >= 149:
        to_unmerge.append(str(merged_range))
for mr in to_unmerge:
    ws.unmerge_cells(mr)

# Now clear ALL rows from 149 to end
for row in range(149, ws.max_row + 1):
    for col in range(1, 27):
        ws.cell(row=row, column=col, value=None)

# Rewrite row 149 header
ws.cell(row=149, column=1, value="26.0")
ws.cell(row=149, column=2, value="LUMINA STORAGE")
ws.cell(row=149, column=3, value="M\u00e0n h\u00ecnh Qu\u1ea3n l\u00fd t\u00e0i li\u1ec7u")

# Step 2: Write consolidated data
vn_data = [
    # 26.0 details (header already at row 149)
    (None, None, None, "Upload file \u0111\u01a1n l\u1ebb ho\u1eb7c nhi\u1ec1u file c\u00f9ng l\u00fac, h\u1ed7 tr\u1ee3 drag & drop", "Ho\u00e0n th\u00e0nh"),
    (None, None, None, "Upload c\u1ea3 th\u01b0 m\u1ee5c, gi\u1eef nguy\u00ean c\u1ea5u tr\u00fac folder con", "Ho\u00e0n th\u00e0nh"),
    (None, None, None, "H\u1ed7 tr\u1ee3 \u0111a \u0111\u1ecbnh d\u1ea1ng: PDF, DOCX, XLSX, PPTX, h\u00ecnh \u1ea3nh (PNG/JPG), TXT, MD, CSV", "Ho\u00e0n th\u00e0nh"),
    (None, None, None, "T\u1ef1 \u0111\u1ed9ng t\u1ea1o thumbnail preview v\u00e0 tr\u00edch xu\u1ea5t n\u1ed9i dung b\u1eb1ng VLM (Vision Language Model)", "Ho\u00e0n th\u00e0nh"),
    (None, None, None, "Xem chi ti\u1ebft, download, preview t\u00e0i li\u1ec7u tr\u1ef1c ti\u1ebfp tr\u00ean tr\u00ecnh duy\u1ec7t", "Ho\u00e0n th\u00e0nh"),
    (None, None, None, "\u0110\u00e1nh d\u1ea5u sao (Favorite), di chuy\u1ec3n gi\u1eefa th\u01b0 m\u1ee5c, qu\u1ea3n l\u00fd phi\u00ean b\u1ea3n (Versioning)", "Ho\u00e0n th\u00e0nh"),
    (None, None, None, "X\u00f3a m\u1ec1m (Th\u00f9ng r\u00e1c), kh\u00f4i ph\u1ee5c, x\u00f3a v\u0129nh vi\u1ec5n, x\u00f3a h\u00e0ng lo\u1ea1t (Bulk delete)", "Ho\u00e0n th\u00e0nh"),
    (None, None, None, "T\u1ea1o th\u01b0 m\u1ee5c l\u1ed3ng nhau (nested), duy\u1ec7t c\u1ea5u tr\u00fac c\u00e2y (tree view)", "Ho\u00e0n th\u00e0nh"),
    (None, None, None, "T\u00ecm ki\u1ebfm Full-text (t\u1eeb kh\u00f3a) v\u00e0 Semantic Search (ng\u1eef ngh\u0129a) qua Vector Database", "Ho\u00e0n th\u00e0nh"),
    (None, None, None, "B\u1ed9 l\u1ecdc n\u00e2ng cao: th\u01b0 m\u1ee5c, lo\u1ea1i file, ng\u01b0\u1eddi upload, kho\u1ea3ng th\u1eddi gian; s\u1eafp x\u1ebfp linh ho\u1ea1t", "Ho\u00e0n th\u00e0nh"),
    (None, None, None, "Chia s\u1ebb t\u00e0i li\u1ec7u/th\u01b0 m\u1ee5c v\u1edbi nh\u00f3m: 3 c\u1ea5p quy\u1ec1n Viewer/Editor/Manager, k\u1ebf th\u1eeba t\u1eeb folder", "Ho\u00e0n th\u00e0nh"),
    (None, None, None, "Import file/th\u01b0 m\u1ee5c t\u1eeb Google Drive qua URL chia s\u1ebb, gi\u1eef nguy\u00ean c\u1ea5u tr\u00fac", "Ho\u00e0n th\u00e0nh"),
    (None, None, None, "Theo d\u00f5i tr\u1ea1ng th\u00e1i x\u1eed l\u00fd t\u00e0i li\u1ec7u v\u00e0 import: pending, processing, completed, failed", "Ho\u00e0n th\u00e0nh"),

    # 27.0 Chat AI
    ("27.0", "LUMINA STORAGE", "M\u00e0n h\u00ecnh Chat AI v\u1edbi t\u00e0i li\u1ec7u (RAG)", None, None),
    (None, None, None, "T\u1ea1o phi\u00ean h\u1ed9i tho\u1ea1i, qu\u1ea3n l\u00fd l\u1ecbch s\u1eed, \u0111\u1eb7t t\u00ean t\u00f9y ch\u1ec9nh", "Ho\u00e0n th\u00e0nh"),
    (None, None, None, "H\u1ecfi \u0111\u00e1p b\u1eb1ng ng\u00f4n ng\u1eef t\u1ef1 nhi\u00ean, AI tr\u1ea3 l\u1eddi d\u1ef1a tr\u00ean n\u1ed9i dung t\u00e0i li\u1ec7u (RAG) v\u1edbi streaming realtime", "Ho\u00e0n th\u00e0nh"),
    (None, None, None, "Hi\u1ec3n th\u1ecb ngu\u1ed3n tr\u00edch d\u1eabn (Citation) v\u1edbi s\u1ed1 trang, \u0111o\u1ea1n tr\u00edch v\u00e0 \u0111\u1ed9 li\u00ean quan", "Ho\u00e0n th\u00e0nh"),
    (None, None, None, "Ch\u1ecdn AI model cho t\u1eebng tin nh\u1eafn (\u0111a provider: OpenAI, Azure, Anthropic, Google Gemini)", "Ho\u00e0n th\u00e0nh"),
    (None, None, None, "Xem l\u1ecbch s\u1eed tin nh\u1eafn v\u1edbi ph\u00e2n trang, h\u1ed7 tr\u1ee3 Agent tools v\u00e0 Skill execution", "Ho\u00e0n th\u00e0nh"),

    # 28.0 Admin
    ("28.0", "LUMINA STORAGE", "M\u00e0n h\u00ecnh Qu\u1ea3n tr\u1ecb h\u1ec7 th\u1ed1ng (Admin)", None, None),
    (None, None, None, "Qu\u1ea3n l\u00fd ng\u01b0\u1eddi d\u00f9ng: danh s\u00e1ch, t\u00ecm ki\u1ebfm, l\u1ecdc theo vai tr\u00f2/nh\u00f3m, k\u00edch ho\u1ea1t/v\u00f4 hi\u1ec7u h\u00f3a", "Ho\u00e0n th\u00e0nh"),
    (None, None, None, "Qu\u1ea3n l\u00fd vai tr\u00f2 (Role) v\u00e0 ph\u00e2n quy\u1ec1n menu theo vai tr\u00f2", "Ho\u00e0n th\u00e0nh"),
    (None, None, None, "Qu\u1ea3n l\u00fd nh\u00f3m: nh\u00f3m th\u1ee7 c\u00f4ng (Manual) v\u00e0 nh\u00f3m t\u1ef1 \u0111\u1ed9ng (Auto) theo vai tr\u00f2, h\u1ed7 tr\u1ee3 Select All v\u1edbi Exclusion", "Ho\u00e0n th\u00e0nh"),
    (None, None, None, "C\u1ea5u h\u00ecnh Storage Backend: Local, AWS S3, MinIO \u2014 \u0111\u1eb7t m\u1eb7c \u0111\u1ecbnh, h\u1ed7 tr\u1ee3 nhi\u1ec1u backend \u0111\u1ed3ng th\u1eddi", "Ho\u00e0n th\u00e0nh"),
    (None, None, None, "C\u1ea5u h\u00ecnh AI Model: th\u00eam/test/\u0111\u1eb7t m\u1eb7c \u0111\u1ecbnh cho LLM v\u00e0 Embedding, \u0111a provider", "Ho\u00e0n th\u00e0nh"),
    (None, None, None, "C\u1ea5u h\u00ecnh h\u1ec7 th\u1ed1ng (key-value), ph\u00e2n bi\u1ec7t Public/Private", "Ho\u00e0n th\u00e0nh"),
    (None, None, None, "Nh\u1eadt k\u00fd ki\u1ec3m to\u00e1n (Audit Log) v\u00e0 theo d\u00f5i Background Tasks", "Ho\u00e0n th\u00e0nh"),
    (None, None, None, "X\u00e1c th\u1ef1c JWT (Access + Refresh Token), \u0111\u0103ng k\u00fd/\u0111\u0103ng nh\u1eadp", "Ho\u00e0n th\u00e0nh"),
]

for i, (stt, product, screen, detail, status) in enumerate(vn_data):
    row = 150 + i
    if stt:
        ws.cell(row=row, column=1, value=stt)
    if product:
        ws.cell(row=row, column=2, value=product)
    if screen:
        ws.cell(row=row, column=3, value=screen)
    if detail:
        ws.cell(row=row, column=4, value=detail)
    if status:
        ws.cell(row=row, column=10, value=status)

wb.save(r"C:\Users\dangnh\Downloads\Lumina_Danh_Sach_Chuc_Nang_v2.xlsx")
print(f"Done! Cleared rows 150-250, wrote {len(vn_data)} clean rows (150 to {150 + len(vn_data) - 1})")
