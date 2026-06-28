import type {
  TemplateField,
  TemplateSection,
} from "@/app/api/endpoints/templates";

export interface FieldIssue {
  placeholder: string;
  severity: "error" | "warn";
  message: string;
}

/** Required when explicit flag is set; otherwise legacy rule applies. */
export function isFieldRequired(field: TemplateField): boolean {
  if (field.required != null) return field.required;
  return field.type !== "blank";
}

export function validateTemplateFields(
  fields: TemplateField[],
  values: Record<string, string>
): FieldIssue[] {
  const issues: FieldIssue[] = [];
  const valueByName = (name: string) => (values[name] ?? "").trim();

  // Rule 1: Required but empty.
  for (const f of fields) {
    const val = valueByName(f.placeholder);
    if (isFieldRequired(f) && !val) {
      issues.push({
        placeholder: f.placeholder,
        severity: "error",
        message: "Trường bắt buộc, chưa điền",
      });
    }
  }

  // Rule 1b: `select` value must be in the field's option list.
  for (const f of fields) {
    if (f.type !== "select") continue;
    const val = valueByName(f.placeholder);
    if (!val) continue; // empty handled by Rule 1
    const opts = f.options ?? [];
    if (opts.length > 0 && !opts.includes(val)) {
      issues.push({
        placeholder: f.placeholder,
        severity: "error",
        message: `Giá trị phải là một trong: ${opts.join(", ")}`,
      });
    }
  }

  // Rule 2: Date field with invalid format (YYYY-MM-DD only).
  for (const f of fields) {
    if (f.type !== "date") continue;
    const val = valueByName(f.placeholder);
    if (!val) continue;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(val)) {
      issues.push({
        placeholder: f.placeholder,
        severity: "error",
        message: "Định dạng ngày không hợp lệ (YYYY-MM-DD)",
      });
    }
  }

  // Rule 5: Contract validity — hieu_luc <= het_han.
  const hieuLuc = fields.find((f) =>
    /ngay_hieu_luc|hieu_luc_hop_dong/i.test(f.placeholder)
  );
  const hetHan = fields.find((f) =>
    /ngay_het_han|het_han_hop_dong/i.test(f.placeholder)
  );
  if (hieuLuc && hetHan) {
    const a = valueByName(hieuLuc.placeholder);
    const b = valueByName(hetHan.placeholder);
    if (a && b && a > b) {
      issues.push({
        placeholder: hetHan.placeholder,
        severity: "warn",
        message: "Ngày hết hạn sớm hơn ngày hiệu lực — hợp đồng có thể vô hiệu",
      });
    }
  }

  return issues;
}

export interface GroupedFields {
  sortedSections: TemplateSection[];
  buckets: Map<string, TemplateField[]>;
  /** Fields with no `section_key` or with one not present in `sections`. */
  orphan: TemplateField[];
}

/**
 * Multi-select toggle with a cap. If `id` is already selected, remove it.
 * Otherwise add it — but only when below `maxCount`. When at the cap, return
 * the list unchanged so callers don't need to branch on whether the click
 * was meaningful.
 */
export function togglePickedId(
  current: string[],
  id: string,
  maxCount: number
): string[] {
  if (current.includes(id)) {
    return current.filter((x) => x !== id);
  }
  if (current.length >= maxCount) return current;
  return [...current, id];
}

/** Parse a multi-line textarea into a deduped, trimmed list of option strings. */
export function parseOptionsText(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const v = raw.trim();
    if (!v || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

/** Render an options array back to a textarea-friendly string. */
export function formatOptionsText(
  options: string[] | null | undefined
): string {
  return (options ?? []).join("\n");
}

/**
 * Parse a sections textarea where each non-empty line is `key:label`.
 * `order` is assigned as the 1-based line index. Lines without `:` or with
 * an empty key are skipped. Duplicate keys keep the first occurrence.
 */
export function parseSectionsText(text: string): TemplateSection[] {
  const seen = new Set<string>();
  const out: TemplateSection[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const sep = line.indexOf(":");
    if (sep < 0) continue;
    const key = line.slice(0, sep).trim();
    const label = line.slice(sep + 1).trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({ key, label: label || key, order: out.length + 1 });
  }
  return out;
}

/** Render a section list back to a textarea-friendly string (`key:label`). */
export function formatSectionsText(sections: TemplateSection[]): string {
  return [...sections]
    .sort((a, b) => a.order - b.order)
    .map((s) => `${s.key}:${s.label}`)
    .join("\n");
}

/**
 * Group fields by `section_key`. Returns `null` when no sections are configured
 * — caller should render the flat list. Sections with zero fields stay in the
 * result; the caller decides whether to skip empty sections at render time.
 */
export function groupFieldsBySections(
  fields: TemplateField[],
  sections: TemplateSection[] | undefined
): GroupedFields | null {
  if (!sections || sections.length === 0) return null;
  const sortedSections = [...sections].sort((a, b) => a.order - b.order);
  const sectionKeys = new Set(sortedSections.map((s) => s.key));
  const buckets = new Map<string, TemplateField[]>();
  for (const s of sortedSections) buckets.set(s.key, []);
  const orphan: TemplateField[] = [];
  for (const f of fields) {
    const key = f.section_key;
    if (key && sectionKeys.has(key)) {
      buckets.get(key)!.push(f);
    } else {
      orphan.push(f);
    }
  }
  return { sortedSections, buckets, orphan };
}
