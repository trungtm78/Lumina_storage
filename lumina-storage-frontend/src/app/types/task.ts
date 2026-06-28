export interface BackgroundTaskResponse {
  id: string;
  job_id: string;
  status: "pending" | "running" | "success" | "failure" | "revoked";
  task_name: string;
  result: Record<string, unknown> | null;
  error_message: string | null;
  related_type: string | null;
  related_id: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

export interface TaskListParams {
  page?: number;
  page_size?: number;
  status?: string;
  task_name?: string;
}
