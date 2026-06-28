export interface NumberingItem { label: string; text: string }

const normWS = (s: string) =>
  s.replace(/\u00A0|\u202F|\u2009|\u2007|\u2008/gu, " ");

export const normForMatch = (s: string) =>
  normWS(s).replace(/\s+/g, " ").trim().toLowerCase();

export function injectNumberingIntoHtml(html: string, items: NumberingItem[]): string {
  try {
    const doc = new DOMParser().parseFromString(html, "text/html");

    if (!items.length) {
      doc.body.querySelectorAll("ol").forEach(ol =>
        ol.classList.add("docx-ol-fallback")
      );
      return doc.body.innerHTML;
    }

    const blocks = Array.from(
      doc.body.querySelectorAll("p, li, h1, h2, h3, h4, h5, h6")
    ).filter(
      el => !(el.tagName === "P" && el.parentElement?.tagName === "LI")
    );

    // Maximum number of items we can skip forward in the items list
    // when an HTML block doesn't match the current item position.
    // Keep this small to avoid matching a later item that shares the same text.
    const LOOKAHEAD = 3;
    const MATCH_LEN = 60;

    let mapIdx = 0;
    const injectedOls = new Set<Element>();
    // Track which DOM elements have already received a label to prevent double-injection
    const injectedEls = new WeakSet<Element>();

    for (const el of blocks) {
      if (mapIdx >= items.length) break;
      // Skip elements already labelled
      if (injectedEls.has(el)) continue;

      const elText = normForMatch(el.textContent ?? "");
      if (elText.length < 3) continue;

      // Forward scan: try to match the current block against the next LOOKAHEAD
      // items in sequential order. Always take the FIRST (lowest k) match so we
      // consume items in document order — prevents same-text blocks from both
      // matching the same later item.
      let found = -1;
      const scanEnd = Math.min(items.length, mapIdx + LOOKAHEAD);
      for (let k = mapIdx; k < scanEnd; k++) {
        const itText = normForMatch(items[k].text);
        const n = Math.min(MATCH_LEN, elText.length, itText.length);
        if (n >= 3 && elText.slice(0, n) === itText.slice(0, n)) {
          found = k;
          break; // take the earliest match — never skip over it
        }
      }
      if (found < 0) continue;

      const label = items[found].label;
      mapIdx = found + 1;
      if (!label) continue;

      // Skip if the element's visible text already starts with this label
      if (
        normForMatch(label) &&
        elText.startsWith(normForMatch(label))
      )
        continue;

      const injectTarget: Element =
        el.tagName === "LI" && el.querySelector(":scope > p")
          ? (el.querySelector(":scope > p") as Element)
          : el;

      // Guard: don't double-inject into the same element
      if (injectedEls.has(injectTarget)) continue;
      injectedEls.add(injectTarget);
      injectedEls.add(el);

      const span = doc.createElement("span");
      span.className = "docx-auto-num";
      span.textContent = `${label} `;
      injectTarget.insertBefore(span, injectTarget.firstChild);

      const contentWrap = doc.createElement("span");
      contentWrap.className = "docx-num-content";
      while (injectTarget.childNodes.length > 1) {
        contentWrap.appendChild(injectTarget.childNodes[1]);
      }
      injectTarget.appendChild(contentWrap);
      (injectTarget as HTMLElement).style.display = "flex";
      (injectTarget as HTMLElement).style.alignItems = "baseline";
      (injectTarget as HTMLElement).style.gap = "0";

      if (el.tagName === "LI") {
        (el as HTMLElement).style.listStyle = "none";
        if (el.parentElement) injectedOls.add(el.parentElement);
      }
    }

    doc.body.querySelectorAll("ol").forEach(ol => {
      if (!injectedOls.has(ol)) ol.classList.add("docx-ol-fallback");
    });

    return doc.body.innerHTML;
  } catch {
    return html;
  }
}
