export interface DocSection {
  id: string;
  title: string;
  content: string;
  collapsed: boolean;
}

const DEFAULT_SECTION_TITLES: { id: string; title: string }[] = [
  // English
  { id: "scope", title: "Scope of Services" },
  { id: "payment", title: "Payment Terms" },
  { id: "termination", title: "Termination" },
  { id: "liability", title: "Liability" },
  { id: "general", title: "General Provisions" },
  { id: "confidentiality", title: "Confidentiality" },
  { id: "ip", title: "Intellectual Property" },
  // Vietnamese
  { id: "scope-vi", title: "Phạm Vi" },
  { id: "dich-vu", title: "Dịch Vụ" },
  { id: "gia-tri", title: "Giá Trị" },
  { id: "thanh-toan", title: "Thanh Toán" },
  { id: "giao-hang", title: "Giao Hàng" },
  { id: "chuyen-giao", title: "Chuyển Giao" },
  { id: "nghia-vu", title: "Nghĩa Vụ" },
  { id: "quyen-loi", title: "Quyền Lợi" },
  { id: "bao-mat", title: "Bảo Mật" },
  { id: "cham-dut", title: "Chấm Dứt" },
  { id: "trach-nhiem", title: "Trách Nhiệm" },
  { id: "phat-vi-pham", title: "Phạt Vi Phạm" },
  { id: "bat-kha-khang", title: "Bất Khả Kháng" },
  { id: "giai-quyet-tranh-chap", title: "Giải Quyết Tranh Chấp" },
  { id: "dieu-khoan-chung", title: "Điều Khoản Chung" },
  { id: "hieu-luc", title: "Hiệu Lực" },
];

export function parseDocSections(
  content: string,
  sectionTitles: { id: string; title: string }[] = DEFAULT_SECTION_TITLES
): DocSection[] {
  const lines = content.split("\n");
  const sections: DocSection[] = [];
  let currentSection: DocSection | null = null;
  const introLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    // Header-like heuristics:
    //  - "N. TITLE" numbered (English)
    //  - "Điều N" / "Chương N" (Vietnamese legal/contract)
    //  - All-caps short line
    const isNumberedHeader = /^\d+\.\s+\S/.test(trimmed);
    const isVietnameseArticle =
      /^(Điều|ĐIỀU|Chương|CHƯƠNG|Phần|PHẦN)\s+\d+/.test(trimmed);
    const isAllCapsHeader =
      trimmed.length > 0 &&
      trimmed.length < 80 &&
      trimmed === trimmed.toUpperCase() &&
      /[A-ZĐÁÀẢÃẠĂẮẰẲẴẶÂẤẦẨẪẬÉÈẺẼẸÊẾỀỂỄỆÍÌỈĨỊÓÒỎÕỌÔỐỒỔỖỘƠỚỜỞỠỢÚÙỦŨỤƯỨỪỬỮỰÝỲỶỸỴ]/.test(
        trimmed
      );
    const isHeaderLike =
      isNumberedHeader || isVietnameseArticle || isAllCapsHeader;

    const upperLine = trimmed.toUpperCase();
    const match = isHeaderLike
      ? sectionTitles.find(
          (s) =>
            upperLine.includes(s.title.toUpperCase()) ||
            (isNumberedHeader && upperLine.includes(s.id.toUpperCase()))
        )
      : undefined;

    if (match) {
      if (currentSection) sections.push(currentSection);
      else if (introLines.length > 0) {
        sections.push({
          id: "intro",
          title: "Introduction",
          content: introLines.join("\n"),
          collapsed: false,
        });
        introLines.length = 0;
      }
      currentSection = {
        id: match.id,
        title: match.title,
        content: line,
        collapsed: false,
      };
    } else if (currentSection) {
      currentSection.content += "\n" + line;
    } else {
      introLines.push(line);
    }
  }

  if (currentSection) sections.push(currentSection);
  else if (introLines.length > 0) {
    sections.push({
      id: "intro",
      title: "Document Content",
      content: introLines.join("\n"),
      collapsed: false,
    });
  }

  if (sections.length === 0) {
    return [
      { id: "full", title: "Document Content", content, collapsed: false },
    ];
  }
  return sections;
}
