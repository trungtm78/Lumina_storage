import { useRef, useState, useCallback, useEffect, type MutableRefObject } from "react";
import { diff_match_patch } from "diff-match-patch";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import { axiosClient } from "@/app/api/client";
import { API_ENDPOINTS } from "@/app/api/endpoints";
import type { DocHighlight, ReviewType } from "@/app/api/endpoints/review";
import { buildHighlightedHTML, escapeHtml, type AppliedEdit } from "@/app/utils/doc-review/highlights";
import type { DocSection } from "@/app/utils/doc-review/sections";
import { injectNumberingIntoHtml, type NumberingItem } from "@/app/utils/doc-review/numbering";

type TooltipState = { text: string; type: string; severity: string; x: number; y: number } | null;

// ─── DOM injection utilities ──────────────────────────────────────────────────

const BLOCK_TAGS = new Set([
  "P", "DIV", "LI", "TD", "TH", "BLOCKQUOTE",
  "H1", "H2", "H3", "H4", "H5", "H6", "TR", "TABLE",
  "SECTION", "ARTICLE",
]);

function nearestBlockAncestor(node: Node): Element | null {
  let el: Element | null =
    node.nodeType === Node.TEXT_NODE
      ? (node as Text).parentElement
      : (node as Element);
  while (el) {
    if (BLOCK_TAGS.has(el.tagName)) return el;
    el = el.parentElement;
  }
  return null;
}

function rangeIsSafeToExtract(range: Range): boolean {
  return (
    nearestBlockAncestor(range.startContainer) ===
    nearestBlockAncestor(range.endContainer)
  );
}

// ─── FIX 1: buildTextNodeMap normalizes whitespace BEFORE computing offsets ──
// Original bug: normWS() was called AFTER offset arithmetic, so positions in
// the normalized string didn't correspond to positions in `entries[i].offset`.
// Fix: store the normalized text length as the offset unit so every downstream
// consumer (locateKeyword, buildDomRange) works in the same coordinate space.

const normWS = (s: string) =>
  s.replace(/\u00A0|\u202F|\u2009|\u2007|\u2008/gu, " ");

function buildTextNodeMap(root: HTMLElement) {
  const entries: { node: Text; offset: number; normLen: number }[] = [];
  let pos = 0;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let n: Node | null;
  while ((n = walker.nextNode())) {
    const raw = (n.textContent ?? "");
    const norm = normWS(raw);
    entries.push({ node: n as Text, offset: pos, normLen: norm.length });
    pos += norm.length;  // ← offset is now in normalised-char units
  }
  const fullText = entries
    .map(e => normWS(e.node.textContent ?? ""))
    .join("");
  return { entries, fullText };
}

// ─── FIX 2: buildDomRange maps normalised positions back to raw DOM offsets ───
// Because offsets are now measured in normalized chars, we must convert back to
// raw character positions when calling range.setStart/setEnd.
function buildDomRange(
  entries: { node: Text; offset: number; normLen: number }[],
  startIdx: number,
  length: number,
): Range | null {
  const endIdx = startIdx + length;
  let sN: Text | null = null, sO = 0, eN: Text | null = null, eO = 0;

  for (const e of entries) {
    const nodeEnd = e.offset + e.normLen;

    if (!sN && startIdx < nodeEnd) {
      sN = e.node;
      // Convert normalised offset within this node back to raw offset.
      // We do a character-by-character walk to re-map through normWS substitutions.
      sO = rawOffsetForNorm(e.node.textContent ?? "", startIdx - e.offset);
    }
    if (sN && endIdx <= nodeEnd) {
      eN = e.node;
      eO = rawOffsetForNorm(e.node.textContent ?? "", endIdx - e.offset);
      break;
    }
  }

  if (!sN || !eN) return null;
  try {
    const r = document.createRange();
    r.setStart(sN, Math.max(0, Math.min(sO, (sN.textContent ?? "").length)));
    r.setEnd(eN, Math.max(0, Math.min(eO, (eN.textContent ?? "").length)));
    return r;
  } catch {
    return null;
  }
}

// Given a raw string and a target offset in its *normalised* form, return the
// corresponding raw-string offset.  NBSP→space is 1:1 so this is usually
// identity, but the explicit walk future-proofs against multi-char normalisations.
function rawOffsetForNorm(raw: string, normOffset: number): number {
  let n = 0;
  for (let i = 0; i < raw.length; i++) {
    if (n >= normOffset) return i;
    n++; // normWS replacements are all 1:1
  }
  return raw.length;
}

// ─── FIX 5: locateKeyword — safe fuzzy match with corrected range length ─────
// Original bug: after a fuzzy match the code attempted to verify by calling
// `.startsWith()` on `textAtMatch` using the *unnormalized* `kwNorm`, which
// could fail on NBSP differences and fall through to the shorter `kwShort.length`,
// producing a range that was too short and highlighting the wrong text.
//
// Fix:
//   • Normalize `textAtMatch` before comparison (consistent with kwNorm).
//   • Clamp useLen so it never exceeds the remaining text length.
//   • Guard the dmp call more carefully for bilingual docs that have CJK-length
//     characters (diff-match-patch's Match_MaxBits counts UTF-16 code units).

function getLevenshteinDistance(a: string, b: string): number {
  const tmp: number[][] = [];
  for (let i = 0; i <= a.length; i++) {
    tmp[i] = [i];
  }
  for (let j = 0; j <= b.length; j++) {
    tmp[0][j] = j;
  }
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      tmp[i][j] = Math.min(
        tmp[i - 1][j] + 1, // deletion
        tmp[i][j - 1] + 1, // insertion
        tmp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1) // substitution
      );
    }
  }
  return tmp[a.length][b.length];
}

function locateKeyword(
  entries: { node: Text; offset: number; normLen: number }[],
  fullText: string,
  keyword: string,
): Range | null {
  const normFull = fullText; // already normalized by buildTextNodeMap
  const normKw = normWS(keyword).toLowerCase();

  // 1. Exact match (fast path)
  const idx = normFull.toLowerCase().indexOf(normKw);
  if (idx !== -1) return buildDomRange(entries, idx, normKw.length);

  // 2. Fuzzy fallback
  const dmp = new diff_match_patch();
  dmp.Match_Threshold = 0.4;
  dmp.Match_Distance = 100_000;

  const maxBits = (dmp as unknown as { Match_MaxBits: number }).Match_MaxBits ?? 32;

  // Count UTF-16 code units (not JS string length) to stay within Bitap limit.
  let bitLen = 0;
  let kwShortEnd = 0;
  for (const ch of normKw) {
    const codeUnit = ch.codePointAt(0) ?? 0;
    bitLen += codeUnit > 0xffff ? 2 : 1;
    if (bitLen > maxBits) break;
    kwShortEnd++;
  }
  const kwShort = normKw.slice(0, kwShortEnd);
  if (kwShort.length < 3) return null;

  try {
    const dmpIdx = dmp.match_main(normFull, kwShort, 0);
    if (dmpIdx === -1) return null;

    // ─── FIX 5a: normalize textAtMatch before comparison ────────────────────
    const textAtMatch = normFull.slice(dmpIdx).toLowerCase();
    const isExactFuzzy = textAtMatch.startsWith(normKw);
    const useLen = isExactFuzzy
      ? normKw.length
      : Math.min(kwShort.length, normFull.length - dmpIdx); // ← clamp to remaining

    if (!isExactFuzzy) {
      const matchedTextSegment = textAtMatch.slice(0, kwShort.length);
      const levDist = getLevenshteinDistance(kwShort, matchedTextSegment);
      // If the matched text is more than 30% different, reject the match
      if (levDist > kwShort.length * 0.3) {
        return null;
      }
    }

    return buildDomRange(entries, dmpIdx, useLen);
  } catch {
    return null;
  }
}

// ─── FIX 6: cleanInjected — correct removal order ────────────────────────────
// Original bug: `querySelectorAll("[data-lumina-injected]")` matched BOTH <ins>
// and <del>/<span> elements. If an <ins> appeared before a <del> in the DOM,
// the generic unwrap loop would unwrap the <ins> (insert its children back)
// instead of removing it, leaving the suggested text in the document.
//
// Fix: remove <ins> elements first (in a dedicated pass), then unwrap the rest.
function cleanInjected(container: HTMLElement) {
  // Pass 1 — hard-remove injected block paragraphs
  container
    .querySelectorAll("p[data-lumina-injected='edit-p']")
    .forEach(el => el.remove());

  // Pass 1.1 — hard-remove inline <ins> (contains replacement text, must disappear)
  container
    .querySelectorAll("ins[data-lumina-injected]")
    .forEach(el => el.remove());

  // Pass 2 — unwrap <del> and highlight <span> (restore original text)
  container
    .querySelectorAll("[data-lumina-injected]")
    .forEach(el => {
      const p = el.parentNode;
      if (!p) return;
      while (el.firstChild) p.insertBefore(el.firstChild, el);
      p.removeChild(el);
    });
}

const HL_BG: Record<string, string> = {
  reference: "rgba(59,130,246,0.18)",
  compare:   "rgba(202,138,4,0.18)",
  high:      "rgba(239,68,68,0.18)",
  medium:    "rgba(245,158,11,0.15)",
  low:       "rgba(16,185,129,0.12)",
};

function splitAppendEdit(found: string, suggested: string): { isAppend: boolean; suffix: string } {
  const cleanFound = found.trim().replace(/\s+/g, " ");
  const cleanSuggested = suggested.trim().replace(/\r\n/g, "\n");
  if (!cleanFound || !cleanSuggested.includes("\n")) {
    return { isAppend: false, suffix: suggested };
  }
  const lines = cleanSuggested.split("\n");
  const firstLine = lines[0].trim().replace(/\s+/g, " ");
  if (firstLine === cleanFound || firstLine.startsWith(cleanFound)) {
    const suffix = lines.slice(1).join("\n").trim();
    if (suffix) {
      return { isAppend: true, suffix };
    }
  }
  return { isAppend: false, suffix: suggested };
}

function getNumericPrefix(text: string): string | null {
  const clean = text.trim().replace(/\s+/g, " ");
  // Match patterns like: "Điều 3.2", "Article 3.2", "3.2.1", "Khoản 3.2.2", "3.3"
  const match = clean.match(/^(?:Điều|Khoản|Mục|Chương|Điểm|Article|Clause|Section|Item)?[ \t]*([\d]+(?:\.[\d]+)+)/i);
  if (match) return match[1];
  
  const matchSingle = clean.match(/^(?:Điều|Khoản|Mục|Chương|Điểm|Article|Clause|Section|Item)?[ \t]*([\d]+)(?:\.|\b)/i);
  if (matchSingle) return matchSingle[1];
  
  return null;
}

function findBlockEndElement(
  startEl: Element,
  anchorPrefix: string | null,
  isVietnamese: (text: string) => boolean
): Element {
  let curr = startEl;
  while (curr.nextElementSibling) {
    const nextEl = curr.nextElementSibling;
    const tagName = nextEl.tagName.toUpperCase();
    if (tagName === "TABLE" || tagName === "HR") {
      break;
    }
    
    // Always walk past newly injected elements (green text/edits from previous steps)
    if (nextEl.hasAttribute("data-lumina-injected")) {
      curr = nextEl;
      continue;
    }
    
    const text = nextEl.textContent || "";
    if (!text.trim()) {
      curr = nextEl;
      continue;
    }

    const prefix = getNumericPrefix(text);
    if (anchorPrefix) {
      if (prefix === null) {
        curr = nextEl;
      } else if (prefix === anchorPrefix || prefix.startsWith(anchorPrefix + ".")) {
        curr = nextEl;
      } else {
        break;
      }
    } else {
      // If no anchor prefix (e.g. unnumbered definitions), walk past the next element
      // if the current element is Vietnamese and the next element is its parallel English translation.
      const currText = curr.textContent || "";
      if (isVietnamese(currText) && !isVietnamese(text) && prefix === null) {
        curr = nextEl;
      } else {
        break;
      }
    }
  }
  return curr;
}

function applyDomHighlights(
  container: HTMLElement,
  highlights: DocHighlight[],
  appliedFixes: Record<string, string>,
  appliedEdits: Record<string, AppliedEdit> | undefined,
) {
  cleanInjected(container);

  // 1. Applied edits (higher priority)
  if (appliedEdits) {
    const isVietnamese = (text: string): boolean => {
      return /[đĐàáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹ]/i.test(text);
    };

    // Sort to process Vietnamese edits first, and English edits second.
    // This ensures that for bilingual documents, the new Vietnamese paragraph gets inserted
    // after the English original, and then the new English paragraph gets inserted after
    // the new Vietnamese paragraph, creating a perfect parallel VI -> EN -> VI -> EN structure.
    const sortedEdits = Object.entries(appliedEdits).sort(([textA], [textB]) => {
      const aIsVi = isVietnamese(textA);
      const bIsVi = isVietnamese(textB);
      if (aIsVi && !bIsVi) return -1;
      if (!aIsVi && bIsVi) return 1;
      return 0;
    });

    for (const [modifiedText, { suggested }] of sortedEdits) {
      if (!modifiedText.trim()) continue;
      const { entries, fullText } = buildTextNodeMap(container);
      const range = locateKeyword(entries, fullText, modifiedText);
      if (!range || !rangeIsSafeToExtract(range)) continue;

      const { isAppend, suffix } = splitAppendEdit(modifiedText, suggested);

      if (isAppend) {
        const blockEl = nearestBlockAncestor(range.endContainer);
        const rangeClone = range.cloneRange();

        const lines = suggested.split("\n");
        const firstLine = lines[0].trim();
        const cleanFound = modifiedText.trim();

        if (firstLine !== cleanFound) {
          const del = document.createElement("del");
          del.className = "edit-del";
          del.setAttribute("data-lumina-injected", "edit");
          del.style.cssText = "color:#ef4444;text-decoration:line-through;white-space:pre-wrap;";
          try {
            del.appendChild(range.extractContents());
            range.insertNode(del);
          } catch {
            // fallback
          }

          const ins = document.createElement("ins");
          ins.setAttribute("data-lumina-injected", "edit");
          ins.style.cssText = "color:#10b981;text-decoration:none;white-space:pre-wrap;";
          ins.textContent = " " + firstLine;
          del.after(ins);
        }

        if (blockEl) {
          const anchorPrefix = getNumericPrefix(blockEl.textContent || "");
          const endEl = findBlockEndElement(blockEl, anchorPrefix, isVietnamese);
          const suffixLines = suffix.split("\n").map(l => l.trim()).filter(Boolean);
          let prevEl = endEl;
          
          for (const line of suffixLines) {
            const pEl = document.createElement("p");
            pEl.setAttribute("data-lumina-injected", "edit-p");
            pEl.style.cssText = "color:#10b981;white-space:pre-wrap;margin-top:0.5em;margin-bottom:0.5em;";
            if (blockEl.className) {
              pEl.className = blockEl.className;
            }
            
            const ins = document.createElement("ins");
            ins.setAttribute("data-lumina-injected", "edit");
            ins.style.cssText = "color:#10b981;text-decoration:none;white-space:pre-wrap;";
            ins.textContent = line;
            
            pEl.appendChild(ins);
            prevEl.after(pEl);
            prevEl = pEl;
          }
        } else {
          // Fallback inline insertion
          const ins = document.createElement("ins");
          ins.setAttribute("data-lumina-injected", "edit");
          ins.style.cssText = "color:#10b981;text-decoration:none;white-space:pre-wrap;";
          ins.textContent = "\n" + suffix;
          try {
            rangeClone.collapse(false);
            rangeClone.insertNode(ins);
          } catch {
            continue;
          }
        }
      } else {
        // Normal edit: delete original and insert suggested
        const del = document.createElement("del");
        del.className = "edit-del";
        del.setAttribute("data-lumina-injected", "edit");
        del.style.cssText = "color:#ef4444;text-decoration:line-through;white-space:pre-wrap;";
        try {
          del.appendChild(range.extractContents());
          range.insertNode(del);
        } catch {
          continue;
        }

        const ins = document.createElement("ins");
        ins.setAttribute("data-lumina-injected", "edit");
        ins.style.cssText = "color:#10b981;text-decoration:none;white-space:pre-wrap;";
        ins.textContent = " " + suggested;
        del.after(ins);
      }
    }
  }

  // 2. AI highlights
  for (const h of highlights) {
    if (!h.keyword?.trim() || appliedFixes[h.keyword]) continue;
    const { entries, fullText } = buildTextNodeMap(container);
    const range = locateKeyword(entries, fullText, h.keyword);
    if (!range) continue;

    // Skip keywords already inside an applied-edit element
    const anchor = range.startContainer;
    const anchorEl =
      anchor.nodeType === Node.TEXT_NODE
        ? anchor.parentElement
        : (anchor as HTMLElement);
    if (anchorEl?.closest("[data-lumina-injected='edit']")) continue;

    if (!rangeIsSafeToExtract(range)) continue;

    const span = document.createElement("span");
    span.setAttribute("data-lumina-injected", "hl");
    span.setAttribute("data-tooltip", h.tooltip ?? "");
    span.setAttribute("data-severity", h.severity_label ?? "");
    span.setAttribute("data-highlight-type", h.highlight_type ?? "analysis");
    if (h.ref_id) span.setAttribute("data-ref-id", h.ref_id);

    const bgKey =
      h.highlight_type === "reference"
        ? "reference"
        : h.highlight_type === "compare"
        ? "compare"
        : (h.severity_label ?? "low");
    span.style.cssText = `background-color:${HL_BG[bgKey] ?? HL_BG.low};border-radius:2px;cursor:help;`;

    try {
      span.appendChild(range.extractContents());
      range.insertNode(span);
    } catch {
      /* skip on unexpected DOM error */
    }
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

export interface CenterDocViewerProps {
  docName: string | null;
  templateName?: string | null;
  documentId?: string | null;
  sections: DocSection[];
  templateSections: DocSection[];
  viewingTemplate: boolean;
  setViewingTemplate: (v: boolean) => void;
  compareActive: boolean;
  referenceActive?: boolean;
  highlights: DocHighlight[];
  appliedFixes: Record<string, string>;
  appliedEdits?: Record<string, AppliedEdit>;
  sectionRefs: MutableRefObject<Record<string, HTMLDivElement | null>>;
  hasResult?: boolean;
  reviewType?: ReviewType | null;
  onHighlightRefClick?: (refId: string) => void;
}

export function CenterDocViewer(props: CenterDocViewerProps) {
  const {
    docName, documentId, sections, templateSections, viewingTemplate,
    highlights, appliedFixes, appliedEdits, sectionRefs, onHighlightRefClick,
  } = props;

  const { t } = useTranslation();

  const isDocxDoc =
    !!docName &&
    /\.docx$/i.test(docName) &&
    !viewingTemplate &&
    !!documentId;

  const [mammothHtml, setMammothHtml] = useState<string | null>(null);
  const [mammothLoading, setMammothLoading] = useState(false);
  const [mammothError, setMammothError] = useState(false);

  const mammothContainerRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [tooltip, setTooltip] = useState<TooltipState>(null);

  // Fetch DOCX → mammoth HTML
  useEffect(() => {
    if (!isDocxDoc || !documentId) {
      setMammothHtml(null);
      setMammothLoading(false);
      return;
    }
    let cancelled = false;
    setMammothLoading(true);
    setMammothError(false);
    setMammothHtml(null);

    Promise.all([
      axiosClient
        .get(API_ENDPOINTS.documents.preview(documentId), { responseType: "blob" })
        .then(res => (res.data as Blob).arrayBuffer()),
      axiosClient
        .get(API_ENDPOINTS.review.documentNumbering(documentId))
        .then(res => (res.data?.items ?? []) as NumberingItem[])
        .catch(() => [] as NumberingItem[]),
    ])
      .then(([buf, numbering]) =>
        import("mammoth").then(({ default: mammoth }) =>
          mammoth
            .convertToHtml(
              { arrayBuffer: buf },
              {
                convertImage: mammoth.images.imgElement(img =>
                  img
                    .read("base64")
                    .then(data => ({ src: `data:${img.contentType};base64,${data}` }))
                ),
              }
            )
            .then(({ value }) => injectNumberingIntoHtml(value, numbering))
        )
      )
      .then(html => {
        if (!cancelled) {
          setMammothHtml(html);
          setMammothLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setMammothError(true);
          setMammothLoading(false);
        }
      });

    return () => { cancelled = true; };
  }, [isDocxDoc, documentId]);

  // ref callback for mammoth container
  const mammothRefCb = useCallback(
    (el: HTMLDivElement | null) => {
      mammothContainerRef.current = el;
      sections.forEach(s => { sectionRefs.current[s.id] = el; });
    },
    [sections, sectionRefs]
  );

  useEffect(() => {
    if (mammothContainerRef.current) {
      sections.forEach(s => {
        sectionRefs.current[s.id] = mammothContainerRef.current;
      });
    }
  }, [sections, sectionRefs]);

  // Inject highlights + applied edits into mammoth DOM
  useEffect(() => {
    const el = mammothContainerRef.current;
    if (!el || !mammothHtml) return;
    applyDomHighlights(el, highlights, appliedFixes, appliedEdits);
  }, [mammothHtml, highlights, appliedFixes, appliedEdits]);

  const getTooltipMeta = useCallback(
    (type: string, severity: string): { label: string; color: string } => {
      if (type === "reference")
        return { label: t("review.analysis.tooltipReference"), color: "#3b82f6" };
      if (type === "compare")
        return { label: t("review.analysis.tooltipCompare"), color: "#ca8a04" };
      if (severity === "high")
        return { label: t("review.analysis.tooltipRiskHigh"), color: "#ef4444" };
      if (severity === "medium")
        return { label: t("review.analysis.tooltipRiskMedium"), color: "#f59e0b" };
      if (severity === "low")
        return { label: t("review.analysis.tooltipRiskLow"), color: "#10b981" };
      return { label: t("review.analysis.tooltipAnalysis"), color: "#6b7280" };
    },
    [t]
  );

  const handleMouseOver = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const span = (e.target as HTMLElement).closest<HTMLElement>("[data-tooltip]");
    if (!span) { setTooltip(null); return; }
    const text = span.dataset.tooltip ?? "";
    if (!text) return;
    setTooltip({
      text,
      type: span.dataset.highlightType ?? "analysis",
      severity: span.dataset.severity ?? "",
      x: e.clientX,
      y: e.clientY,
    });
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    setTooltip(prev => (prev ? { ...prev, x: e.clientX, y: e.clientY } : null));
  }, []);

  const handleMouseLeave = useCallback(() => setTooltip(null), []);

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!onHighlightRefClick) return;
      const span = (e.target as HTMLElement).closest<HTMLElement>("[data-ref-id]");
      if (!span?.dataset.refId) return;
      onHighlightRefClick(span.dataset.refId);
    },
    [onHighlightRefClick]
  );

  if (!docName) return null;

  const activeSections = viewingTemplate ? templateSections : sections;

  return (
    <div className="border border-border rounded-xl bg-white shadow-sm overflow-hidden min-h-[600px]">
      {isDocxDoc ? (
        <div
          onMouseOver={handleMouseOver}
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
          onClick={handleClick}
        >
          {mammothLoading && (
            <div className="flex items-center justify-center py-20 gap-2 text-muted-foreground text-sm">
              <Loader2 className="w-4 h-4 animate-spin" />
              {t("review.viewer.loading", "Đang tải tài liệu...")}
            </div>
          )}
          {mammothError && (
            <div className="text-center py-20 text-sm text-muted-foreground">
              {t("review.viewer.error", "Không thể tải tài liệu.")}
            </div>
          )}
          {mammothHtml && (
            <div
              ref={mammothRefCb}
              className="docx-html-preview p-8"
              dangerouslySetInnerHTML={{ __html: mammothHtml }}
            />
          )}
        </div>
      ) : (
        <div
          ref={containerRef}
          className="p-8"
          onMouseOver={handleMouseOver}
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
          onClick={handleClick}
        >
          {activeSections.map(section => (
            <div
              key={section.id}
              ref={el => { sectionRefs.current[section.id] = el; }}
              className="scroll-mt-4"
            >
              <div
                className="text-foreground/85 text-sm leading-relaxed font-mono break-words whitespace-pre-wrap"
                dangerouslySetInnerHTML={{
                  __html: viewingTemplate
                    ? escapeHtml(section.content)
                    : buildHighlightedHTML(
                        section.content,
                        highlights,
                        appliedFixes,
                        appliedEdits
                      ),
                }}
              />
            </div>
          ))}
          {activeSections.length === 0 && (
            <div className="text-muted-foreground py-10 text-center text-sm">
              {t("review.analysis.noContent")}
            </div>
          )}
        </div>
      )}

      {/* Floating tooltip */}
      {tooltip &&
        (() => {
          const meta = getTooltipMeta(tooltip.type, tooltip.severity);
          const OFFSET = 14;
          const vw = window.innerWidth;
          const vh = window.innerHeight;
          const nearRight  = tooltip.x > vw / 2;
          const nearBottom = tooltip.y > vh * 0.55;
          const left      = nearRight  ? undefined                : tooltip.x + OFFSET;
          const right     = nearRight  ? vw - tooltip.x + OFFSET : undefined;
          const top       = nearBottom ? tooltip.y - 8            : tooltip.y - 12;
          const transform = nearBottom ? "translateY(-100%)"      : undefined;
          return (
            <div
              className="fixed z-[9999] pointer-events-none max-w-[360px]"
              style={{ left, right, top, transform }}
            >
              <div className="rounded-lg border border-border bg-popover shadow-lg px-3 py-2 text-[12px] leading-snug max-h-[45vh] overflow-y-auto">
                <div className="flex items-center gap-1.5 mb-1">
                  <span
                    className="w-2 h-2 rounded-full flex-shrink-0"
                    style={{ backgroundColor: meta.color }}
                  />
                  <span className="font-semibold text-foreground">{meta.label}</span>
                </div>
                <p className="text-muted-foreground leading-relaxed whitespace-pre-wrap break-words">
                  {tooltip.text}
                </p>
              </div>
            </div>
          );
        })()}
    </div>
  );
}