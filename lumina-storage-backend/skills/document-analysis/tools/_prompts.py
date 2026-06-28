"""Domain-specific prompts for document analysis."""

CLASSIFY_PROMPT = """Phân loại tài liệu. Trả về JSON:
{"domain": "legal"|"finance"|"hr"|"general", "doc_type": "<loại cụ thể>", "confidence": 0.0-1.0, "language": "vi"|"en"}

LEGAL: contract, nda, mou, amendment, terms_of_service
FINANCE: invoice, financial_report, purchase_order, balance_sheet, tax_declaration
HR: cv, employment_contract, job_description, performance_review, offer_letter
GENERAL: report, meeting_minutes, proposal, letter, other"""

LEGAL_PROMPT = """Bạn là chuyên gia phân tích pháp lý. Phân tích tài liệu và trả về JSON:

{
  "summary": "<tóm tắt 2-3 câu>",
  "document_info": {
    "title": "", "type": "", "date": "",
    "parties": [{"name": "", "role": "", "representative": ""}],
    "effective_period": ""
  },
  "key_terms": [
    {"term": "", "detail": "", "article": ""}
  ],
  "risk_analysis": [
    {"severity": "high|medium|low", "category": "", "description": "", "clause_reference": "", "recommendation": ""}
  ],
  "missing_protections": [
    {"protection": "", "importance": "critical|recommended|nice_to_have", "explanation": ""}
  ],
  "unfavorable_clauses": [
    {"clause": "", "article": "", "issue": "", "favors": ""}
  ],
  "obligations_summary": [
    {"party": "", "obligation": "", "deadline": "", "penalty": ""}
  ],
  "spelling_errors": [
    {"original": "", "suggestion": "", "location": ""}
  ],
  "warnings": [{"level": "critical|warning|info", "message": ""}]
}

Danh mục rủi ro: TERMINATION, LIABILITY, IP_RIGHTS, CONFIDENTIALITY, PAYMENT, DISPUTE, COMPLIANCE, PENALTY.

Quy tắc:
- Phân tích TRUNG LẬP cho tất cả các bên
- Trích dẫn số điều/khoản cụ thể
- Viết bằng CÙNG NGÔN NGỮ với tài liệu
- Cụ thể, không nhận xét chung chung
- Mỗi rủi ro phải có khuyến nghị hành động
- Kiểm tra lỗi chính tả trong văn bản pháp lý (thuật ngữ sai, số điều viết sai) — ghi vào spelling_errors"""

FINANCE_PROMPT = """Bạn là chuyên gia phân tích tài chính. Phân tích tài liệu và trả về JSON:

{
  "summary": "<tóm tắt 2-3 câu>",
  "document_info": {
    "title": "", "type": "", "date": "", "entity": "", "period": "", "currency": ""
  },
  "extracted_figures": [
    {"label": "", "value": "", "unit": "", "location": "", "notes": ""}
  ],
  "calculations_check": [
    {"description": "", "expected": "", "actual": "", "status": "correct|mismatch|unverifiable", "discrepancy": ""}
  ],
  "anomalies": [
    {"severity": "high|medium|low", "type": "", "description": "", "location": "", "recommendation": ""}
  ],
  "key_metrics": [
    {"metric": "", "value": "", "interpretation": ""}
  ],
  "compliance_notes": [
    {"item": "", "status": "compliant|non_compliant|unclear", "detail": ""}
  ],
  "warnings": [{"level": "critical|warning|info", "message": ""}]
}

Loại bất thường: ARITHMETIC, DUPLICATE, MISSING_INFO, UNUSUAL_AMOUNT, DATE_INCONSISTENCY, TAX_ERROR.

Quy tắc:
- Trích xuất TẤT CẢ số liệu kèm label
- Kiểm tra phép tính (tổng, thuế VAT theo mức hiện hành ghi trên tài liệu — xác minh tính nhất quán nội bộ, không áp đặt mức cố định)
- Với hóa đơn VN: kiểm tra MST, serial number, mức thuế suất có khớp với loại hàng hóa/dịch vụ
- Viết bằng CÙNG NGÔN NGỮ với tài liệu
- Chính xác với số — không làm tròn"""

HR_PROMPT = """Bạn là chuyên gia phân tích nhân sự. Phân tích tài liệu và trả về JSON:

{
  "summary": "<tóm tắt 2-3 câu>",
  "document_info": {
    "title": "", "type": "", "date": "", "subject_name": "", "organization": ""
  },
  "profile_analysis": {
    "strengths": [], "concerns": [], "experience_years": "",
    "education_level": "", "key_skills": [], "career_trajectory": ""
  },
  "contract_terms_review": [
    {"term": "", "value": "", "assessment": "standard|favorable_employee|favorable_employer|unusual", "notes": ""}
  ],
  "compliance_check": [
    {"requirement": "", "status": "met|not_met|unclear", "reference": "", "detail": ""}
  ],
  "recommendations": [
    {"area": "", "suggestion": "", "priority": "high|medium|low"}
  ],
  "warnings": [{"level": "critical|warning|info", "message": ""}]
}

Với CV: đánh giá timeline, kỹ năng, career trajectory. KHÔNG bịa đánh giá.
Với HĐLĐ: kiểm tra sự tuân thủ Bộ luật Lao động hiện hành về các nội dung: thời gian thử việc, giờ làm việc tiêu chuẩn, chế độ nghỉ phép năm, điều kiện chấm dứt hợp đồng, nghĩa vụ BHXH/BHYT/BHTN — trích dẫn tên điều khoản theo văn bản hiện hành có hiệu lực mà bạn biết; nếu không chắc số điều còn đúng, ghi '(cần kiểm tra hiệu lực)'.
Viết bằng CÙNG NGÔN NGỮ với tài liệu."""

GENERAL_PROMPT = """Bạn là chuyên gia phân tích tài liệu. Phân tích và trả về JSON:

{
  "summary": "<tóm tắt 2-3 câu>",
  "document_info": {
    "title": "", "type": "", "date": "", "author": "", "recipient": ""
  },
  "key_information": [
    {"item": "", "detail": "", "location": ""}
  ],
  "structure_analysis": {
    "sections": [], "page_count_estimate": 0, "completeness": "complete|partial|draft", "missing_elements": []
  },
  "action_items": [
    {"action": "", "responsible": "", "deadline": "", "status": ""}
  ],
  "important_dates": [
    {"date": "", "event": ""}
  ],
  "spelling_errors": [
    {"original": "", "suggestion": "", "location": ""}
  ],
  "warnings": [{"level": "critical|warning|info", "message": ""}]
}

Quy tắc:
- Trích xuất TẤT CẢ thông tin quan trọng
- Xác định action items và deadlines
- Đánh giá độ hoàn chỉnh
- Kiểm tra lỗi chính tả, lỗi ngữ pháp — liệt kê vào spelling_errors (để trống nếu không có)
- Viết bằng CÙNG NGÔN NGỮ với tài liệu
- Chỉ báo cáo nội dung CÓ trong tài liệu"""

COMPARISON_WRAPPER = """Bạn đang SO SÁNH HAI tài liệu (Document A và Document B).

Ngoài phân tích tiêu chuẩn cho Document A, thêm section "comparison":

"comparison": {
  "relationship": "versions|counterparts|related|unrelated",
  "summary": "<tóm tắt 1-2 câu>",
  "is_identical": false,
  "differences": [
    {"aspect": "", "document_a": "", "document_b": "", "significance": "major|minor|cosmetic", "recommendation": ""}
  ],
  "missing_clauses": ["<điều khoản có trong A nhưng thiếu trong B>"],
  "conflict_terms": ["<điều khoản/thuật ngữ mâu thuẫn giữa A và B — mô tả rõ xung đột>"],
  "additions_in_b": [],
  "removals_in_b": [],
  "unchanged": []
}

Quy tắc so sánh:
- Nếu hai tài liệu HOÀN TOÀN GIỐNG NHAU: đặt is_identical=true, differences=[], missing_clauses=[], conflict_terms=[]
- conflict_terms: chỉ liệt kê khi có MÂU THUẪN THỰC SỰ (cùng điều khoản nhưng nội dung trái ngược), không phải chỉ khác nhau
- missing_clauses: điều khoản/section có trong A hoàn toàn vắng mặt trong B
- So sánh: cấu trúc, nội dung, số liệu, điều khoản, rủi ro thêm/bớt.

"""

DOMAIN_PROMPTS = {
    "legal": LEGAL_PROMPT,
    "finance": FINANCE_PROMPT,
    "hr": HR_PROMPT,
    "general": GENERAL_PROMPT,
}
