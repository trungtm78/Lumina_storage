import { useTranslation } from "react-i18next";
import type { ParsedCandidate } from "@/app/types/candidateEvaluation";
import { AlertCircle, Briefcase, GraduationCap, MapPin } from "lucide-react";

interface CandidateCardProps {
  candidate: ParsedCandidate;
  index: number;
}

export function CandidateCard({ candidate, index }: CandidateCardProps) {
  const { t } = useTranslation();
  if (candidate.error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-3">
        <div className="flex items-center gap-2 text-base text-red-600">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span className="font-medium">{candidate.original_filename}</span>
        </div>
        <p className="mt-1 text-sm text-red-500">{candidate.error}</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 transition-colors hover:border-gray-300">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h4 className="truncate font-bold text-gray-900">
            {index + 1}. {candidate.name || candidate.original_filename}
          </h4>
          {candidate.current_role && (
            <div className="mt-0.5 flex items-center gap-1.5 text-base text-gray-600">
              <Briefcase className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">
                {candidate.current_role}
                {candidate.current_company && ` @ ${candidate.current_company}`}
              </span>
            </div>
          )}
        </div>
        <span className="shrink-0 rounded bg-gray-100 px-2 py-0.5 text-sm font-medium text-gray-500">
          {candidate.experience_years || "?"} {t("candidateEvaluation.cv.yr")}
        </span>
      </div>

      {/* Hard skills */}
      {(candidate.hard_skills?.length > 0 || candidate.skills?.length > 0) && (
        <div className="mt-2 flex flex-wrap gap-1">
          {(candidate.hard_skills?.length > 0
            ? candidate.hard_skills
                .slice(0, 8)
                .map((s) => (typeof s === "string" ? s : s.skill))
            : candidate.skills.slice(0, 8)
          ).map((skill) => (
            <span
              key={skill}
              className="rounded bg-blue-50 px-1.5 py-0.5 text-sm text-blue-700"
            >
              {skill}
            </span>
          ))}
          {(candidate.hard_skills?.length || candidate.skills?.length || 0) >
            8 && (
            <span className="text-sm text-gray-400">
              +
              {(candidate.hard_skills?.length ||
                candidate.skills?.length ||
                0) - 8}
            </span>
          )}
        </div>
      )}
      {/* Soft skills */}
      {candidate.soft_skills?.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1">
          {candidate.soft_skills.slice(0, 4).map((skill) => (
            <span
              key={skill}
              className="rounded bg-indigo-50 px-1.5 py-0.5 text-sm text-indigo-600"
            >
              {skill}
            </span>
          ))}
        </div>
      )}

      <div className="mt-2 flex items-center gap-3 text-sm text-gray-500">
        {candidate.education?.[0] && (
          <div className="flex items-center gap-1">
            <GraduationCap className="h-3.5 w-3.5" />
            <span>
              {candidate.education[0].degree} {candidate.education[0].field}
            </span>
          </div>
        )}
        {candidate.location && (
          <div className="flex items-center gap-1">
            <MapPin className="h-3.5 w-3.5" />
            <span>{candidate.location}</span>
          </div>
        )}
      </div>
    </div>
  );
}
