import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/app/components/ui/button";
import { cn } from "@/app/components/ui/utils";
import { ChevronLeft, ChevronRight, Check } from "lucide-react";
import { StepUploadJD } from "@/app/components/candidate-evaluation/StepUploadJD";
import { StepUploadCVs } from "@/app/components/candidate-evaluation/StepUploadCVs";
import { StepRanking } from "@/app/components/candidate-evaluation/StepRanking";
import { StepInterviewQuestions } from "@/app/components/candidate-evaluation/StepInterviewQuestions";
import { StepReport } from "@/app/components/candidate-evaluation/StepReport";
import { HomeScreen } from "@/app/components/candidate-evaluation/HomeScreen";
import { MasterListWorkspace } from "@/app/components/candidate-evaluation/MasterListWorkspace";
import type {
  ParsedJD,
  ParsedCandidate,
  CandidateRanking,
  CandidateQuestions,
  InterviewQuestion,
} from "@/app/types/candidateEvaluation";

type AppMode = null | "evaluation" | "master-list";
type MasterListPhase = 1 | 2 | 3;

export function CandidateEvaluationPage() {
  const { t } = useTranslation();

  const steps = [
    { id: 1, label: t("candidateEvaluation.steps.jobDescription") },
    { id: 2, label: t("candidateEvaluation.steps.uploadCV") },
    { id: 3, label: t("candidateEvaluation.steps.ranking") },
    { id: 4, label: t("candidateEvaluation.steps.interview") },
    { id: 5, label: t("candidateEvaluation.steps.report") },
  ];

  const masterListPhases = [
    { id: 1 as MasterListPhase, label: t("candidateEvaluation.masterList.phase1") },
    { id: 2 as MasterListPhase, label: t("candidateEvaluation.masterList.phase2") },
    { id: 3 as MasterListPhase, label: t("candidateEvaluation.masterList.phase3") },
  ];

  const [mode, setMode] = useState<AppMode>(null);
  const [step, setStep] = useState(1);
  const [masterListPhase, setMasterListPhase] = useState<MasterListPhase>(1);

  // State
  const [jd, setJd] = useState<ParsedJD | null>(null);
  const [jdDocumentId, setJdDocumentId] = useState<string | null>(null);
  const [jdFilename, setJdFilename] = useState<string | null>(null);
  const [jdSummary, setJdSummary] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<ParsedCandidate[]>([]);
  const [rankings, setRankings] = useState<CandidateRanking[]>([]);
  const [shortlistIndices, setShortlistIndices] = useState<number[]>([]);
  const [topN, setTopN] = useState(5);
  const [candidateQuestions, setCandidateQuestions] = useState<
    CandidateQuestions[]
  >([]);
  const [interviewQuestions, setInterviewQuestions] = useState<
    Record<string, InterviewQuestion[]>
  >({});
  const [reportDocumentId, setReportDocumentId] = useState<string | null>(null);
  const [reportPreviewId, setReportPreviewId] = useState<string | null>(null);

  // Step completion
  const canGoNext = (s: number) => {
    switch (s) {
      case 1: return jd !== null;
      case 2: return candidates.filter((c) => !c.error).length > 0;
      case 3: return rankings.length > 0;
      case 4: return true; // Optional step
      case 5: return true;
      default: return false;
    }
  };

  const handleNext = () => {
    if (step < 5 && canGoNext(step)) setStep(step + 1);
  };

  const handleBack = () => {
    if (step > 1) setStep(step - 1);
  };

  // ── Master List mode renders its own full layout ──────────────────────────
  if (mode === "master-list") {
    return (
      <div className="flex flex-1 flex-col overflow-hidden bg-white">
        <div className="shrink-0 flex flex-col border-b px-6 py-4">
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              className="text-muted-foreground hover:text-foreground hover:bg-muted/50 -ml-2 h-8 w-8 rounded-full"
              onClick={() => { setMode(null); setMasterListPhase(1); }}
              title={t("candidateEvaluation.nav.back")}
            >
              <ChevronLeft className="h-5 w-5" />
            </Button>
            <h1 className="text-xl font-semibold text-gray-900">
              {t("candidateEvaluation.title")}
            </h1>
          </div>
          <p className="mt-0.5 ml-8 text-base text-gray-500">
            {t("candidateEvaluation.home.masterListTitle")}
          </p>
        </div>
        {/* Phase indicator */}
        <div className="shrink-0 flex justify-center border-b border-gray-100 px-6 py-3">
          <div className="flex items-center gap-1">
            {masterListPhases.map((p, i) => {
              const isCompleted = masterListPhase > p.id;
              const isCurrent = masterListPhase === p.id;
              return (
                <div key={p.id} className="flex items-center">
                  {i > 0 && (
                    <div className={cn("mx-1 h-px w-6", isCompleted ? "bg-emerald-400" : "bg-gray-200")} />
                  )}
                  <div
                    className={cn(
                      "flex items-center gap-1.5 rounded-full px-2.5 py-1 text-sm font-medium transition-colors",
                      isCurrent && "bg-brand-50 text-brand-700",
                      isCompleted && "bg-emerald-100 text-emerald-700",
                      !isCurrent && !isCompleted && "text-gray-400",
                    )}
                  >
                    {isCompleted ? (
                      <Check className="h-3 w-3" />
                    ) : (
                      <span className="flex h-4 w-4 items-center justify-center rounded-full border text-xs">
                        {p.id}
                      </span>
                    )}
                    <span>{p.label}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-6">
          <div className="mx-auto max-w-3xl">
            <MasterListWorkspace
              phase={masterListPhase}
              onPhaseChange={setMasterListPhase}
            />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-white">
      {/* Header */}
      <div className="shrink-0 flex flex-col border-b px-6 py-4">
        <div className="flex items-center gap-2">
          {mode !== null && (
            <Button
              variant="ghost"
              size="icon"
              className="text-muted-foreground hover:text-foreground hover:bg-muted/50 -ml-2 h-8 w-8 rounded-full"
              onClick={() => setMode(null)}
              title={t("candidateEvaluation.nav.back")}
            >
              <ChevronLeft className="h-5 w-5" />
            </Button>
          )}
          <h1 className="text-xl font-semibold text-gray-900">
            {t("candidateEvaluation.title")}
          </h1>
        </div>
        <p className={cn("mt-0.5 text-base text-gray-500", mode !== null && "ml-8")}>
          {mode === "evaluation"
            ? t("candidateEvaluation.header.subtitle")
            : t("candidateEvaluation.header.selectFeature")}
        </p>
      </div>

      {/* Step indicator — only shown in evaluation mode */}
      {mode === "evaluation" && (
        <div className="shrink-0 flex justify-center px-6 py-3">
          <div className="flex items-center gap-1">
            {steps.map((s, i) => {
              const isCompleted = step > s.id;
              const isCurrent = step === s.id;
              return (
                <div key={s.id} className="flex items-center">
                  {i > 0 && (
                    <div className={cn("mx-1 h-px w-6", isCompleted ? "bg-emerald-400" : "bg-gray-200")} />
                  )}
                  <button
                    type="button"
                    onClick={() => (isCompleted || isCurrent) && setStep(s.id)}
                    className={cn(
                      "flex items-center gap-1.5 rounded-full px-2.5 py-1 text-sm font-medium transition-colors",
                      isCurrent && "bg-brand-50 text-brand-700",
                      isCompleted && "cursor-pointer bg-emerald-100 text-emerald-700 hover:bg-emerald-200",
                      !isCurrent && !isCompleted && "text-gray-400",
                    )}
                    disabled={!isCompleted && !isCurrent}
                  >
                    {isCompleted ? (
                      <Check className="h-3 w-3" />
                    ) : (
                      <span className="flex h-4 w-4 items-center justify-center rounded-full border text-xs">
                        {s.id}
                      </span>
                    )}
                    <span className="hidden sm:inline">{s.label}</span>
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Step content */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-3xl">
          {/* Home screen */}
          {mode === null && <HomeScreen onSelect={(m) => setMode(m)} />}

          {mode === "evaluation" && step === 1 && (
            <StepUploadJD
              jd={jd}
              jdFilename={jdFilename}
              jdSummary={jdSummary}
              onParsed={(parsedJd, docId, filename, summary) => {
                setJd(parsedJd);
                setJdDocumentId(docId);
                setJdFilename(filename);
                setJdSummary(summary);
              }}
              onJDChange={setJd}
            />
          )}

          {mode === "evaluation" && step === 2 && jd && jdDocumentId && (
            <StepUploadCVs
              jd={jd}
              jdDocumentId={jdDocumentId}
              candidates={candidates}
              onParsed={setCandidates}
            />
          )}

          {mode === "evaluation" && step === 3 && jd && (
            <StepRanking
              jd={jd}
              candidates={candidates}
              rankings={rankings}
              onRanked={(r, si, n) => {
                setRankings(r);
                setShortlistIndices(si);
                setTopN(n);
              }}
            />
          )}

          {mode === "evaluation" && step === 4 && jd && (
            <StepInterviewQuestions
              jd={jd}
              candidates={candidates}
              rankings={rankings}
              shortlistIndices={shortlistIndices}
              candidateQuestions={candidateQuestions}
              onGenerated={(cq, iq) => {
                setCandidateQuestions(cq);
                setInterviewQuestions(iq);
              }}
            />
          )}

          {mode === "evaluation" && step === 5 && jd && jdDocumentId && (
            <StepReport
              jd={jd}
              jdDocumentId={jdDocumentId}
              candidates={candidates}
              rankings={rankings}
              interviewQuestions={interviewQuestions}
              topN={topN}
              reportDocumentId={reportDocumentId}
              reportPreviewId={reportPreviewId}
              onGenerated={(docId, previewId) => {
                setReportDocumentId(docId);
                setReportPreviewId(previewId);
              }}
            />
          )}

          {/* Inline footer nav — evaluation mode only */}
          {mode === "evaluation" && (
            <div className="mt-8 flex items-center justify-between border-t border-gray-100 pt-4">
              {step > 1 ? (
                <Button variant="outline" onClick={handleBack}>
                  <ChevronLeft className="mr-1 h-4 w-4" />
                  {t("candidateEvaluation.nav.back")}
                </Button>
              ) : (
                <div />
              )}

              {step < 5 ? (
                <Button
                  onClick={handleNext}
                  disabled={!canGoNext(step)}
                  className="bg-brand-500 hover:bg-brand-600 text-white disabled:opacity-50"
                >
                  {t("candidateEvaluation.nav.next")}
                  <ChevronRight className="ml-1 h-4 w-4" />
                </Button>
              ) : (
                <Button
                  variant="outline"
                  onClick={() => {
                    setStep(1);
                    setJd(null);
                    setJdDocumentId(null);
                    setJdFilename(null);
                    setJdSummary(null);
                    setCandidates([]);
                    setRankings([]);
                    setShortlistIndices([]);
                    setTopN(5);
                    setCandidateQuestions([]);
                    setInterviewQuestions({});
                    setReportDocumentId(null);
                    setReportPreviewId(null);
                  }}
                >
                  <ChevronLeft className="mr-1 h-4 w-4" />
                  {t("candidateEvaluation.nav.newEvaluation")}
                </Button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
