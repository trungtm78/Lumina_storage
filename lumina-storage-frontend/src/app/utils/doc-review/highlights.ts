import type { DocHighlight } from "@/app/api/endpoints/review";

export interface AppliedEdit {
  suggested: string;
  riskLevel: string;
}

export function escapeHtml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function escapeAttr(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const SEVERITY_BASE: Record<DocHighlight["severity"], string> = {
  pass: "highlight-pass",
  warning: "highlight-warning",
  risk: "highlight-risk",
};

function resolveHighlightBase(h: DocHighlight): string {
  if (h.highlight_type === "compare") return "highlight-compare";
  if (h.highlight_type === "reference") return "highlight-reference";
  return SEVERITY_BASE[h.severity];
}

interface HRange {
  lineStart: number;
  lineEnd: number;
  kwStart: number;
  kwEnd: number;
  h: DocHighlight;
}

interface EditRange {
  start: number;
  end: number;
  escapedOrig: string;
  escapedSugg: string;
}

type MRange =
  | ({ type: "edit" } & EditRange)
  | ({ type: "hl" } & HRange);

/**
 * Build highlighted HTML from plain text.
 *
 * All markup ranges (highlight spans + del/ins edits) are resolved against
 * the raw escaped text BEFORE any HTML tags are inserted, then emitted in a
 * single forward pass.  This prevents the old Phase-3 bug where del/ins regex
 * failed because highlight <span> tags split the matched text.
 *
 * Priority: edits take full precedence — any highlight whose line range
 * overlaps an edit range is suppressed (the del/ins markup is already
 * visually prominent enough).
 */
export function buildHighlightedHTML(
  text: string,
  highlights: DocHighlight[],
  appliedFixes: Record<string, string>,
  appliedEdits?: Record<string, AppliedEdit>
): string {
  const escaped = escapeHtml(text);

  // Strip all leading list prefixes iteratively ("* 1. text" → "text")
  const stripListPfx = (s: string): string => {
    const re = /^\s*(?:[*+\-]\s+|(?:điều|khoản|mục|chương|điểm)\s+[\divxlcm]+(?:\.\d+)*[.\-):]?\s+|\d+(?:\.\d+)*[.\-):]\s+|[a-zA-Z][.)]\s+)/iu;
    let cur = s;
    for (let i = 0; i < 5; i++) {
      const next = cur.replace(re, "").trimStart();
      if (next === cur) break;
      cur = next;
    }
    return cur;
  };

  // ── 1. Collect edit ranges from raw escaped text ──────────────────────────
  const editRanges: EditRange[] = [];
  if (appliedEdits) {
    Object.entries(appliedEdits).forEach(([modifiedText, { suggested }]) => {
      const escapedOrig = escapeHtml(modifiedText);
      const escapedSugg = escapeHtml(suggested);
      if (!escapedOrig) return;
      const re = new RegExp(escapeRegex(escapedOrig), "gi");
      let m: RegExpExecArray | null;
      let found = false;
      while ((m = re.exec(escaped)) !== null) {
        editRanges.push({ start: m.index, end: m.index + m[0].length, escapedOrig, escapedSugg });
        found = true;
      }
      // Fallback: try without leading list prefix ("1. text" → "text")
      if (!found) {
        const stripped = stripListPfx(modifiedText);
        if (stripped && stripped !== modifiedText.trimStart()) {
          const escapedStripped = escapeHtml(stripped);
          const reS = new RegExp(escapeRegex(escapedStripped), "gi");
          while ((m = reS.exec(escaped)) !== null) {
            editRanges.push({ start: m.index, end: m.index + m[0].length, escapedOrig: escapedStripped, escapedSugg });
          }
        }
      }
    });
  }
  editRanges.sort((a, b) => a.start - b.start);
  // Deduplicate overlapping edit ranges (keep earliest)
  const mergedEdits: EditRange[] = [];
  let eCovered = -1;
  for (const r of editRanges) {
    if (r.start >= eCovered) { mergedEdits.push(r); eCovered = r.end; }
  }

  // ── 2. Collect highlight ranges, skipping lines that overlap edits ─────────
  const hRanges: HRange[] = [];
  highlights.forEach((h) => {
    if (appliedFixes[h.keyword]) return;
    const escapedKw = escapeRegex(escapeHtml(h.keyword));
    if (!escapedKw) return;
    const re = new RegExp(escapedKw, "gi");
    let m: RegExpExecArray | null;
    while ((m = re.exec(escaped)) !== null) {
      const kwStart = m.index;
      const kwEnd = kwStart + m[0].length;
      let lineStart = kwStart;
      while (lineStart > 0 && escaped[lineStart - 1] !== "\n") lineStart--;
      let lineEnd = kwEnd;
      while (lineEnd < escaped.length && escaped[lineEnd] !== "\n") lineEnd++;
      // Suppress this highlight if its line overlaps any edit range
      const overlapsEdit = mergedEdits.some(
        (e) => e.start < lineEnd && e.end > lineStart
      );
      if (!overlapsEdit) {
        hRanges.push({ lineStart, lineEnd, kwStart, kwEnd, h });
      }
    }
  });
  hRanges.sort((a, b) => a.lineStart - b.lineStart || a.lineEnd - b.lineEnd);
  const mergedH: HRange[] = [];
  let hCovered = -1;
  for (const r of hRanges) {
    if (r.lineStart >= hCovered) { mergedH.push(r); hCovered = r.lineEnd; }
  }

  // ── 3. Unified single-pass HTML build ─────────────────────────────────────
  const allRanges: MRange[] = [
    ...mergedEdits.map((r) => ({ type: "edit" as const, ...r })),
    ...mergedH.map((r) => ({ type: "hl" as const, ...r })),
  ];
  allRanges.sort((a, b) => {
    const aStart = a.type === "edit" ? a.start : a.lineStart;
    const bStart = b.type === "edit" ? b.start : b.lineStart;
    if (aStart !== bStart) return aStart - bStart;
    // Edits before highlights at the same position
    if (a.type === "edit" && b.type !== "edit") return -1;
    if (a.type !== "edit" && b.type === "edit") return 1;
    return 0;
  });

  let result = "";
  let pos = 0;

  for (const range of allRanges) {
    if (range.type === "edit") {
      if (range.start < pos) continue; // already covered
      result += escaped.slice(pos, range.start);
      result += `<del class="edit-del">${range.escapedOrig}</del>`;
      result += `<ins class="edit-ins">${range.escapedSugg}</ins>`;
      pos = range.end;
    } else {
      if (range.lineStart < pos) continue; // already covered
      result += escaped.slice(pos, range.lineStart);
      const base = resolveHighlightBase(range.h);
      const refAttr = range.h.ref_id
        ? ` data-ref-id="${escapeAttr(range.h.ref_id)}"`
        : "";
      const dataAttrs =
        `data-tooltip="${escapeAttr(range.h.tooltip)}" ` +
        `data-severity="${range.h.severity_label}" ` +
        `data-highlight-type="${range.h.highlight_type ?? "analysis"}"${refAttr}`;
      result += `<span class="${base}-line" ${dataAttrs}>`;
      result += escaped.slice(range.lineStart, range.kwStart);
      result += `<span class="${base}-kw">`;
      result += escaped.slice(range.kwStart, range.kwEnd);
      result += `</span>`;
      result += escaped.slice(range.kwEnd, range.lineEnd);
      result += `</span>`;
      pos = range.lineEnd;
    }
  }
  result += escaped.slice(pos);

  // ── 4. Applied fixes — keyword green badge ────────────────────────────────
  Object.keys(appliedFixes).forEach((keyword) => {
    result = result.replace(
      new RegExp(`(${escapeRegex(keyword)})`, "gi"),
      `<span class="applied-fix">$1 <span class="applied-fix-label">✓ đã áp dụng</span></span>`
    );
  });

  return result;
}
