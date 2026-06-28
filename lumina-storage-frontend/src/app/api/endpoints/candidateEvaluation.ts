import { axiosClient } from "../client";
import type {
  ParseJDResponse,
  ParseCVsResponse,
  MatchResponse,
  GenerateQuestionsResponse,
  GenerateReportResponse,
  ParsedJD,
  ParsedCandidate,
  CandidateRanking,
  InterviewQuestion,
  ColumnMappingItem,
  ScanToMasterListResponse,
  ReadMasterListHeadersResponse,
} from "@/app/types/candidateEvaluation";

const PREFIX = "/candidate-evaluation";

export const candidateEvaluationApi = {
  async parseJD(
    documentId: string,
    modelId?: string
  ): Promise<ParseJDResponse> {
    const { data } = await axiosClient.post<ParseJDResponse>(
      `${PREFIX}/parse-jd`,
      {
        document_id: documentId,
        model_id: modelId,
      }
    );
    return data;
  },

  async parseCVs(
    documentIds: string[],
    jd: ParsedJD,
    jdDocumentId: string,
    existingCandidates: ParsedCandidate[] = [],
    modelId?: string
  ): Promise<ParseCVsResponse> {
    const { data } = await axiosClient.post<ParseCVsResponse>(
      `${PREFIX}/parse-cvs`,
      {
        document_ids: documentIds,
        jd,
        jd_document_id: jdDocumentId,
        existing_candidates: existingCandidates,
        model_id: modelId,
      }
    );
    return data;
  },

  async match(
    jd: ParsedJD,
    candidates: ParsedCandidate[],
    topN: number = 5,
    modelId?: string
  ): Promise<MatchResponse> {
    const { data } = await axiosClient.post<MatchResponse>(`${PREFIX}/match`, {
      jd,
      candidates,
      top_n: topN,
      model_id: modelId,
    });
    return data;
  },

  async generateQuestions(
    jd: ParsedJD,
    candidates: ParsedCandidate[],
    rankings: CandidateRanking[],
    shortlistIndices: number[],
    candidateIndices?: number[],
    modelId?: string
  ): Promise<GenerateQuestionsResponse> {
    const { data } = await axiosClient.post<GenerateQuestionsResponse>(
      `${PREFIX}/generate-questions`,
      {
        jd,
        candidates,
        rankings,
        shortlist_indices: shortlistIndices,
        candidate_indices: candidateIndices,
        model_id: modelId,
      }
    );
    return data;
  },

  async readMasterListHeaders(
    masterListDocumentId: string
  ): Promise<ReadMasterListHeadersResponse> {
    const { data } = await axiosClient.post<ReadMasterListHeadersResponse>(
      `${PREFIX}/read-master-list-headers`,
      { master_list_document_id: masterListDocumentId }
    );
    return data;
  },

  async scanToMasterList(
    documentIds: string[],
    columnMapping: ColumnMappingItem[],
    masterListDocumentId?: string,
    modelId?: string
  ): Promise<ScanToMasterListResponse> {
    const { data } = await axiosClient.post<ScanToMasterListResponse>(
      `${PREFIX}/scan-to-master-list`,
      {
        document_ids: documentIds,
        master_list_document_id: masterListDocumentId ?? null,
        column_mapping: columnMapping,
        model_id: modelId,
      }
    );
    return data;
  },

  async generateReport(
    jd: ParsedJD,
    candidates: ParsedCandidate[],
    rankings: CandidateRanking[],
    interviewQuestions: Record<string, InterviewQuestion[]>,
    jdDocumentId: string,
    topN: number = 5,
    modelId?: string
  ): Promise<GenerateReportResponse> {
    const { data } = await axiosClient.post<GenerateReportResponse>(
      `${PREFIX}/generate-report`,
      {
        jd,
        candidates,
        rankings,
        interview_questions: interviewQuestions,
        jd_document_id: jdDocumentId,
        top_n: topN,
        model_id: modelId,
      }
    );
    return data;
  },
};
