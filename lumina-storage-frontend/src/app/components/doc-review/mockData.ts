import type {
  AnalysisResult,
  DocHighlight,
  ReviewType,
} from "@/app/api/endpoints/review";

// Reviewed history — document đã review trước đó
export interface ReviewedHistoryRecord {
  id: string;
  title: string;
  docType: string;
  reviewType: string;
  date: string;
  status: "Completed" | "Issues Found" | "Clean";
  riskScore: number;
}

export const MOCK_REVIEWED_HISTORY: ReviewedHistoryRecord[] = [
  {
    id: "h1",
    title: "Contract_A.docx",
    docType: "Contract",
    reviewType: "Legal",
    date: "2026-04-20",
    status: "Issues Found",
    riskScore: 42,
  },
  {
    id: "h2",
    title: "NDA_Draft_v2.docx",
    docType: "NDA",
    reviewType: "Legal",
    date: "2026-04-19",
    status: "Clean",
    riskScore: 12,
  },
  {
    id: "h3",
    title: "Sales_Report_Q1.docx",
    docType: "Report",
    reviewType: "Financial",
    date: "2026-04-18",
    status: "Completed",
    riskScore: 28,
  },
  {
    id: "h4",
    title: "Vendor_Agreement.docx",
    docType: "Contract",
    reviewType: "Business",
    status: "Issues Found",
    date: "2026-04-15",
    riskScore: 55,
  },
  {
    id: "h5",
    title: "SOP_Internal_v2.docx",
    docType: "SOP",
    reviewType: "Business",
    date: "2026-04-14",
    status: "Clean",
    riskScore: 20,
  },
  {
    id: "h6",
    title: "Financial_Summary_2026.docx",
    docType: "Report",
    reviewType: "Financial",
    date: "2026-04-10",
    status: "Completed",
    riskScore: 35,
  },
];

// Mock review documents — tương đương MOCK_REVIEW_DOCUMENTS trong design
export interface MockReviewDoc {
  id: string;
  name: string;
  date: string;
  status: "Analyzed" | "Not analyzed";
  content: string;
}

export const MOCK_REVIEW_DOCS: MockReviewDoc[] = [
  {
    id: "rdoc-1",
    name: "Service_Agreement_ABC.docx",
    date: "2026-04-20",
    status: "Not analyzed",
    content: `SERVICE AGREEMENT

Between Lumina Technologies Pte. Ltd. ("Provider") and ABC Holdings Corp. ("Client"), dated April 2026.

1. SCOPE OF SERVICES
Provider shall deliver software consulting services as detailed in Schedule A.

2. PAYMENT TERMS
Client agrees to pay USD 12,000/month, payable net-30 days from invoice date.

3. TERMINATION
Either party may terminate with 30 days written notice.

4. LIABILITY
Provider's liability shall be capped at 3 months of fees.

5. CONFIDENTIALITY
Both parties agree to maintain strict confidentiality of proprietary information for a period of 5 years post-termination.

6. GENERAL PROVISIONS
This agreement is governed by applicable laws. Disputes shall be resolved through arbitration.`,
  },
  {
    id: "rdoc-2",
    name: "Q1_Sales_Report_2026.docx",
    date: "2026-04-18",
    status: "Analyzed",
    content: `Q1 2026 SALES PERFORMANCE REPORT

Prepared by Sales Analytics Team — April 2026.

EXECUTIVE SUMMARY
Total revenue: USD 4.2M (+17% vs Q4 2025). Pipeline for Q2: USD 9.1M.

1. REVENUE BREAKDOWN
APAC: 48%, EMEA: 32%, Americas: 20%.
Enterprise tier grew 24% QoQ; SMB flat.

2. PERFORMANCE METRICS
Win rate: 28% (up from 22% in Q4). Average deal size: USD 85K.

3. CHALLENGES
Pipeline slippage of 12% in EMEA due to procurement delays.
Competitive pressure in Americas mid-market.

4. Q2 OUTLOOK
Focus on enterprise expansion, new vertical (healthcare) entry.`,
  },
  {
    id: "rdoc-3",
    name: "SOP_Doc_Approval_v2.docx",
    date: "2026-04-15",
    status: "Not analyzed",
    content: `STANDARD OPERATING PROCEDURE
SOP-OPS-004 — Document Approval & Publishing Workflow — v2.1

Effective: April 2026.

1. PURPOSE
Establish standard workflow for document drafting, review, approval, compliance check, and publishing.

2. SCOPE
Applies to all policy, SOP, and external-facing documents.

3. WORKFLOW (5-STEP)
Step 1: Drafting — Author produces initial draft.
Step 2: Peer Review — 5-day SLA.
Step 3: Department Head Approval.
Step 4: Compliance Review — added Oct 2025.
Step 5: Publishing to internal portal.

4. RETENTION
All documents retained for minimum 5 years.

5. VERSION CONTROL
v2.0 – Added Compliance Review step (Oct 2025)
v2.1 – Updated retention policy (Apr 2026)`,
  },
];

export function generateMockAnalysis(
  docId: string,
  reviewType: ReviewType
): AnalysisResult {
  const baseHighlights: Record<string, Record<ReviewType, DocHighlight[]>> = {
    "rdoc-1": {
      Legal: [
        {
          keyword: "payment",
          severity: "pass",
          tooltip: "Payment terms are clearly defined with net-30 schedule.",
          severity_label: "low",
        },
        {
          keyword: "termination",
          severity: "warning",
          tooltip:
            "Termination clause exists but lacks detailed notice format.",
          severity_label: "medium",
        },
        {
          keyword: "liability",
          severity: "risk",
          tooltip: "Liability cap of 3 months may be insufficient.",
          severity_label: "high",
        },
        {
          keyword: "governing",
          severity: "risk",
          tooltip: "No specific governing law or jurisdiction specified.",
          severity_label: "high",
        },
      ],
      Business: [
        {
          keyword: "payment",
          severity: "pass",
          tooltip: "Payment terms clear.",
          severity_label: "low",
        },
        {
          keyword: "SLA",
          severity: "risk",
          tooltip: "No SLA or KPIs defined.",
          severity_label: "high",
        },
      ],
      Financial: [
        {
          keyword: "payment",
          severity: "pass",
          tooltip: "Clear payment schedule.",
          severity_label: "low",
        },
        {
          keyword: "liability",
          severity: "warning",
          tooltip: "Liability cap limited.",
          severity_label: "medium",
        },
      ],
      Admin: [
        {
          keyword: "termination",
          severity: "warning",
          tooltip: "No admin approval defined for early termination.",
          severity_label: "medium",
        },
      ],
      Compliance: [],
      Custom: [],
    },
    "rdoc-2": {
      Legal: [],
      Business: [
        {
          keyword: "pipeline",
          severity: "warning",
          tooltip: "Pipeline slippage not explained.",
          severity_label: "medium",
        },
      ],
      Financial: [
        {
          keyword: "margin",
          severity: "risk",
          tooltip: "No gross margin data.",
          severity_label: "high",
        },
      ],
      Admin: [],
      Compliance: [],
      Custom: [],
    },
    "rdoc-3": {
      Legal: [
        {
          keyword: "retention",
          severity: "warning",
          tooltip: "Retention policy may not align with regulations.",
          severity_label: "medium",
        },
      ],
      Business: [
        {
          keyword: "approval",
          severity: "warning",
          tooltip: "No escalation path for overdue reviews.",
          severity_label: "medium",
        },
      ],
      Financial: [],
      Admin: [
        {
          keyword: "approval",
          severity: "pass",
          tooltip: "Approval workflow clearly defined.",
          severity_label: "low",
        },
      ],
      Compliance: [],
      Custom: [],
    },
  };

  const highlights = baseHighlights[docId]?.[reviewType] ?? [];
  const riskCount = highlights.filter((h) => h.severity === "risk").length;
  const warnCount = highlights.filter((h) => h.severity === "warning").length;
  const riskScore = Math.min(
    100,
    Math.max(10, riskCount * 22 + warnCount * 10 + 15)
  );

  return {
    summary: `${reviewType} review completed. Document contains ${highlights.length} observations across clauses.`,
    riskExplanation:
      riskScore > 75
        ? "Multiple critical issues detected. Recommend legal counsel review before proceeding."
        : riskScore > 50
          ? "Several material risks identified. Address before finalization."
          : riskScore > 25
            ? "Minor concerns noted. Document is workable with small adjustments."
            : "Document is in good shape. Only routine observations.",
    keyIssues: highlights
      .filter((h) => h.severity === "risk")
      .map((h) => `${h.keyword}: ${h.tooltip}`),
    missingItems:
      reviewType === "Legal" && docId === "rdoc-1"
        ? ["Force majeure clause", "Intellectual property ownership"]
        : reviewType === "Financial" && docId === "rdoc-2"
          ? ["Gross margin breakdown", "Cost of sales detail"]
          : [],
    suggestions: [
      "Consider adding a dispute resolution escalation clause.",
      "Specify governing jurisdiction to avoid ambiguity.",
      "Align liability cap with industry standard (12 months typical).",
    ].slice(0, riskCount + 1),
    checklist: [],
    riskScore,
    highlights,
    fixes: highlights
      .filter((h) => h.severity === "risk")
      .map((_h, idx) => ({
        issueIndex: idx,
        suggestion: `Propose clause: "Shall be governed by the laws of Singapore. Any dispute shall be resolved by arbitration under SIAC rules."`,
      })),
  };
}
