import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/app/components/ui/button";
import { Loader2, Copy, Check } from "lucide-react";
import { toast } from "sonner";
import { candidateEvaluationApi } from "@/app/api/endpoints/candidateEvaluation";
import { useSimulatedProgress } from "@/app/hooks/useSimulatedProgress";
import type {
  ParsedJD,
  ParsedCandidate,
  CandidateRanking,
  CandidateQuestions,
  InterviewQuestion,
} from "@/app/types/candidateEvaluation";

interface StepInterviewQuestionsProps {
  jd: ParsedJD;
  candidates: ParsedCandidate[];
  rankings: CandidateRanking[];
  shortlistIndices: number[];
  candidateQuestions: CandidateQuestions[];
  onGenerated: (
    candidateQuestions: CandidateQuestions[],
    interviewQuestions: Record<string, InterviewQuestion[]>
  ) => void;
}

function QuestionCard({ q }: { q: InterviewQuestion }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(q.question);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="rounded-md border bg-white p-3">
      <div className="flex items-start justify-between gap-2">
        <p className="text-base font-medium text-gray-900">{q.question}</p>
        <button
          type="button"
          onClick={handleCopy}
          className="mt-0.5 shrink-0 text-gray-400 hover:text-gray-600"
        >
          {copied ? (
            <Check className="h-3.5 w-3.5 text-emerald-500" />
          ) : (
            <Copy className="h-3.5 w-3.5" />
          )}
        </button>
      </div>
      {q.purpose && (
        <p className="mt-1 text-sm text-gray-500">
          <span className="font-medium">{t("candidateEvaluation.questions.purpose")}</span> {q.purpose}
        </p>
      )}
      {q.follow_up && (
        <p className="mt-0.5 text-sm text-gray-500">
          <span className="font-medium">{t("candidateEvaluation.questions.followUp")}</span> {q.follow_up}
        </p>
      )}
    </div>
  );
}

export function StepInterviewQuestions({
  jd,
  candidates,
  rankings,
  shortlistIndices,
  candidateQuestions,
  onGenerated,
}: StepInterviewQuestionsProps) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState(0);

  const totalCandidates = shortlistIndices.length || rankings.length;

  const catLabels: Record<string, string> = useMemo(
    () => ({
      technical: t("candidateEvaluation.questions.categoryTechnical"),
      behavioral: t("candidateEvaluation.questions.categoryBehavioral"),
      situational: t("candidateEvaluation.questions.categorySituational"),
      experience: t("candidateEvaluation.questions.categoryExperience"),
      role_specific: t("candidateEvaluation.questions.categoryRoleSpecific"),
    }),
    [t]
  );

  const progressMessages = useMemo(
    () => [
      t("candidateEvaluation.questions.iqMsg0", { count: totalCandidates }),
      t("candidateEvaluation.questions.iqMsg1"),
      t("candidateEvaluation.questions.iqMsg2"),
      t("candidateEvaluation.questions.iqMsg3"),
      t("candidateEvaluation.questions.iqMsg4"),
      t("candidateEvaluation.questions.iqMsg5"),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [totalCandidates, t]
  );
  const { message: progressMessage, percent: simPct } = useSimulatedProgress({
    active: loading,
    messages: progressMessages,
    messageIntervalMs: 4000,
    stepPercent: 1.2,
  });

  const handleGenerate = async () => {
    setLoading(true);
    try {
      const result = await candidateEvaluationApi.generateQuestions(
        jd,
        candidates,
        rankings,
        shortlistIndices
      );
      onGenerated(result.candidate_questions, result.interview_questions);
      toast.success(result.questions_summary);
    } catch {
      toast.error(t("candidateEvaluation.questions.generateError"));
    } finally {
      setLoading(false);
    }
  };

  if (candidateQuestions.length === 0) {
    return (
      <div className="space-y-4">
        <p className="text-base text-gray-600">
          {t("candidateEvaluation.questions.generateDescription", { count: totalCandidates })}
        </p>

        {!loading && (
          <Button
            onClick={handleGenerate}
            className="bg-brand-500 hover:bg-brand-600 w-full text-white"
          >
            {t("candidateEvaluation.questions.generateButton")}
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
              {t("candidateEvaluation.questions.generateNote")}
            </p>
          </div>
        )}
      </div>
    );
  }

  const current = candidateQuestions[activeTab];
  const grouped: Record<string, InterviewQuestion[]> = {};
  for (const q of current?.questions || []) {
    const cat = q.category || "other";
    (grouped[cat] ??= []).push(q);
  }

  return (
    <div className="space-y-3">
      {/* Candidate tabs */}
      <div className="flex gap-1 overflow-x-auto pb-1">
        {candidateQuestions.map((cq, i) => (
          <Button
            key={cq.candidate_index}
            variant={activeTab === i ? "default" : "outline"}
            size="sm"
            onClick={() => setActiveTab(i)}
            className="shrink-0"
          >
            {cq.name}
          </Button>
        ))}
      </div>

      {/* Questions by category */}
      {current && (
        <div className="space-y-4">
          {Object.entries(grouped).map(([cat, questions]) => (
            <div key={cat}>
              <h4 className="mb-2 text-sm font-bold text-gray-500 uppercase">
                {catLabels[cat] || cat} ({questions.length})
              </h4>
              <div className="space-y-2">
                {questions.map((q, i) => (
                  <QuestionCard key={i} q={q} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
