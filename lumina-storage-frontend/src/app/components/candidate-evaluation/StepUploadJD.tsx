import { useState, useCallback, useEffect, useRef, Fragment, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/app/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/app/components/ui/select";
import {
  Upload,
  FileText,
  Database,
  Loader2,
  X,
  Plus,
  Pencil,
  RotateCcw,
  Check,
  AlignLeft,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/app/components/ui/utils";
import { documentsApi } from "@/app/api/endpoints/documents";
import { candidateEvaluationApi } from "@/app/api/endpoints/candidateEvaluation";
import { DocumentPicker } from "./DocumentPicker";
import type {
  ParsedJD,
  HardSkillItem,
  SoftSkillItem,
} from "@/app/types/candidateEvaluation";

// ── Constants ─────────────────────────────────────────────────────────────────

// Note: WORK_MODE_OPTIONS, EMPLOYMENT_TYPE_OPTIONS, EDUCATION_LEVEL_OPTIONS, and
// JD_PARSE_MESSAGES are computed inside each component that needs them, using useTranslation.

const INPUT_CLS =
  "w-full text-base border border-gray-200 rounded-md px-3 py-1.5 bg-white focus:outline-none focus:border-gray-400 focus:ring-1 focus:ring-gray-200 transition-colors";

function normalizeLevel(raw: string): string {
  const v = (raw || "").toLowerCase().trim();
  if (!v || v === "chưa rõ" || v === "unknown" || v === "n/a") return "Chưa rõ";
  if (v.includes("không yêu cầu") || v === "any" || v === "none")
    return "Không yêu cầu";
  if (v.includes("tiến sĩ") || v.includes("phd") || v.includes("doctorate"))
    return "Tiến sĩ";
  if (v.includes("thạc sĩ") || v.includes("master")) return "Thạc sĩ";
  if (
    v.includes("đại học") ||
    v.includes("cử nhân") ||
    v.includes("bachelor") ||
    v.includes("university")
  )
    return "Đại học (Cử nhân)";
  if (
    v.includes("cao đẳng") ||
    v.includes("trung cấp") ||
    v.includes("college") ||
    v.includes("associate")
  )
    return "Trung cấp / Cao đẳng";
  return "Chưa rõ";
}

// ── Sub-components ────────────────────────────────────────────────────────────

function InlineTitleField({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) ref.current?.focus();
  }, [editing]);

  const commit = () => {
    setEditing(false);
    onChange(draft.trim() || "Chưa rõ");
  };

  if (editing) {
    return (
      <input
        ref={ref}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          }
          if (e.key === "Escape") setEditing(false);
        }}
        className="border-brand-500 w-full border-b-2 bg-transparent pb-0.5 text-xl font-semibold text-gray-900 focus:outline-none"
      />
    );
  }

  return (
    <div
      className="group flex cursor-text items-center gap-2"
      onClick={() => {
        setDraft(value);
        setEditing(true);
      }}
    >
      <h3 className="text-xl font-semibold text-gray-900">
        {value || "Chưa rõ"}
      </h3>
      <Pencil className="h-3.5 w-3.5 shrink-0 text-gray-400 opacity-0 transition-opacity group-hover:opacity-100" />
    </div>
  );
}

function InlineTextField({
  label,
  value,
  onChange,
  placeholder = "Chưa rõ",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) ref.current?.focus();
  }, [editing]);

  const start = () => {
    setDraft(value);
    setEditing(true);
  };
  const commit = () => {
    setEditing(false);
    onChange(draft.trim() || placeholder);
  };

  if (editing) {
    return (
      <div>
        <p className="mb-0.5 text-sm font-semibold text-gray-600">{label}</p>
        <input
          ref={ref}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            }
            if (e.key === "Escape") setEditing(false);
          }}
          className={INPUT_CLS}
        />
      </div>
    );
  }

  const isMissing = !value || value === "Chưa rõ";
  return (
    <div className="group cursor-text" onClick={start}>
      <p className="mb-0.5 text-sm font-semibold text-gray-600">{label}</p>
      <div className="-ml-2 flex items-center gap-1 rounded-md px-2 py-1 transition-colors hover:bg-gray-100">
        <span
          className={cn(
            "text-base",
            isMissing ? "text-gray-400 italic" : "text-gray-800"
          )}
        >
          {value || placeholder}
        </span>
        <Pencil className="h-3 w-3 shrink-0 text-gray-400 opacity-0 transition-opacity group-hover:opacity-100" />
      </div>
    </div>
  );
}

function InlineSelectField({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
}) {
  const matched = options.find(
    (o) => o.value.toLowerCase() === (value || "").toLowerCase()
  );
  const selectValue = matched?.value ?? options[0]?.value ?? "";

  return (
    <div>
      <p className="mb-0.5 text-sm font-semibold text-gray-600">{label}</p>
      <Select value={selectValue} onValueChange={onChange}>
        <SelectTrigger
          size="sm"
          className="border-gray-300 bg-white font-normal"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function ExperienceEditor({
  experience,
  onChange,
}: {
  experience: ParsedJD["experience_range"];
  onChange: (v: ParsedJD["experience_range"]) => void;
}) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [minY, setMinY] = useState(String(experience?.min_years ?? ""));
  const [maxY, setMaxY] = useState(String(experience?.max_years ?? ""));
  const [note, setNote] = useState(experience?.note ?? "");
  const [noReq, setNoReq] = useState(
    !experience?.min_years && !experience?.max_years
  );

  const display = () => {
    if (!experience) return "Chưa rõ";
    if (experience.note && experience.min_years == null) return experience.note;
    if (experience.min_years != null) {
      const max = experience.max_years;
      return `${experience.min_years}${max ? `–${max}` : "+"} năm`;
    }
    return "Chưa rõ";
  };

  const open = () => {
    setMinY(String(experience?.min_years ?? ""));
    setMaxY(String(experience?.max_years ?? ""));
    setNote(experience?.note ?? "");
    setNoReq(experience?.min_years == null && experience?.max_years == null);
    setEditing(true);
  };

  const commit = () => {
    setEditing(false);
    if (noReq) {
      onChange({
        min_years: null,
        max_years: null,
        preferred_years: null,
        note: "Không yêu cầu kinh nghiệm",
      });
    } else {
      onChange({
        min_years: minY ? Number(minY) : null,
        max_years: maxY ? Number(maxY) : null,
        preferred_years: null,
        note: note.trim(),
      });
    }
  };

  if (editing) {
    return (
      <div className="col-span-2 space-y-2.5 rounded-lg border border-gray-200 bg-white p-3 shadow-sm">
        <p className="text-sm font-semibold text-gray-500">
          {t("candidateEvaluation.jd.experience")}
        </p>
        <label className="flex cursor-pointer items-center gap-2 text-base text-gray-700 select-none">
          <input
            type="checkbox"
            checked={noReq}
            onChange={(e) => setNoReq(e.target.checked)}
            className="rounded"
          />
          {t("candidateEvaluation.jd.noExperience")}
        </label>
        {!noReq && (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="number"
                min="0"
                max="30"
                value={minY}
                onChange={(e) => setMinY(e.target.value)}
                placeholder={t("candidateEvaluation.jd.minYearsPlaceholder")}
                className="w-24 rounded-md border border-gray-200 px-2 py-1.5 text-base focus:border-gray-400 focus:ring-1 focus:ring-gray-200 focus:outline-none"
              />
              <span className="text-base text-gray-400">–</span>
              <input
                type="number"
                min="0"
                max="30"
                value={maxY}
                onChange={(e) => setMaxY(e.target.value)}
                placeholder={t("candidateEvaluation.jd.maxYearsPlaceholder")}
                className="w-24 rounded-md border border-gray-200 px-2 py-1.5 text-base focus:border-gray-400 focus:ring-1 focus:ring-gray-200 focus:outline-none"
              />
              <span className="text-base text-gray-500">{t("candidateEvaluation.jd.years")}</span>
            </div>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t("candidateEvaluation.jd.experienceNote")}
              className="w-full rounded-md border border-gray-200 px-2 py-1.5 text-sm text-gray-600 placeholder:text-gray-400 focus:border-gray-400 focus:outline-none"
            />
          </>
        )}
        <div className="flex gap-2 pt-1">
          <Button
            type="button"
            size="sm"
            onClick={commit}
            className="bg-brand-500 hover:bg-brand-600 text-white"
          >
            {t("candidateEvaluation.jd.confirmExperience")}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setEditing(false)}
          >
            {t("candidateEvaluation.jd.cancelReAnalyze")}
          </Button>
        </div>
      </div>
    );
  }

  const isMissing = display() === "Chưa rõ";
  return (
    <div className="group cursor-text" onClick={open}>
      <p className="mb-0.5 text-sm font-semibold text-gray-600">{t("candidateEvaluation.jd.experience")}</p>
      <div className="-ml-2 flex items-center gap-1 rounded-md px-2 py-1 transition-colors hover:bg-gray-100">
        <span
          className={cn(
            "text-base",
            isMissing ? "text-gray-400 italic" : "text-gray-800"
          )}
        >
          {display()}
        </span>
        <Pencil className="h-3 w-3 shrink-0 text-gray-400 opacity-0 transition-opacity group-hover:opacity-100" />
      </div>
    </div>
  );
}

function EducationEditor({
  education,
  onChange,
}: {
  education: ParsedJD["education"] | undefined;
  onChange: (v: ParsedJD["education"]) => void;
}) {
  const { t } = useTranslation();
  const educationLevelOptions = useMemo(
    () => [
      { value: "Chưa rõ", label: t("candidateEvaluation.jd.educationUnknown") },
      { value: "Không yêu cầu", label: t("candidateEvaluation.jd.educationNone") },
      { value: "Trung cấp / Cao đẳng", label: t("candidateEvaluation.jd.educationCollege") },
      { value: "Đại học (Cử nhân)", label: t("candidateEvaluation.jd.educationBachelor") },
      { value: "Thạc sĩ", label: t("candidateEvaluation.jd.educationMaster") },
      { value: "Tiến sĩ", label: t("candidateEvaluation.jd.educationPhD") },
    ],
    [t]
  );
  const raw = education ?? {
    min_level: "Chưa rõ",
    preferred_fields: [],
    note: "",
  };
  const edu = { ...raw, min_level: normalizeLevel(raw.min_level) };
  const [newField, setNewField] = useState("");

  const addField = () => {
    const v = newField.trim();
    if (v && !edu.preferred_fields.includes(v)) {
      onChange({ ...edu, preferred_fields: [...edu.preferred_fields, v] });
      setNewField("");
    }
  };

  const showFields =
    edu.min_level !== "Không yêu cầu" && edu.min_level !== "Chưa rõ";

  return (
    <div className="space-y-1.5">
      <p className="text-sm font-semibold text-gray-600">{t("candidateEvaluation.jd.education")}</p>
      <Select
        value={edu.min_level}
        onValueChange={(v) => onChange({ ...edu, min_level: v })}
      >
        <SelectTrigger
          size="sm"
          className="border-gray-300 bg-white font-normal"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {educationLevelOptions.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {showFields && (
        <div>
          <p className="mb-1 text-xs text-gray-400">{t("candidateEvaluation.jd.preferredSpecializations")}</p>
          <div className="flex flex-wrap items-center gap-1">
            {edu.preferred_fields.map((f, i) => (
              <span
                key={i}
                className="inline-flex items-center gap-0.5 rounded-full border border-gray-300 bg-white px-2 py-0.5 text-sm text-gray-900"
              >
                {f}
                <button
                  type="button"
                  onClick={() =>
                    onChange({
                      ...edu,
                      preferred_fields: edu.preferred_fields.filter(
                        (_, j) => j !== i
                      ),
                    })
                  }
                  className="ml-0.5 hover:opacity-70"
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              </span>
            ))}
            <div className="inline-flex items-center gap-0.5">
              <input
                value={newField}
                onChange={(e) => setNewField(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addField();
                  }
                }}
                placeholder={t("candidateEvaluation.jd.addSpecialization")}
                className="w-24 border-0 border-b border-dashed border-gray-300 bg-transparent py-0.5 text-sm text-gray-500 placeholder:text-gray-400 focus:border-gray-500 focus:outline-none"
              />
              {newField && (
                <button
                  type="button"
                  onClick={addField}
                  className="text-brand-500 hover:text-brand-600"
                >
                  <Plus className="h-3 w-3" />
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Soft skill tag list (simple, no groups) ───────────────────────────────────

function SoftSkillTagList({
  skills,
  onRemove,
  onAdd,
}: {
  skills: string[];
  onRemove: (idx: number) => void;
  onAdd: (skill: string) => void;
}) {
  const [draft, setDraft] = useState("");

  const handleAdd = () => {
    const v = draft.trim();
    if (v && !skills.includes(v)) {
      onAdd(v);
      setDraft("");
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {skills.map((s, i) => (
        <span
          key={i}
          className="inline-flex items-center gap-0.5 rounded-full border border-gray-300 bg-white px-2 py-0.5 text-sm text-gray-900"
        >
          {s}
          <button
            type="button"
            onClick={() => onRemove(i)}
            className="ml-0.5 hover:opacity-60"
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
      <div className="inline-flex items-center gap-0.5">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              handleAdd();
            }
          }}
          placeholder="+ Thêm"
          className="w-16 border-0 border-b border-dashed border-gray-300 bg-transparent py-0.5 text-sm text-gray-500 placeholder:text-gray-400 focus:border-gray-500 focus:outline-none"
        />
        {draft && (
          <button
            type="button"
            onClick={handleAdd}
            className="text-brand-500 hover:text-brand-600"
          >
            <Plus className="h-3 w-3" />
          </button>
        )}
      </div>
    </div>
  );
}

// ── Nice-to-have tag list (simple, no groups) ─────────────────────────────────

function NiceToHaveTagList({
  skills,
  onRemove,
  onAdd,
}: {
  skills: string[];
  onRemove: (idx: number) => void;
  onAdd: (skill: string) => void;
}) {
  const [draft, setDraft] = useState("");

  const handleAdd = () => {
    const v = draft.trim();
    if (v && !skills.includes(v)) {
      onAdd(v);
      setDraft("");
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {skills.map((s, i) => (
        <span
          key={i}
          className="inline-flex items-center gap-0.5 rounded-full border border-gray-300 bg-white px-2 py-0.5 text-sm text-gray-900"
        >
          {s}
          <button
            type="button"
            onClick={() => onRemove(i)}
            className="ml-0.5 hover:opacity-60"
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
      <div className="inline-flex items-center gap-0.5">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              handleAdd();
            }
          }}
          placeholder="+ Thêm"
          className="w-16 border-0 border-b border-dashed border-gray-300 bg-transparent py-0.5 text-sm text-gray-500 placeholder:text-gray-400 focus:border-gray-500 focus:outline-none"
        />
        {draft && (
          <button
            type="button"
            onClick={handleAdd}
            className="text-brand-500 hover:text-brand-600"
          >
            <Plus className="h-3 w-3" />
          </button>
        )}
      </div>
    </div>
  );
}

// ── One-of group chip ─────────────────────────────────────────────────────────

function OneOfGroupChip({
  skills,
  onRemoveSkill,
  onAddSkill,
}: {
  skills: HardSkillItem[];
  onRemoveSkill: (skill: string) => void;
  onAddSkill: (skill: string) => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState("");

  const handleAdd = () => {
    const v = draft.trim();
    if (v) {
      onAddSkill(v);
      setDraft("");
    }
  };

  return (
    <div className="inline-flex flex-wrap items-center gap-1 rounded-lg border border-dashed border-gray-400 bg-white px-2.5 py-1.5">
      <span className="mr-0.5 shrink-0 text-xs font-semibold text-gray-500">
        {t("candidateEvaluation.jd.oneOfPrefix")}
      </span>
      {skills.map((s, i) => (
        <Fragment key={s.skill}>
          {i > 0 && (
            <span className="text-xs text-gray-300 select-none">/</span>
          )}
          <span className="inline-flex items-center gap-0.5 rounded border border-gray-300 bg-white px-1.5 py-0.5 text-sm text-gray-900">
            {s.skill}
            <button
              type="button"
              onClick={() => onRemoveSkill(s.skill)}
              className="ml-0.5 hover:opacity-60"
            >
              <X className="h-2.5 w-2.5" />
            </button>
          </span>
        </Fragment>
      ))}
      <div className="inline-flex items-center gap-0.5">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              handleAdd();
            }
          }}
          placeholder="+ Thêm"
          className="w-14 border-0 border-b border-dashed border-gray-300 bg-transparent py-0.5 text-sm text-gray-500 placeholder:text-gray-400 focus:outline-none"
        />
        {draft && (
          <button
            type="button"
            onClick={handleAdd}
            className="text-gray-600 hover:text-gray-900"
          >
            <Plus className="h-3 w-3" />
          </button>
        )}
      </div>
    </div>
  );
}

// ── Hard skill tag list (supports individual + one-of groups) ─────────────────

function HardSkillTagList({
  skills,
  onUpdate,
}: {
  skills: HardSkillItem[];
  onUpdate: (skills: HardSkillItem[]) => void;
}) {
  const { t } = useTranslation();
  const [newDraft, setNewDraft] = useState("");
  const [addingGroup, setAddingGroup] = useState(false);
  const [groupDraft, setGroupDraft] = useState("");

  // Separate ungrouped vs grouped
  const ungrouped = skills.filter((s) => !s.group);
  const groupMap = new Map<string, HardSkillItem[]>();
  for (const s of skills.filter((s) => s.group)) {
    const g = s.group!;
    groupMap.set(g, [...(groupMap.get(g) ?? []), s]);
  }

  const removeUngrouped = (skillName: string) => {
    onUpdate(
      skills.filter((s) => !(s.group === null && s.skill === skillName))
    );
  };

  const addUngrouped = (name: string) => {
    const v = name.trim();
    if (!v || skills.some((s) => !s.group && s.skill === v)) return;
    onUpdate([
      ...skills,
      {
        skill: v,
        level: "any",
        priority: "must-have",
        category: "other",
        group: null,
      },
    ]);
  };

  const removeFromGroup = (groupName: string, skillName: string) => {
    const remaining = skills.filter(
      (s) => !(s.group === groupName && s.skill === skillName)
    );
    const leftInGroup = remaining.filter((s) => s.group === groupName);
    if (leftInGroup.length === 1) {
      // Only 1 left → dissolve group, convert to ungrouped
      onUpdate(
        remaining.map((s) =>
          s.group === groupName ? { ...s, group: null } : s
        )
      );
    } else {
      onUpdate(remaining);
    }
  };

  const addToGroup = (groupName: string, skillName: string) => {
    const v = skillName.trim();
    if (!v) return;
    onUpdate([
      ...skills,
      {
        skill: v,
        level: "any",
        priority: "must-have",
        category: "other",
        group: groupName,
      },
    ]);
  };

  const addNewGroup = () => {
    const names = groupDraft
      .split(/[,/、]/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (names.length < 2) {
      toast.warning(t("candidateEvaluation.jd.addGroupHint"));
      return;
    }
    const groupName = `group_${Date.now()}`;
    const newItems: HardSkillItem[] = names.map((name) => ({
      skill: name,
      level: "any",
      priority: "must-have",
      category: "other",
      group: groupName,
    }));
    onUpdate([...skills, ...newItems]);
    setGroupDraft("");
    setAddingGroup(false);
  };

  return (
    <div className="space-y-2">
      {/* Ungrouped individual skills */}
      {(ungrouped.length > 0 || !addingGroup) && (
        <div className="flex flex-wrap items-center gap-1.5">
          {ungrouped.map((s) => (
            <span
              key={s.skill}
              className="inline-flex items-center gap-0.5 rounded-full border border-gray-300 bg-white px-2 py-0.5 text-sm text-gray-900"
            >
              {s.skill}
              <button
                type="button"
                onClick={() => removeUngrouped(s.skill)}
                className="ml-0.5 hover:opacity-60"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
          {/* Add individual skill */}
          <div className="inline-flex items-center gap-0.5">
            <input
              value={newDraft}
              onChange={(e) => setNewDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addUngrouped(newDraft);
                  setNewDraft("");
                }
              }}
              placeholder={t("candidateEvaluation.jd.addSkill")}
              className="w-28 border-0 border-b border-dashed border-gray-300 bg-transparent py-0.5 text-sm text-gray-500 placeholder:text-gray-400 focus:border-gray-500 focus:outline-none"
            />
            {newDraft && (
              <button
                type="button"
                onClick={() => {
                  addUngrouped(newDraft);
                  setNewDraft("");
                }}
                className="text-brand-500 hover:text-brand-600"
              >
                <Plus className="h-3 w-3" />
              </button>
            )}
          </div>
        </div>
      )}

      {/* One-of groups */}
      {Array.from(groupMap.entries()).map(([groupName, groupSkills]) => (
        <OneOfGroupChip
          key={groupName}
          skills={groupSkills}
          onRemoveSkill={(skill) => removeFromGroup(groupName, skill)}
          onAddSkill={(skill) => addToGroup(groupName, skill)}
        />
      ))}

      {/* Add new group */}
      {!addingGroup ? (
        <button
          type="button"
          onClick={() => setAddingGroup(true)}
          className="ml-1 rounded-lg border border-dashed border-gray-400 bg-white px-2.5 py-1 text-sm text-gray-600 transition-colors hover:border-gray-500 hover:text-gray-900"
        >
          {t("candidateEvaluation.jd.addGroup")}
        </button>
      ) : (
        <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-dashed border-gray-400 bg-white px-2.5 py-1.5">
          <span className="shrink-0 text-xs font-semibold text-gray-500">
            {t("candidateEvaluation.jd.oneOfPrefix")}
          </span>
          <input
            autoFocus
            value={groupDraft}
            onChange={(e) => setGroupDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addNewGroup();
              }
              if (e.key === "Escape") {
                setAddingGroup(false);
                setGroupDraft("");
              }
            }}
            placeholder="C#, Java, Python, Golang..."
            className="min-w-40 flex-1 bg-transparent text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none"
          />
          <p className="-mt-0.5 w-full text-xs text-gray-400">
            {t("candidateEvaluation.jd.addGroupHint")}
          </p>
          <button
            type="button"
            onClick={addNewGroup}
            title={t("candidateEvaluation.jd.confirmExperience")}
            className="text-gray-600 hover:text-gray-900"
          >
            <Check className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => {
              setAddingGroup(false);
              setGroupDraft("");
            }}
            className="text-gray-400 hover:text-gray-600"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}

// ── JD Editor ─────────────────────────────────────────────────────────────────

interface JDEditorProps {
  jd: ParsedJD;
  jdFilename: string | null;
  onJDChange: (jd: ParsedJD) => void;
  onReAnalyze: () => void;
}

function JDEditor({ jd, jdFilename, onJDChange, onReAnalyze }: JDEditorProps) {
  const { t } = useTranslation();

  const workModeOptions = useMemo(
    () => [
      { value: "Chưa rõ", label: t("candidateEvaluation.jd.workModeUnknown") },
      { value: "onsite", label: t("candidateEvaluation.jd.workModeOnsite") },
      { value: "remote", label: t("candidateEvaluation.jd.workModeRemote") },
      { value: "hybrid", label: t("candidateEvaluation.jd.workModeHybrid") },
    ],
    [t]
  );

  const employmentTypeOptions = useMemo(
    () => [
      { value: "Chưa rõ", label: t("candidateEvaluation.jd.employmentUnknown") },
      { value: "full-time", label: t("candidateEvaluation.jd.employmentFullTime") },
      { value: "part-time", label: t("candidateEvaluation.jd.employmentPartTime") },
      { value: "contract", label: t("candidateEvaluation.jd.employmentContract") },
      { value: "internship", label: t("candidateEvaluation.jd.employmentInternship") },
    ],
    [t]
  );

  const patch = useCallback(
    (updates: Partial<ParsedJD>) => onJDChange({ ...jd, ...updates }),
    [jd, onJDChange]
  );

  const mustHave =
    jd.hard_skills?.filter((s) => s.priority === "must-have") ?? [];
  const niceToHave =
    jd.hard_skills?.filter((s) => s.priority === "nice-to-have") ?? [];

  const updateMustHave = (updated: HardSkillItem[]) =>
    patch({ hard_skills: [...updated, ...niceToHave] });

  const removeNiceToHave = (idx: number) =>
    patch({
      hard_skills: [...mustHave, ...niceToHave.filter((_, i) => i !== idx)],
    });
  const addNiceToHave = (skill: string) => {
    const item: HardSkillItem = {
      skill,
      level: "any",
      priority: "nice-to-have",
      category: "other",
      group: null,
    };
    patch({ hard_skills: [...mustHave, ...niceToHave, item] });
  };

  const removeSoftSkill = (idx: number) =>
    patch({ soft_skills: jd.soft_skills?.filter((_, i) => i !== idx) ?? [] });
  const addSoftSkill = (skill: string) => {
    const item: SoftSkillItem = { skill, priority: "nice-to-have" };
    patch({ soft_skills: [...(jd.soft_skills ?? []), item] });
  };

  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
      {/* File header */}
      <div className="flex items-center justify-between gap-2 border-b border-gray-100 bg-gray-50 px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-1.5">
          <FileText className="h-3.5 w-3.5 shrink-0 text-gray-400" />
          <span className="truncate text-sm text-gray-500">{jdFilename}</span>
        </div>
        <button
          type="button"
          onClick={onReAnalyze}
          className="inline-flex shrink-0 items-center gap-1 text-sm text-gray-500 transition-colors hover:text-gray-700"
        >
          <RotateCcw className="h-3 w-3" />
          {t("candidateEvaluation.jd.reAnalyze")}
        </button>
      </div>

      {/* Job title */}
      <div className="px-4 pt-4 pb-3">
        <p className="mb-1 text-xs font-semibold tracking-wide text-gray-400 uppercase">
          {t("candidateEvaluation.jd.position")}
        </p>
        <InlineTitleField
          value={jd.job_title}
          onChange={(v) => patch({ job_title: v })}
        />
      </div>

      {/* Basic info */}
      <div className="grid grid-cols-2 gap-x-6 gap-y-3 border-t border-gray-100 px-4 py-3">
        <InlineTextField
          label={t("candidateEvaluation.jd.company")}
          value={jd.company}
          onChange={(v) => patch({ company: v })}
        />
        <InlineTextField
          label={t("candidateEvaluation.jd.location")}
          value={jd.location}
          onChange={(v) => patch({ location: v })}
        />
        <InlineSelectField
          label={t("candidateEvaluation.jd.workMode")}
          value={jd.work_mode || "Chưa rõ"}
          options={workModeOptions}
          onChange={(v) => patch({ work_mode: v })}
        />
        <InlineSelectField
          label={t("candidateEvaluation.jd.employmentType")}
          value={jd.employment_type || "Chưa rõ"}
          options={employmentTypeOptions}
          onChange={(v) => patch({ employment_type: v })}
        />
        <ExperienceEditor
          experience={jd.experience_range}
          onChange={(v) => patch({ experience_range: v })}
        />
        <EducationEditor
          education={jd.education}
          onChange={(v) => patch({ education: v })}
        />
      </div>

      {/* Skills */}
      <div className="space-y-4 border-t border-gray-100 px-4 py-3">
        {/* Must-have hard skills */}
        <div>
          <p className="mb-2 text-sm font-semibold text-gray-600">
            {t("candidateEvaluation.jd.hardSkillsMust")}
          </p>
          <HardSkillTagList skills={mustHave} onUpdate={updateMustHave} />
        </div>

        {/* Nice-to-have hard skills */}
        <div>
          <p className="mb-1.5 text-sm font-semibold text-gray-600">
            {t("candidateEvaluation.jd.hardSkillsNice")}
          </p>
          <NiceToHaveTagList
            skills={niceToHave.map((s) => s.skill)}
            onRemove={removeNiceToHave}
            onAdd={addNiceToHave}
          />
        </div>

        {/* Soft skills */}
        <div>
          <p className="mb-1.5 text-sm font-semibold text-gray-600">
            {t("candidateEvaluation.jd.softSkills")}
          </p>
          <SoftSkillTagList
            skills={(jd.soft_skills ?? []).map((s) => s.skill)}
            onRemove={removeSoftSkill}
            onAdd={addSoftSkill}
          />
        </div>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface StepUploadJDProps {
  jd: ParsedJD | null;
  jdFilename: string | null;
  jdSummary: string | null;
  onParsed: (
    jd: ParsedJD,
    documentId: string,
    filename: string,
    summary: string
  ) => void;
  onJDChange: (jd: ParsedJD) => void;
}

const ACCEPTED = ".pdf,.doc,.docx,.txt";

export function StepUploadJD({
  jd,
  jdFilename,
  jdSummary: _jdSummary,
  onParsed,
  onJDChange,
}: StepUploadJDProps) {
  const { t } = useTranslation();
  const jdParseMessages = useMemo(
    () => [
      t("candidateEvaluation.jd.parsingMsg0"),
      t("candidateEvaluation.jd.parsingMsg1"),
      t("candidateEvaluation.jd.parsingMsg2"),
      t("candidateEvaluation.jd.parsingMsg3"),
      t("candidateEvaluation.jd.parsingMsg4"),
      t("candidateEvaluation.jd.parsingMsg5"),
    ],
    [t]
  );
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [msgIdx, setMsgIdx] = useState(0);
  const [simPct, setSimPct] = useState(0);
  const [reAnalyzing, setReAnalyzing] = useState(false);
  const [inputMode, setInputMode] = useState<"file" | "text">("file");
  const [rawText, setRawText] = useState("");

  useEffect(() => {
    if (!loading) {
      setMsgIdx(0);
      setSimPct(0);
      return;
    }
    const msgTimer = setInterval(() => {
      setMsgIdx((prev) => Math.min(prev + 1, jdParseMessages.length - 1));
    }, 2800);
    const pctTimer = setInterval(() => {
      setSimPct((prev) => (prev < 88 ? prev + 2 : prev));
    }, 350);
    return () => {
      clearInterval(msgTimer);
      clearInterval(pctTimer);
    };
  }, [loading]);

  const handleFile = useCallback((f: File) => setFile(f), []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const f = e.dataTransfer.files[0];
      if (f) handleFile(f);
    },
    [handleFile]
  );

  const doParseJD = async (docId: string) => {
    const result = await candidateEvaluationApi.parseJD(docId);
    onParsed(
      result.jd,
      result.jd_document_id,
      result.jd_filename,
      result.jd_summary
    );
    setReAnalyzing(false);
    setFile(null);
    setRawText("");
    toast.success(t("candidateEvaluation.jd.parseSuccess"));
  };

  const handleAnalyze = async () => {
    if (!file) return;
    setLoading(true);
    try {
      const formData = new FormData();
      formData.append("files", file);
      formData.append("source_type", "chat_attachment");
      const docs = await documentsApi.upload(formData);
      await doParseJD(docs[0].id);
    } catch {
      toast.error(t("candidateEvaluation.jd.parseError"));
    } finally {
      setLoading(false);
    }
  };

  const handleAnalyzeText = async () => {
    if (!rawText.trim()) return;
    setLoading(true);
    try {
      const blob = new Blob([rawText], { type: "text/plain" });
      const txtFile = new File([blob], "job-description.txt", {
        type: "text/plain",
      });
      const formData = new FormData();
      formData.append("files", txtFile);
      formData.append("source_type", "chat_attachment");
      const docs = await documentsApi.upload(formData);
      await doParseJD(docs[0].id);
    } catch {
      toast.error(t("candidateEvaluation.jd.parseError"));
    } finally {
      setLoading(false);
    }
  };

  const handleStorageSelect = async (documentIds: string[]) => {
    if (!documentIds.length) return;
    setLoading(true);
    try {
      await doParseJD(documentIds[0]);
    } catch {
      toast.error(t("candidateEvaluation.jd.parseError"));
    } finally {
      setLoading(false);
    }
  };

  const loadingBlock = loading && (
    <div className="space-y-2 rounded-lg border border-gray-200 bg-gray-50 p-4">
      <div className="flex items-center justify-between text-base">
        <div className="flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin text-gray-500" />
          <span className="font-medium text-gray-700">
            {jdParseMessages[msgIdx]}
          </span>
        </div>
        <span className="text-brand-600 text-sm font-semibold">{simPct}%</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-200">
        <div
          className="bg-brand-500 h-full rounded-full transition-all duration-500 ease-out"
          style={{ width: `${simPct}%` }}
        />
      </div>
      <p className="text-sm text-gray-400">
        {t("candidateEvaluation.jd.processMayTake")}
      </p>
    </div>
  );

  const uploadForm = (
    <div className="space-y-3">
      {/* Mode tabs */}
      <div className="flex gap-1 rounded-lg border-2 border-gray-200 bg-white p-1">
        <button
          type="button"
          onClick={() => setInputMode("file")}
          className={cn(
            "flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-2 text-sm font-semibold transition-all",
            inputMode === "file"
              ? "bg-brand-500 text-white shadow-sm"
              : "text-gray-500 hover:bg-gray-200 hover:text-gray-700"
          )}
        >
          <Upload className="h-3.5 w-3.5" />
          {t("candidateEvaluation.jd.uploadFile")}
        </button>
        <button
          type="button"
          onClick={() => setInputMode("text")}
          className={cn(
            "flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-2 text-sm font-semibold transition-all",
            inputMode === "text"
              ? "bg-brand-500 text-white shadow-sm"
              : "text-gray-500 hover:bg-gray-200 hover:text-gray-700"
          )}
        >
          <AlignLeft className="h-3.5 w-3.5" />
          {t("candidateEvaluation.jd.pasteText")}
        </button>
      </div>

      {/* Upload file mode */}
      {inputMode === "file" && (
        <>
          <div
            className={cn(
              "rounded-lg border-2 border-dashed p-6 text-center transition-colors",
              dragOver
                ? "border-brand-300 bg-brand-50"
                : "border-gray-300 hover:border-gray-400"
            )}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
          >
            <Upload className="mx-auto mb-2 h-7 w-7 text-gray-400" />
            <p className="mb-2 text-base text-gray-600">
              {t("candidateEvaluation.jd.dragDropHint")}
            </p>
            <div className="flex justify-center gap-2">
              <label className="cursor-pointer">
                <Button variant="outline" size="sm" asChild>
                  <span>{t("candidateEvaluation.jd.selectFile")}</span>
                </Button>
                <input
                  type="file"
                  className="hidden"
                  accept={ACCEPTED}
                  onChange={(e) =>
                    e.target.files?.[0] && handleFile(e.target.files[0])
                  }
                />
              </label>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowPicker(true)}
              >
                <Database className="mr-1 h-4 w-4" />
                {t("candidateEvaluation.jd.fromStorage")}
              </Button>
            </div>
          </div>

          {file && (
            <div className="flex items-center justify-between rounded-md border border-gray-200 bg-gray-50 px-3 py-2">
              <div className="flex min-w-0 items-center gap-2">
                <FileText className="h-4 w-4 shrink-0 text-gray-400" />
                <span className="truncate text-base text-gray-700">
                  {file.name}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setFile(null)}
                className="ml-2 text-gray-400 hover:text-gray-600"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          )}

          {file && !loading && (
            <Button
              onClick={handleAnalyze}
              className="bg-brand-500 hover:bg-brand-600 w-full text-white"
            >
              {t("candidateEvaluation.jd.analyzeJD")}
            </Button>
          )}
        </>
      )}

      {/* Raw text mode */}
      {inputMode === "text" && (
        <>
          <textarea
            value={rawText}
            onChange={(e) => setRawText(e.target.value)}
            placeholder={t("candidateEvaluation.jd.pasteJDPlaceholder")}
            rows={10}
            className="focus:border-brand-400 focus:ring-brand-100 w-full resize-none rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-base text-gray-800 transition-colors placeholder:text-gray-400 focus:ring-1 focus:outline-none"
          />
          {rawText.trim() && !loading && (
            <Button
              onClick={handleAnalyzeText}
              className="bg-brand-500 hover:bg-brand-600 w-full text-white"
            >
              {t("candidateEvaluation.jd.analyzeJD")}
            </Button>
          )}
        </>
      )}

      {reAnalyzing && !file && !rawText.trim() && !loading && (
        <Button
          variant="ghost"
          className="w-full text-gray-500"
          onClick={() => setReAnalyzing(false)}
        >
          {t("candidateEvaluation.jd.cancelReAnalyze")}
        </Button>
      )}

      {loadingBlock}
    </div>
  );

  if (jd) {
    return (
      <div className="space-y-4">
        {reAnalyzing && (
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
            <p className="mb-2 text-sm font-medium text-gray-600">
              {t("candidateEvaluation.jd.reAnalyzeTitle")}
            </p>
            {uploadForm}
          </div>
        )}
        <JDEditor
          jd={jd}
          jdFilename={jdFilename}
          onJDChange={onJDChange}
          onReAnalyze={() => setReAnalyzing(true)}
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-base text-gray-600">
        {t("candidateEvaluation.jd.uploadTitle")}
      </p>
      {uploadForm}
      <DocumentPicker
        open={showPicker}
        onClose={() => setShowPicker(false)}
        onSelect={handleStorageSelect}
        extensions={[".pdf", ".docx", ".doc", ".txt"]}
        title={t("candidateEvaluation.jd.pickFromStorage")}
      />
    </div>
  );
}
