import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/app/components/ui/button";
import { Loader2, ChevronDown, ChevronUp } from "lucide-react";
import { toast } from "sonner";
import { candidateEvaluationApi } from "@/app/api/endpoints/candidateEvaluation";
import { useSimulatedProgress } from "@/app/hooks/useSimulatedProgress";
import { ScoreBadge, RecommendationBadge } from "./ScoreBadge";
import type {
  ParsedJD,
  ParsedCandidate,
  CandidateRanking,
} from "@/app/types/candidateEvaluation";

interface StepRankingProps {
  jd: ParsedJD;
  candidates: ParsedCandidate[];
  rankings: CandidateRanking[];
  onRanked: (
    rankings: CandidateRanking[],
    shortlistIndices: number[],
    topN: number
  ) => void;
}

const TOP_OPTIONS = [3, 5, 10, 20];

export function StepRanking({
  jd,
  candidates,
  rankings,
  onRanked,
}: StepRankingProps) {
  const { t } = useTranslation();
  const [topN, setTopN] = useState(5);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [showAll, setShowAll] = useState(false);

  const validCandidates = candidates.filter((c) => !c.error);
  const progressMessages = useMemo(
    () => [
      t("candidateEvaluation.ranking.rankMsg0", { count: validCandidates.length }),
      t("candidateEvaluation.ranking.rankMsg1"),
      t("candidateEvaluation.ranking.rankMsg2"),
      t("candidateEvaluation.ranking.rankMsg3"),
      t("candidateEvaluation.ranking.rankMsg4"),
      t("candidateEvaluation.ranking.rankMsg5"),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [validCandidates.length, t]
  );
  const { message: progressMessage, percent: simPct } = useSimulatedProgress({
    active: loading,
    messages: progressMessages,
    messageIntervalMs: 3500,
    stepPercent: 1.5,
  });

  const handleMatch = async () => {
    setLoading(true);
    try {
      const result = await candidateEvaluationApi.match(jd, candidates, topN);
      onRanked(result.rankings, result.shortlist_indices, topN);
      toast.success(t("candidateEvaluation.ranking.rankSuccess", { count: result.total_evaluated }));
    } catch {
      toast.error(t("candidateEvaluation.ranking.rankError"));
    } finally {
      setLoading(false);
    }
  };

  if (rankings.length === 0) {
    return (
      <div className="space-y-4">
        <p className="text-base text-gray-600">
          {t("candidateEvaluation.ranking.descriptionShort", { count: validCandidates.length })}
        </p>

        <div className="flex items-center gap-3">
          <span className="text-base text-gray-600">{t("candidateEvaluation.ranking.selectTopN")}</span>
          <div className="flex gap-1">
            {TOP_OPTIONS.filter((n) => n <= validCandidates.length).map((n) => (
              <Button
                key={n}
                variant={topN === n ? "default" : "outline"}
                size="sm"
                onClick={() => setTopN(n)}
                className={
                  topN === n ? "bg-brand-500 hover:bg-brand-600 text-white" : ""
                }
              >
                {n}
              </Button>
            ))}
            <Button
              variant={
                !TOP_OPTIONS.includes(topN) || topN > validCandidates.length
                  ? "default"
                  : "outline"
              }
              size="sm"
              onClick={() => setTopN(validCandidates.length)}
              className={
                !TOP_OPTIONS.includes(topN) || topN > validCandidates.length
                  ? "bg-brand-500 hover:bg-brand-600 text-white"
                  : ""
              }
            >
              {t("candidateEvaluation.ranking.allCandidates", { count: validCandidates.length })}
            </Button>
          </div>
        </div>

        {!loading && (
          <Button
            onClick={handleMatch}
            className="bg-brand-500 hover:bg-brand-600 w-full text-white"
          >
            {t("candidateEvaluation.ranking.rankButton")}
          </Button>
        )}

        {loading && (
          <div className="space-y-2 rounded-lg border bg-gray-50 p-4">
            <div className="flex items-center justify-between text-base">
              <div className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin text-gray-500" />
                <span className="font-medium text-gray-700">
                  {progressMessage}
                </span>
              </div>
              <span className="text-brand-600 text-sm font-semibold">
                {Math.round(simPct)}%
              </span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-gray-200">
              <div
                className="bg-brand-500 h-full rounded-full transition-all duration-500 ease-out"
                style={{ width: `${simPct}%` }}
              />
            </div>
            <p className="text-sm text-gray-400">
              {t("candidateEvaluation.ranking.aiReadingNote")}
            </p>
          </div>
        )}
      </div>
    );
  }

  const shortlist = rankings.slice(0, topN);
  const rest = rankings.slice(topN);
  function renderRow(r: CandidateRanking, isShortlisted: boolean) {
    return (
      <>
        <tr
          key={r.candidate_index}
          className={`cursor-pointer border-b transition-colors ${
            isShortlisted
              ? "hover:bg-emerald-50/50"
              : "opacity-60 hover:bg-gray-50"
          }`}
          onClick={() =>
            setExpanded(
              expanded === r.candidate_index ? null : r.candidate_index
            )
          }
        >
          <td className="px-3 py-2 font-bold text-gray-500">{r.rank}</td>
          <td className="px-3 py-2">
            <div className="flex items-center gap-1.5">
              <span className="font-medium">{r.name}</span>
              {expanded === r.candidate_index ? (
                <ChevronUp className="h-3.5 w-3.5 text-gray-400" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5 text-gray-400" />
              )}
            </div>
          </td>
          <td className="px-3 py-2 text-center">
            <ScoreBadge score={r.total_score} />
          </td>
          <td className="hidden px-3 py-2 text-center sm:table-cell">
            <ScoreBadge score={r.scores.hard_skills_match} size="sm" />
          </td>
          <td className="hidden px-3 py-2 text-center sm:table-cell">
            <ScoreBadge score={r.scores.soft_skills_match} size="sm" />
          </td>
          <td className="hidden px-3 py-2 text-center md:table-cell">
            <ScoreBadge score={r.scores.experience_relevance} size="sm" />
          </td>
          <td className="px-3 py-2">
            <RecommendationBadge recommendation={r.recommendation} />
          </td>
        </tr>
        {expanded === r.candidate_index && (
          <tr key={`${r.candidate_index}-detail`}>
            <td colSpan={7} className="bg-gray-50 px-3 py-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <p className="mb-1 text-sm font-semibold text-gray-500">
                    {t("candidateEvaluation.ranking.scoreDetail")}
                  </p>
                  <div className="space-y-1 text-sm">
                    {[
                      [t("candidateEvaluation.ranking.hardSkillsPct"), r.scores.hard_skills_match],
                      [t("candidateEvaluation.ranking.softSkillsPct"), r.scores.soft_skills_match],
                      [t("candidateEvaluation.ranking.niceToHavePct"), r.scores.nice_to_have],
                      [t("candidateEvaluation.ranking.experiencePct"), r.scores.experience_relevance],
                      [t("candidateEvaluation.ranking.educationPct"), r.scores.education_certs],
                      [t("candidateEvaluation.ranking.impressionPct"), r.scores.overall_impression],
                    ].map(([label, score]) => (
                      <div
                        key={String(label)}
                        className="flex items-center justify-between"
                      >
                        <span className="text-gray-600">{label}</span>
                        <ScoreBadge score={Number(score)} size="sm" />
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  {r.strengths.length > 0 && (
                    <div className="mb-2">
                      <p className="mb-1 text-sm font-semibold text-emerald-600">
                        {t("candidateEvaluation.ranking.strengths")}
                      </p>
                      <ul className="space-y-0.5 text-sm text-gray-600">
                        {r.strengths.map((s) => (
                          <li key={s}>+ {s}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {r.gaps.length > 0 && (
                    <div>
                      <p className="mb-1 text-sm font-semibold text-red-600">
                        {t("candidateEvaluation.ranking.gaps")}
                      </p>
                      <ul className="space-y-0.5 text-sm text-gray-600">
                        {r.gaps.map((g) => (
                          <li key={g}>- {g}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </div>
              {r.recommendation_note && (
                <p className="mt-2 text-sm text-gray-500 italic">
                  {r.recommendation_note}
                </p>
              )}
            </td>
          </tr>
        )}
      </>
    );
  }

  return (
    <div className="space-y-3">
      {/* Summary badge */}
      <div className="flex items-center gap-2 text-base">
        <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-sm font-semibold text-emerald-700">
          Top {shortlist.length}
        </span>
        <span className="text-gray-500">
          {t("candidateEvaluation.ranking.topSummary", { top: shortlist.length, total: rankings.length })}
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-base">
          <thead>
            <tr className="border-b bg-gray-50 text-left">
              <th className="w-8 px-3 py-2">#</th>
              <th className="px-3 py-2">{t("candidateEvaluation.ranking.candidate")}</th>
              <th className="w-24 px-3 py-2 text-center whitespace-nowrap">
                {t("candidateEvaluation.ranking.totalScore")}
              </th>
              <th className="hidden w-28 px-3 py-2 text-center whitespace-nowrap sm:table-cell">
                {t("candidateEvaluation.ranking.hardSkills")}
              </th>
              <th className="hidden w-32 px-3 py-2 text-center whitespace-nowrap sm:table-cell">
                {t("candidateEvaluation.ranking.softSkills")}
              </th>
              <th className="hidden w-32 px-3 py-2 text-center whitespace-nowrap md:table-cell">
                {t("candidateEvaluation.ranking.experience")}
              </th>
              <th className="w-24 px-3 py-2">{t("candidateEvaluation.ranking.evaluation")}</th>
            </tr>
          </thead>
          <tbody>
            {/* Shortlisted candidates */}
            {shortlist.map((r) => renderRow(r, true))}

            {/* Divider + toggle for remaining */}
            {rest.length > 0 && !showAll && (
              <tr>
                <td colSpan={7} className="px-3 py-2">
                  <button
                    type="button"
                    onClick={() => setShowAll(true)}
                    className="flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-gray-300 py-1.5 text-sm text-gray-500 transition-colors hover:border-gray-400 hover:text-gray-700"
                  >
                    <ChevronDown className="h-3.5 w-3.5" />
                    {t("candidateEvaluation.ranking.showMore", { count: rest.length })}
                  </button>
                </td>
              </tr>
            )}

            {/* Remaining (dimmed) */}
            {showAll && rest.map((r) => renderRow(r, false))}

            {showAll && rest.length > 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-2">
                  <button
                    type="button"
                    onClick={() => setShowAll(false)}
                    className="flex w-full items-center justify-center gap-1.5 text-sm text-gray-400 transition-colors hover:text-gray-600"
                  >
                    <ChevronUp className="h-3.5 w-3.5" />
                    {t("candidateEvaluation.ranking.showLess")}
                  </button>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
