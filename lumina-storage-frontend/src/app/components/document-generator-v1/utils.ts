// @ts-nocheck
import type { WizardDocType, PlaceholderField, AiDiffSuggestion, HistoryItem } from './types';
import { SMART_SUGGESTION_DATA } from './constants';

export const generateDraftV1 = (type: WizardDocType, description: string): string => {
  const ctx = description ? 'Context: ' + description + '.' : '';
  const drafts: Record<WizardDocType, string> = {
    'Sales Contract': 'SALES CONTRACT\n\nPARTIES\nThis Sales Contract is entered into between {company_name} ("Seller") and {customer_name} ("Buyer"). ' + ctx + '\n\n1. PAYMENT TERMS\nPayment within 30 days of invoice.\n\n2. DELIVERY\nDelivery by {effective_date}.\n\nSigned: {legal_representative} | {company_name}\nAddress: {company_address}',
    'Purchase Contract': 'PURCHASE CONTRACT\n\nPARTIES\nThis Purchase Contract is made between {customer_name} ("Buyer") and {company_name} ("Supplier"). ' + ctx + '\n\n1. PRICE AND PAYMENT\nPayment net 30 days from invoice.\n\nAuthorized: {legal_representative} | {company_name}\nAddress: {company_address} | Date: {effective_date}',
    'NDA': 'NON-DISCLOSURE AGREEMENT\n\nPARTIES\nThis NDA is entered between {company_name} ("Disclosing Party") and {customer_name} ("Receiving Party"). ' + ctx + '\n\n1. TERM\nThis Agreement remains in effect for three (3) years from execution.\n\nSigned: {legal_representative} | {company_name}\nAddress: {company_address} | Date: {effective_date}',
    'Internal Memo': 'INTERNAL MEMORANDUM\nTo: {customer_name}\nFrom: {legal_representative}, {company_name}\n\n1. PURPOSE\n' + (ctx || 'This memo communicates an important operational update.') + '\n\nAction required by {effective_date}.\nIssued by: {legal_representative} | {company_name}',
    'Proposal': 'BUSINESS PROPOSAL\nPrepared for: {customer_name} | Prepared by: {company_name}\n\nEXECUTIVE SUMMARY\n' + (ctx || 'This proposal outlines our recommended approach.') + '\n\n1. PROPOSED SOLUTION\nPhase 1 - Discovery | Phase 2 - Execution | Phase 3 - Handover\n\nSubmitted by: {legal_representative} | {company_name}',
    'Report': 'PERFORMANCE REPORT\nPrepared for: {customer_name} | By: {company_name}\n\nEXECUTIVE SUMMARY\n' + (ctx || 'This report presents key performance indicators.') + '\n\n1. KEY FINDINGS\na) Revenue exceeded targets by 12%.\nb) NPS improved from 42 to 61.\n\nPrepared by: {legal_representative} | Period End: {effective_date}',
  };
  return drafts[type];
};

export const applyRevision = (current: string, instruction: string, version: number): string => {
  const lower = instruction.toLowerCase();
  if (lower.includes('shorten') || lower.includes('shorter') || lower.includes('condense') || lower.includes('rut') || lower.includes('ngan')) {
    return current.split('\n\n').slice(0, 5).join('\n\n') + '\n\n[Condensed per revision v' + version + ']';
  }
  if (lower.includes('formal') || lower.includes('professional') || lower.includes('chuyen')) {
    return current.replace(/we recommend/gi, 'it is hereby recommended').replace(/please/gi, 'kindly be advised');
  }
  return current + '\n\n[Revision v' + version + ': "' + instruction + '" - AI updated relevant sections.]';
};

export function applyPlaceholders(template: string, fields: PlaceholderField[]): string {
  let result = template;
  fields.forEach(f => {
    if (f.value) result = result.replace(new RegExp(`\\{${f.key}\\}`, 'g'), f.value);
  });
  return result;
}

export function generateAiDiffSuggestions(text: string, instruction: string): AiDiffSuggestion[] {
  const instrLow = instruction.toLowerCase();
  const result: AiDiffSuggestion[] = [];

  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 15 && l.length < 95);

  const tryAdd = (id: string, raw: string, replacement: string): boolean => {
    const s = raw.slice(0, 72);
    if (s.length < 12 || !text.includes(s)) return false;
    if (result.some(r => r.searchText === s)) return false;
    if (replacement.trim() === s.trim()) return false;
    result.push({ id, searchText: s, newText: replacement, status: 'pending' });
    return true;
  };

  const find = (kw: string) => lines.find(l => l.toLowerCase().includes(kw.toLowerCase()));

  if (instrLow.match(/thanh toán|payment|ngắn gọn/)) {
    const l = find('thanh toán') ?? find('payment') ?? find('trả');
    if (l) tryAdd('ai-pay', l, 'Thanh toán trong 30 ngày từ ngày nhận hóa đơn hợp lệ. Lãi phạt chậm: 0,05%/ngày.');
  }
  if (instrLow.match(/bảo mật|confiden|bí mật/)) {
    const l = find('bảo mật') ?? find('confiden') ?? find('thông tin');
    if (l) tryAdd('ai-sec', l, l.slice(0, 65) + ' Áp dụng chuẩn ISO 27001. Nghiêm cấm tiết lộ cho bên thứ ba.');
  }
  if (instrLow.match(/trang trọng|chuyên nghiệp|formal/)) {
    const l = lines.find(l => /^[A-Za-zÀ-ỹ]/.test(l) && !l.includes('{'));
    if (l) tryAdd('ai-formal', l, 'Theo quy định pháp luật hiện hành, ' + l.charAt(0).toLowerCase() + l.slice(1, 62));
  }
  if (instrLow.match(/điều khoản|pháp lý|rủi ro|legal/)) {
    const l = find('điều khoản') ?? find('clause') ?? find('quy định');
    if (l) tryAdd('ai-legal', l, l.slice(0, 65) + ' Căn cứ Bộ luật Dân sự 2015 và các quy định pháp luật liên quan.');
  }

  // Fallback: pick lines by position whenever fewer than 2 suggestions matched
  const candidates = lines.filter(l => /^[A-Za-zÀ-ỹ]/.test(l) && !l.includes('{'));
  const fbFns = [
    (s: string) => 'Các Bên thống nhất rằng: ' + s.charAt(0).toLowerCase() + s.slice(1),
    (s: string) => s.replace(/\.$/, '') + ', phù hợp quy định pháp luật hiện hành.',
    (s: string) => 'Theo điều khoản này, ' + s.charAt(0).toLowerCase() + s.slice(1),
  ];
  for (let i = 0; i < 3 && result.length < 3; i++) {
    const idx = Math.floor(candidates.length * [0.2, 0.55, 0.8][i]);
    const l = candidates[idx];
    if (l) tryAdd(`ai-fb-${i}`, l, fbFns[i](l.slice(0, 60)));
  }

  return result.slice(0, 3);
}

// Extract best-guess field values from a saved HistoryItem for sidebar auto-fill
export function extractPrefillFromDoc(doc: HistoryItem): Record<string, string> {
  // Start from type-level suggestion data so all known fields are covered
  const base: Record<string, string> = { ...(SMART_SUGGESTION_DATA[doc.type as WizardDocType] ?? {}) };
  // Override customer name from the document title (format: "Type — Customer Name")
  const nameFromTitle = doc.title.split('—')[1]?.trim();
  if (nameFromTitle) base.customer_name = nameFromTitle;
  // Use document's lastEdited date for date fields
  base.effective_date = doc.lastEdited;
  // Clear the auto-generated customer_code placeholder so it stays blank unless real
  if (!base.customer_code || base.customer_code.startsWith('KH-')) base.customer_code = '';
  return base;
}

export function getFakeContent(doc: HistoryItem): string {
  const base = generateDraftV1(doc.type, '');
  if (doc.status === 'Completed' || doc.currentStep === 3) {
    return applyPlaceholders(base, [
      { key: 'customer_name', label: 'Customer Name', value: doc.title.split('—')[1]?.trim() || 'Alpha Corp' },
      { key: 'company_address', label: 'Address', value: '12 Marina Blvd, Singapore 018989' },
      { key: 'legal_representative', label: 'Representative', value: 'James Tan' },
      { key: 'effective_date', label: 'Effective Date', value: doc.lastEdited },
    ]);
  }
  return base;
}
