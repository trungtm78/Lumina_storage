import { describe, expect, it } from "vitest";

import type {
  TemplateField,
  TemplateSection,
} from "@/app/api/endpoints/templates";
import {
  formatOptionsText,
  formatSectionsText,
  groupFieldsBySections,
  isFieldRequired,
  parseOptionsText,
  parseSectionsText,
  togglePickedId,
  validateTemplateFields,
} from "./templateForm";

function field(overrides: Partial<TemplateField> = {}): TemplateField {
  return {
    id: overrides.id ?? "f0",
    placeholder: overrides.placeholder ?? "x",
    label: overrides.label ?? "X",
    location: overrides.location ?? "",
    type: overrides.type ?? "blank",
    description: overrides.description,
    options: overrides.options,
    section_key: overrides.section_key,
    required: overrides.required,
  };
}

describe("isFieldRequired", () => {
  it("respects explicit required=true", () => {
    expect(isFieldRequired(field({ type: "blank", required: true }))).toBe(
      true
    );
  });

  it("respects explicit required=false even on non-blank legacy types", () => {
    expect(isFieldRequired(field({ type: "date", required: false }))).toBe(
      false
    );
  });

  it("falls back to legacy rule (non-blank → required)", () => {
    expect(isFieldRequired(field({ type: "blank" }))).toBe(false);
    expect(isFieldRequired(field({ type: "date" }))).toBe(true);
    expect(isFieldRequired(field({ type: "select" }))).toBe(true);
  });
});

describe("validateTemplateFields", () => {
  it("flags missing required fields", () => {
    const issues = validateTemplateFields(
      [field({ placeholder: "ten_kh", type: "blank", required: true })],
      {}
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      placeholder: "ten_kh",
      severity: "error",
    });
  });

  it("treats whitespace-only as missing", () => {
    const issues = validateTemplateFields(
      [field({ placeholder: "x", type: "blank", required: true })],
      { x: "   " }
    );
    expect(issues).toHaveLength(1);
  });

  it("does not flag optional blank fields when empty", () => {
    expect(validateTemplateFields([field({ type: "blank" })], {})).toHaveLength(
      0
    );
  });

  it("accepts a select value present in options", () => {
    expect(
      validateTemplateFields(
        [
          field({
            placeholder: "ptt",
            type: "select",
            options: ["Trả trước", "Trả sau"],
          }),
        ],
        { ptt: "Trả trước" }
      )
    ).toHaveLength(0);
  });

  it("rejects a select value not in options", () => {
    const issues = validateTemplateFields(
      [
        field({
          placeholder: "ptt",
          type: "select",
          options: ["Trả trước", "Trả sau"],
        }),
      ],
      { ptt: "Trả góp" }
    );
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain("Trả trước");
  });

  it("does not membership-check a select with no options configured", () => {
    expect(
      validateTemplateFields([field({ type: "select", options: [] })], {
        x: "anything",
      })
    ).toHaveLength(0);
  });

  it("flags invalid date format", () => {
    const issues = validateTemplateFields(
      [field({ placeholder: "ngay", type: "date" })],
      { ngay: "27/04/2026" }
    );
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain("YYYY-MM-DD");
  });

  it("warns when contract het_han is before hieu_luc", () => {
    const issues = validateTemplateFields(
      [
        field({ id: "f0", placeholder: "ngay_hieu_luc", type: "date" }),
        field({ id: "f1", placeholder: "ngay_het_han", type: "date" }),
      ],
      { ngay_hieu_luc: "2026-06-01", ngay_het_han: "2026-05-01" }
    );
    const warn = issues.find((i) => i.severity === "warn");
    expect(warn?.placeholder).toBe("ngay_het_han");
  });

  it("collects multiple independent issues", () => {
    const issues = validateTemplateFields(
      [
        field({ id: "f0", placeholder: "a", type: "blank", required: true }),
        field({
          id: "f1",
          placeholder: "b",
          type: "select",
          options: ["X", "Y"],
        }),
      ],
      { b: "Z" }
    );
    expect(issues).toHaveLength(2);
  });
});

describe("groupFieldsBySections", () => {
  const customer: TemplateSection = {
    key: "customer",
    label: "Thông tin Khách hàng",
    order: 1,
  };
  const contract: TemplateSection = {
    key: "contract",
    label: "Thông tin Hợp đồng",
    order: 2,
  };

  it("returns null when sections is empty/undefined", () => {
    expect(groupFieldsBySections([field()], undefined)).toBeNull();
    expect(groupFieldsBySections([field()], [])).toBeNull();
  });

  it("groups fields by section_key", () => {
    const result = groupFieldsBySections(
      [
        field({ id: "f0", placeholder: "ten_kh", section_key: "customer" }),
        field({ id: "f1", placeholder: "ptt", section_key: "contract" }),
      ],
      [customer, contract]
    );
    expect(result).not.toBeNull();
    expect(result!.buckets.get("customer")).toHaveLength(1);
    expect(result!.buckets.get("contract")).toHaveLength(1);
    expect(result!.orphan).toHaveLength(0);
  });

  it("sends fields with unknown section_key to orphan bucket", () => {
    const result = groupFieldsBySections(
      [
        field({ id: "f0", placeholder: "ten_kh", section_key: "customer" }),
        field({ id: "f1", placeholder: "old", section_key: "removed_section" }),
        field({ id: "f2", placeholder: "no_section" }),
      ],
      [customer]
    );
    expect(result!.buckets.get("customer")).toHaveLength(1);
    expect(result!.orphan).toHaveLength(2);
  });

  it("sorts sections by order ascending", () => {
    const result = groupFieldsBySections(
      [],
      [
        { key: "z", label: "Z", order: 99 },
        { key: "a", label: "A", order: 1 },
        { key: "m", label: "M", order: 50 },
      ]
    );
    expect(result!.sortedSections.map((s) => s.key)).toEqual(["a", "m", "z"]);
  });

  it("preserves field order within a section", () => {
    const result = groupFieldsBySections(
      [
        field({ id: "f0", placeholder: "first", section_key: "customer" }),
        field({ id: "f1", placeholder: "second", section_key: "customer" }),
        field({ id: "f2", placeholder: "third", section_key: "customer" }),
      ],
      [customer]
    );
    expect(result!.buckets.get("customer")!.map((f) => f.placeholder)).toEqual([
      "first",
      "second",
      "third",
    ]);
  });
});

describe("parseOptionsText", () => {
  it("splits on newlines and trims", () => {
    expect(parseOptionsText("  Trả trước \nTrả sau\n  Trả theo đợt")).toEqual([
      "Trả trước",
      "Trả sau",
      "Trả theo đợt",
    ]);
  });

  it("drops empty lines", () => {
    expect(parseOptionsText("A\n\nB\n   \nC")).toEqual(["A", "B", "C"]);
  });

  it("dedupes preserving the first occurrence", () => {
    expect(parseOptionsText("A\nB\nA\nC\nB")).toEqual(["A", "B", "C"]);
  });

  it("handles \\r\\n line endings", () => {
    expect(parseOptionsText("A\r\nB\r\nC")).toEqual(["A", "B", "C"]);
  });

  it("returns [] for empty input", () => {
    expect(parseOptionsText("")).toEqual([]);
    expect(parseOptionsText("   \n  ")).toEqual([]);
  });
});

describe("formatOptionsText", () => {
  it("joins options with newline", () => {
    expect(formatOptionsText(["A", "B", "C"])).toBe("A\nB\nC");
  });

  it("returns empty string for null/undefined/empty", () => {
    expect(formatOptionsText(null)).toBe("");
    expect(formatOptionsText(undefined)).toBe("");
    expect(formatOptionsText([])).toBe("");
  });

  it("round-trips with parseOptionsText", () => {
    const opts = ["Trả trước", "Trả sau", "Trả theo đợt"];
    expect(parseOptionsText(formatOptionsText(opts))).toEqual(opts);
  });
});

describe("parseSectionsText", () => {
  it("parses key:label lines and assigns sequential order", () => {
    expect(
      parseSectionsText(
        "customer:Thông tin Khách hàng\ncontract:Thông tin Hợp đồng"
      )
    ).toEqual([
      { key: "customer", label: "Thông tin Khách hàng", order: 1 },
      { key: "contract", label: "Thông tin Hợp đồng", order: 2 },
    ]);
  });

  it("uses key as label fallback when label is empty", () => {
    expect(parseSectionsText("plain:")).toEqual([
      { key: "plain", label: "plain", order: 1 },
    ]);
  });

  it("skips lines without a colon", () => {
    expect(parseSectionsText("noseparator\ngood:GoodLabel")).toEqual([
      { key: "good", label: "GoodLabel", order: 1 },
    ]);
  });

  it("dedupes by key (first wins)", () => {
    const parsed = parseSectionsText("a:First A\nb:B\na:Second A");
    expect(parsed.map((s) => s.key)).toEqual(["a", "b"]);
    expect(parsed[0].label).toBe("First A");
  });

  it("returns [] for empty/whitespace", () => {
    expect(parseSectionsText("")).toEqual([]);
    expect(parseSectionsText("   \n  \n")).toEqual([]);
  });
});

describe("formatSectionsText", () => {
  it("renders sorted by order with key:label format", () => {
    expect(
      formatSectionsText([
        { key: "b", label: "Beta", order: 2 },
        { key: "a", label: "Alpha", order: 1 },
      ])
    ).toBe("a:Alpha\nb:Beta");
  });

  it("round-trips with parseSectionsText", () => {
    const sections: TemplateSection[] = [
      { key: "customer", label: "KH", order: 1 },
      { key: "contract", label: "HĐ", order: 2 },
    ];
    expect(parseSectionsText(formatSectionsText(sections))).toEqual(sections);
  });
});

describe("togglePickedId", () => {
  it("adds an id when not present and under cap", () => {
    expect(togglePickedId([], "a", 3)).toEqual(["a"]);
    expect(togglePickedId(["a"], "b", 3)).toEqual(["a", "b"]);
  });

  it("removes an id when already present", () => {
    expect(togglePickedId(["a", "b", "c"], "b", 3)).toEqual(["a", "c"]);
  });

  it("returns the list unchanged when at cap and adding new id", () => {
    const list = ["a", "b", "c"];
    expect(togglePickedId(list, "d", 3)).toBe(list);
  });

  it("still allows removing when at cap", () => {
    expect(togglePickedId(["a", "b", "c"], "a", 3)).toEqual(["b", "c"]);
  });

  it("preserves insertion order when adding", () => {
    expect(togglePickedId(["a", "b"], "c", 5)).toEqual(["a", "b", "c"]);
  });
});
