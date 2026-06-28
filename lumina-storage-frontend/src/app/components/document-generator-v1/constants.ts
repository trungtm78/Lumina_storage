// @ts-nocheck
import {
  FileText,
  FileSignature, ShoppingCart, ShieldCheck, Presentation, BarChart2,
} from 'lucide-react';
import type {
  WizardDocType, DocTypeCard, PlaceholderField, BatchRow, HistoryItem, SavedTplCard,
  UploadedFileItem, DocStatus, DocFolder, KhoTriThucFile,
} from './types';

export const ROUTE_PATHS = { DOCUMENT_GENERATOR: '/generator', DOCUMENT_REVIEW: '/review' } as const;

// --- Inlined data (from design data) ---
export const DOC_TYPE_CARDS: DocTypeCard[] = [
  { type: 'Sales Contract', icon: FileSignature, subtitle: 'Client-facing sales agreement with payment terms', color: 'bg-blue-50', iconColor: 'text-blue-600' },
  { type: 'Purchase Contract', icon: ShoppingCart, subtitle: 'Vendor or supplier procurement agreement', color: 'bg-emerald-50', iconColor: 'text-emerald-600' },
  { type: 'NDA', icon: ShieldCheck, subtitle: 'Non-disclosure and confidentiality agreement', color: 'bg-violet-50', iconColor: 'text-violet-600' },
  { type: 'Internal Memo', icon: FileText, subtitle: 'Internal communication or policy announcement', color: 'bg-amber-50', iconColor: 'text-amber-600' },
  { type: 'Proposal', icon: Presentation, subtitle: 'Business or project proposal for stakeholders', color: 'bg-rose-50', iconColor: 'text-rose-600' },
  { type: 'Report', icon: BarChart2, subtitle: 'Analytical or performance report document', color: 'bg-cyan-50', iconColor: 'text-cyan-600' },
];

export const _SAMPLE_TEMPLATES: Record<WizardDocType, string> = {
  'Sales Contract': 'Standard Sales Agreement v2.1',
  'Purchase Contract': 'Vendor Purchase Agreement v1.4',
  'NDA': 'Mutual NDA Template v3.0',
  'Internal Memo': 'Internal Memo Standard Format',
  'Proposal': 'Business Proposal Template v2.0',
  'Report': 'Quarterly Report Template v1.5',
};

export const PLACEHOLDER_FIELDS: PlaceholderField[] = [
  { key: 'customer_name', label: 'Customer Name', value: '' },
  { key: 'company_name', label: 'Company Name', value: '' },
  { key: 'company_address', label: 'Company Address', value: '' },
  { key: 'legal_representative', label: 'Legal Representative', value: '' },
  { key: 'effective_date', label: 'Effective Date', value: '' },
];

export const FAKE_BATCH_ROWS: BatchRow[] = [
  { customer_name: 'Alpha Corp', company_address: '12 Marina Blvd', legal_representative: 'James Tan', effective_date: '2026-05-01' },
  { customer_name: 'Beta Solutions', company_address: '88 Robinson Road', legal_representative: 'Sarah Lim', effective_date: '2026-05-10' },
  { customer_name: 'Gamma Industries', company_address: '200 Orchard Rd', legal_representative: 'Wei Chen', effective_date: '2026-05-15' },
];

export const COLUMN_MAPPING: { column: string; placeholder: string }[] = [
  { column: 'Column A: Company', placeholder: '{customer_name}' },
  { column: 'Column B: Address', placeholder: '{company_address}' },
  { column: 'Column C: Representative', placeholder: '{legal_representative}' },
  { column: 'Column D: Start Date', placeholder: '{effective_date}' },
];

export const MOCK_HISTORY: HistoryItem[] = [
  { id: 'h1', title: 'Vendor Agreement - PT Maju Jaya', type: 'Purchase Contract', lastEdited: '2026-04-20', status: 'Completed', currentStep: 3, versions: [{ label: 'V1', createdAt: '2026-04-18' }, { label: 'Final', createdAt: '2026-04-20' }], activity: [{ id: 'a1', action: 'Created', timestamp: '2026-04-18 09:00' }, { id: 'a2', action: 'Draft generated', timestamp: '2026-04-18 09:05' }] },
  { id: 'h2', title: 'NDA with TechBridge Pte Ltd', type: 'NDA', lastEdited: '2026-04-18', status: 'In Progress', currentStep: 2, versions: [{ label: 'V1', createdAt: '2026-04-17' }], activity: [{ id: 'a1', action: 'Created', timestamp: '2026-04-17 14:00' }] },
  { id: 'h3', title: 'Q1 2026 Performance Summary', type: 'Report', lastEdited: '2026-04-15', status: 'Completed', currentStep: 3, versions: [{ label: 'V1', createdAt: '2026-04-14' }, { label: 'Final', createdAt: '2026-04-15' }], activity: [{ id: 'a1', action: 'Created', timestamp: '2026-04-14 10:00' }] },
  { id: 'h4', title: 'Partnership Proposal - Nexus Asia', type: 'Proposal', lastEdited: '2026-04-12', status: 'Draft', currentStep: 1, versions: [], activity: [{ id: 'a1', action: 'Created', timestamp: '2026-04-12 16:00' }] },
  { id: 'h5', title: 'Internal Policy Memo - HR Dept', type: 'Internal Memo', lastEdited: '2026-04-10', status: 'Draft', currentStep: 2, versions: [{ label: 'V1', createdAt: '2026-04-10' }], activity: [{ id: 'a1', action: 'Created', timestamp: '2026-04-10 13:00' }] },
];


// ─── Vietnamese labels ──────────────────────────────────────────────────────
export const DOC_TYPE_VN: Record<WizardDocType, { label: string; subtitle: string }> = {
  'Sales Contract':    { label: 'Hợp đồng bán hàng',     subtitle: 'Hợp đồng bán hàng với điều khoản thanh toán' },
  'Purchase Contract': { label: 'Hợp đồng mua hàng',     subtitle: 'Hợp đồng mua hàng với nhà cung cấp' },
  'NDA':               { label: 'NDA / Bảo mật thông tin', subtitle: 'Thỏa thuận bảo mật thông tin giữa các bên' },
  'Internal Memo':     { label: 'Công văn nội bộ',       subtitle: 'Thông báo, công văn truyền thông nội bộ' },
  'Proposal':          { label: 'Đề xuất hợp tác',       subtitle: 'Đề xuất hợp tác kinh doanh hoặc dự án' },
  'Report':            { label: 'Báo cáo',               subtitle: 'Báo cáo phân tích, hiệu suất hoặc tổng kết' },
};

export const DETECTED_PLACEHOLDERS = ['{company_name}', '{customer_name}', '{effective_date}', '{legal_representative}', '{company_address}'];

export const _AI_MAPPING_SUGGESTIONS = [
  'Bạn có muốn dùng dữ liệu từ báo giá gần đây không?',
  'AI phát hiện khách hàng Acme Corp trong CRM',
  'Đề xuất dùng dữ liệu từ hợp đồng trước',
];

export const _VN_REVISION_SUGGESTIONS = [
  'Rút gọn nội dung',
  'Chuyên nghiệp hơn',
  'Bổ sung điều khoản pháp lý',
  'Giảm rủi ro hợp đồng',
];

// ─── Saved Template Library cards (Chọn có sẵn) ─────────────────────────────
export const SAVED_TEMPLATE_CARDS: SavedTplCard[] = [
  { id: 't1', name: 'Hợp đồng mua bán hàng hóa', tag: 'Hợp đồng',  description: 'Mẫu chuẩn cho giao dịch mua bán hàng hóa B2B', type: 'Sales Contract',  folder: 'Hợp đồng', updatedAt: '20/05/2026' },
  { id: 't2', name: 'NDA đối tác',                tag: 'Bảo mật',  description: 'Thoả thuận bảo mật thông tin với đối tác',  type: 'NDA',            folder: 'Bảo mật',   updatedAt: '18/05/2026' },
  { id: 't3', name: 'Biên bản nghiệm thu',        tag: 'Nội bộ',   description: 'Biên bản nghiệm thu công việc / dự án',     type: 'Internal Memo',  folder: 'Nội bộ',    updatedAt: '15/05/2026' },
  { id: 't4', name: 'Báo giá tiêu chuẩn',         tag: 'Báo giá',  description: 'Mẫu báo giá có VAT và điều khoản thanh toán', type: 'Proposal',      folder: 'Báo giá',   updatedAt: '12/05/2026' },
  { id: 't5', name: 'Đề xuất hợp tác đại lý',     tag: 'Đề xuất',  description: 'Đề xuất hợp tác phân phối, đại lý vùng',     type: 'Proposal',      folder: 'Đề xuất',   updatedAt: '10/05/2026' },
  { id: 't6', name: 'Công văn nội bộ',            tag: 'Nội bộ',   description: 'Công văn truyền thông nội bộ tiêu chuẩn',    type: 'Internal Memo',  folder: 'Nội bộ',    updatedAt: '08/05/2026' },
];

// ─── Mock uploaded files (Lịch sử upload) ───────────────────────────────────
export const MOCK_UPLOADS: UploadedFileItem[] = [
  { id: 'u1', name: 'hop_dong_mua_ban_abc.docx',   uploadedAt: '20/05/2026 14:32', size: '180 KB', type: 'DOCX' },
  { id: 'u2', name: 'danh_sach_khach_hang.xlsx',   uploadedAt: '19/05/2026 09:11', size: '42 KB',  type: 'XLSX' },
  { id: 'u3', name: 'bao_gia_thang_4.pdf',         uploadedAt: '15/05/2026 16:48', size: '256 KB', type: 'PDF'  },
  { id: 'u4', name: 'nda_doi_tac_xyz.docx',        uploadedAt: '12/05/2026 10:22', size: '95 KB',  type: 'DOCX' },
];

// Always-present fields for every doc type
export const COMMON_FIELDS: PlaceholderField[] = [
  { key: 'customer_code', label: 'Mã khách hàng', value: '' },
  { key: 'customer_name', label: 'Tên khách hàng', value: '' },
];

export const FIELDS_BY_TYPE: Record<WizardDocType, PlaceholderField[]> = {
  'Sales Contract': [
    ...COMMON_FIELDS,
    { key: 'legal_representative', label: 'Người đại diện',         value: '' },
    { key: 'contract_value',       label: 'Giá trị hợp đồng',       value: '' },
    { key: 'payment_terms',        label: 'Điều khoản thanh toán',  value: '' },
    { key: 'warranty_terms',       label: 'Điều khoản bảo hành',    value: '' },
    { key: 'effective_date',       label: 'Ngày hiệu lực',          value: '' },
  ],
  'Purchase Contract': [
    ...COMMON_FIELDS,
    { key: 'vendor_name',          label: 'Nhà cung cấp',           value: '' },
    { key: 'purchase_value',       label: 'Giá trị mua hàng',       value: '' },
    { key: 'delivery_terms',       label: 'Điều khoản giao hàng',   value: '' },
    { key: 'payment_terms',        label: 'Điều khoản thanh toán',  value: '' },
    { key: 'delivery_date',        label: 'Ngày giao hàng dự kiến', value: '' },
  ],
  'NDA': [
    ...COMMON_FIELDS,
    { key: 'partner_name',         label: 'Tên đối tác',            value: '' },
    { key: 'scope',                label: 'Phạm vi bảo mật',        value: '' },
    { key: 'nda_duration',         label: 'Thời hạn bảo mật',       value: '' },
    { key: 'breach_terms',         label: 'Điều khoản vi phạm',     value: '' },
    { key: 'effective_date',       label: 'Ngày hiệu lực',          value: '' },
  ],
  'Internal Memo': [
    ...COMMON_FIELDS,
    { key: 'department',           label: 'Phòng ban nhận',         value: '' },
    { key: 'memo_subject',         label: 'Chủ đề công văn',        value: '' },
    { key: 'memo_content',         label: 'Nội dung chính',         value: '' },
    { key: 'approver',             label: 'Người phê duyệt',        value: '' },
    { key: 'effective_date',       label: 'Ngày ban hành',          value: '' },
  ],
  'Proposal': [
    ...COMMON_FIELDS,
    { key: 'partner_name',         label: 'Tên đối tác',            value: '' },
    { key: 'objective',            label: 'Mục tiêu hợp tác',       value: '' },
    { key: 'scope',                label: 'Phạm vi hợp tác',        value: '' },
    { key: 'benefits',             label: 'Lợi ích đề xuất',        value: '' },
    { key: 'timeline',             label: 'Thời gian triển khai',   value: '' },
  ],
  'Report': [
    ...COMMON_FIELDS,
    { key: 'report_period',        label: 'Kỳ báo cáo',             value: '' },
    { key: 'report_type',          label: 'Loại báo cáo',           value: '' },
    { key: 'key_metrics',          label: 'Chỉ số chính',           value: '' },
    { key: 'conclusion',           label: 'Kết luận',               value: '' },
    { key: 'owner',                label: 'Người phụ trách',        value: '' },
  ],
};

// Smart suggestion auto-fill mock per doc type
export const SMART_SUGGESTION_DATA: Record<WizardDocType, Record<string, string>> = {
  'Sales Contract':    { customer_code: 'KH-0123', customer_name: 'Công ty Acme Việt Nam', legal_representative: 'Nguyễn Văn A', contract_value: '1.250.000.000 VND', payment_terms: 'Net-30', warranty_terms: '12 tháng', effective_date: '2026-06-01' },
  'Purchase Contract': { customer_code: 'KH-0099', customer_name: 'Công ty Acme Việt Nam', vendor_name: 'Công ty TNHH Beta', purchase_value: '780.000.000 VND', delivery_terms: 'FOB Hải Phòng', payment_terms: 'Net-45', delivery_date: '2026-06-15' },
  'NDA':               { customer_code: 'KH-0123', customer_name: 'Công ty Acme Việt Nam', partner_name: 'XYZ Partners', scope: 'Toàn bộ dữ liệu kỹ thuật & thương mại', nda_duration: '24 tháng', breach_terms: 'Phạt 500 triệu VND/lần vi phạm', effective_date: '2026-06-01' },
  'Internal Memo':     { customer_code: 'NB-001', customer_name: 'Nội bộ công ty', department: 'Phòng Kinh doanh', memo_subject: 'Thông báo quy trình mới', memo_content: 'Áp dụng quy trình duyệt báo giá mới từ 01/06', approver: 'Giám đốc điều hành', effective_date: '2026-06-01' },
  'Proposal':          { customer_code: 'KH-0123', customer_name: 'Công ty Acme', partner_name: 'Acme Holdings', objective: 'Mở rộng phân phối khu vực miền Bắc', scope: 'Phân phối, marketing, hỗ trợ kỹ thuật', benefits: 'Chia sẻ doanh thu 15%, hỗ trợ training', timeline: '6 tháng (Q3–Q4 2026)' },
  'Report':            { customer_code: 'INT-001', customer_name: 'Ban Giám đốc', report_period: 'Q2 / 2026', report_type: 'Báo cáo doanh thu', key_metrics: 'Doanh thu +12%, NPS 61', conclusion: 'Đạt kế hoạch, đề xuất duy trì chiến lược', owner: 'Phòng tài chính' },
};

// Template id → prefill mapping (customer_code & customer_name stay blank)
export const TEMPLATE_PREFILL: Record<string, { type: WizardDocType; data: Record<string, string> }> = {
  t1: { type: 'Sales Contract', data: { legal_representative: 'Nguyễn Văn A', contract_value: '1.250.000.000 VND', payment_terms: 'Net-30', warranty_terms: '12 tháng', effective_date: '2026-06-01' } },
  t2: { type: 'NDA',            data: { partner_name: 'XYZ Partners', scope: 'Dữ liệu kỹ thuật & thương mại', nda_duration: '24 tháng', breach_terms: 'Phạt 500 triệu VND/lần vi phạm', effective_date: '2026-06-01' } },
  t3: { type: 'Internal Memo',  data: { department: 'Phòng Dự án', memo_subject: 'Biên bản nghiệm thu công việc', memo_content: 'Nghiệm thu hạng mục dự án theo hợp đồng', approver: 'Giám đốc dự án', effective_date: '2026-06-01' } },
  t4: { type: 'Proposal',       data: { partner_name: 'Acme Holdings', objective: 'Báo giá tiêu chuẩn có VAT', scope: 'Cung cấp giải pháp & dịch vụ', benefits: 'Hỗ trợ kỹ thuật 12 tháng', timeline: '3 tháng triển khai' } },
  t5: { type: 'Proposal',       data: { partner_name: 'Đại lý miền Bắc', objective: 'Mở rộng phân phối khu vực miền Bắc', scope: 'Phân phối, marketing, hỗ trợ kỹ thuật', benefits: 'Chia sẻ doanh thu 15%, training', timeline: '6 tháng (Q3–Q4 2026)' } },
  t6: { type: 'Internal Memo',  data: { department: 'Toàn công ty', memo_subject: 'Thông báo nội bộ', memo_content: 'Áp dụng quy trình mới từ tháng 6', approver: 'Ban Giám đốc', effective_date: '2026-06-01' } },
};

export const STATUS_STYLES: Record<DocStatus, string> = {
  'Draft':           'bg-amber-50 text-amber-700 border-amber-200',
  'In Progress':     'bg-blue-50 text-blue-700 border-blue-200',
  'Completed':       'bg-emerald-50 text-emerald-700 border-emerald-200',
  'Batch Generated': 'bg-violet-50 text-violet-700 border-violet-200',
};

export const _REVISION_SUGGESTIONS = [
  'Shorten the document',
  'Make tone more formal',
  'Rewrite payment terms',
];

export const SMART_SUGGESTION_PROMPT: Record<WizardDocType, string> = {
  'Sales Contract':    'Bạn có muốn lấy thông tin từ báo giá #BG-2026-0123 vừa tạo sáng nay không?',
  'Purchase Contract': 'Bạn có muốn lấy thông tin từ đơn hàng NCC-045 hôm qua không?',
  'NDA':               'AI phát hiện đối tác XYZ Partners đã ký NDA trước đó. Dùng lại thông tin?',
  'Internal Memo':     'Bạn có muốn dùng mẫu công văn nội bộ gần nhất không?',
  'Proposal':          'Bạn có muốn lấy dữ liệu từ báo giá BG-2026-0123 không?',
  'Report':            'Bạn có muốn lấy dữ liệu từ báo cáo doanh thu Q2 không?',
};

export const _MOCK_COMMENTS_SEED = [
  { id: 'c1', author: 'Nguyễn Thu Hà', avatar: 'TH', time: '10:24 hôm nay', content: 'Cần kiểm tra lại điều khoản thanh toán cho rõ.' },
  { id: 'c2', author: 'Trần Minh',     avatar: 'TM', time: '09:48 hôm nay', content: 'OK phần ngày hiệu lực, đề xuất chốt sớm.' },
];


// ─── Kho Tri Thuc fake data (file picker modal) ────────────────────────────────
export const FAKE_KHO_TRI_THUC_FILES: KhoTriThucFile[] = [
  { id: 'k1', name: 'Hợp đồng mua bán hàng hóa 2026.docx', size: '180 KB', type: 'DOCX', uploadedAt: '2026-04-18', tabs: ['recent', 'mine'] },
  { id: 'k2', name: 'NDA_doi_tac_XYZ.pdf',                  size: '95 KB',  type: 'PDF',  uploadedAt: '2026-04-19', tabs: ['recent', 'mine'] },
  { id: 'k3', name: 'Mau_bao_gia_Q2_2026.docx',             size: '120 KB', type: 'DOCX', uploadedAt: '2026-04-20', tabs: ['recent', 'shared'] },
  { id: 'k4', name: 'Hop_dong_dich_vu_CNTT.docx',           size: '210 KB', type: 'DOCX', uploadedAt: '2026-02-28', tabs: ['mine'] },
  { id: 'k5', name: 'Bien_ban_nghiem_thu.pdf',               size: '65 KB',  type: 'PDF',  uploadedAt: '2026-04-22', tabs: ['recent', 'shared'] },
];

export const KHO_TRI_THUC_PARAMS = [
  { key: 'ben_mua',               label: 'Bên mua' },
  { key: 'dai_dien_ben_mua',      label: 'Đại diện bên mua' },
  { key: 'chuc_vu_ben_mua',       label: 'Chức vụ bên mua' },
  { key: 'dia_chi_ben_mua',       label: 'Địa chỉ bên mua' },
  { key: 'dien_thoai_ben_mua',    label: 'Điện thoại bên mua' },
  { key: 'mst_ben_mua',           label: 'Mã số thuế bên mua' },
  { key: 'hop_dong_so',           label: 'Số hợp đồng' },
  { key: 'ngay_ky',               label: 'Ngày ký' },
  { key: 'gia_tri_hop_dong',      label: 'Giá trị hợp đồng' },
  { key: 'dieu_khoan_thanh_toan', label: 'Điều khoản thanh toán' },
  { key: 'thoi_han_hop_dong',     label: 'Thời hạn hợp đồng' },
];

export const FAKE_KHO_TRI_THUC_TEMPLATE = `HỢP ĐỒNG MUA BÁN

Số hợp đồng: {hop_dong_so}
Ngày ký: {ngay_ky}

BÊN MUA:
  Tên công ty: {ben_mua}
  Đại diện: {dai_dien_ben_mua}
  Chức vụ: {chuc_vu_ben_mua}
  Địa chỉ: {dia_chi_ben_mua}
  Điện thoại: {dien_thoai_ben_mua}
  Mã số thuế: {mst_ben_mua}

GIÁ TRỊ HỢP ĐỒNG:
  {gia_tri_hop_dong}

ĐIỀU KHOẢN THANH TOÁN:
  {dieu_khoan_thanh_toan}

THỜI HẠN HỢP ĐỒNG:
  {thoi_han_hop_dong}

Hợp đồng được lập thành 02 bản có giá trị pháp lý như nhau.`;

// Fake template content used in the template editor preview
export const FAKE_TEMPLATE_CONTENT = `HỢP ĐỒNG DỊCH VỤ

Số hợp đồng: HD-2026-{contract_number}

Giữa:
  BÊN A (Bên cung cấp dịch vụ):
    Công ty: {company_name}
    Địa chỉ: {company_address}
    Mã số thuế: {tax_code}
    Đại diện: {legal_representative}

  BÊN B (Bên sử dụng dịch vụ):
    Tên khách hàng: {customer_name}
    Giá trị hợp đồng: {contract_value}
    Ngày hiệu lực: {effective_date}
    Thời hạn hợp đồng: {contract_duration}

ĐIỀU KHOẢN THANH TOÁN:
  {payment_terms}

ĐIỀU KHOẢN THƯƠNG MẠI:
  {commercial_terms}

Hợp đồng này có hiệu lực kể từ ngày {effective_date} và được ký bởi đại diện
hợp pháp của cả hai bên.`;

export const FAKE_DETECTED_PARAMS = [
  { key: 'contract_number',  label: 'Số hợp đồng' },
  { key: 'company_name',     label: 'Tên công ty' },
  { key: 'company_address',  label: 'Địa chỉ công ty' },
  { key: 'tax_code',         label: 'Mã số thuế' },
  { key: 'legal_representative', label: 'Đại diện pháp lý' },
  { key: 'customer_name',    label: 'Tên khách hàng' },
  { key: 'contract_value',   label: 'Giá trị hợp đồng' },
  { key: 'effective_date',   label: 'Ngày hiệu lực' },
  { key: 'contract_duration',label: 'Thời hạn hợp đồng' },
  { key: 'payment_terms',    label: 'Điều khoản thanh toán' },
  { key: 'commercial_terms', label: 'Điều khoản thương mại' },
];

export const DEFAULT_FOLDERS: DocFolder[] = [
  { id: 'f-hopdong', name: 'Hợp đồng' },
  { id: 'f-baogia',  name: 'Báo giá' },
  { id: 'f-noibo',   name: 'Nội bộ' },
  { id: 'f-dexuat',  name: 'Đề xuất' },
  { id: 'f-baocao',  name: 'Báo cáo' },
];

export const TYPE_TO_FOLDER: Record<WizardDocType, string> = {
  'Sales Contract':    'f-hopdong',
  'Purchase Contract': 'f-hopdong',
  'NDA':               'f-hopdong',
  'Internal Memo':     'f-noibo',
  'Proposal':          'f-dexuat',
  'Report':            'f-baocao',
};
