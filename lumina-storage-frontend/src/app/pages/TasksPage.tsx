import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Loader2, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { tasksApi } from "@/app/api/endpoints/tasks";
import type { BackgroundTaskResponse, TaskListParams } from "@/app/types/api";
import { formatDistanceToNow, parseISO, differenceInSeconds } from "date-fns";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/app/components/ui/select";
import { SearchFilterBar } from "@/app/components/ui/search-filter-bar";
import { PaginationBar } from "@/app/components/ui/pagination-bar";

const STATUS_OPTIONS = [
  "",
  "pending",
  "running",
  "success",
  "failure",
  "revoked",
] as const;
const TASK_NAME_OPTIONS = [
  "",
  "ingest_document",
  "generate_thumbnail",
  "ping",
] as const;

function StatusBadge({ status }: { status: BackgroundTaskResponse["status"] }) {
  const { t } = useTranslation();
  const cfg: Record<string, string> = {
    pending: "bg-gray-100 text-gray-600",
    running: "bg-blue-100 text-blue-700",
    success: "bg-green-100 text-green-700",
    failure: "bg-red-100 text-red-700",
    revoked: "bg-yellow-100 text-yellow-700",
  };
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${cfg[status] ?? "bg-gray-100 text-gray-600"}`}
    >
      {status === "running" && <Loader2 className="h-3 w-3 animate-spin" />}
      {t(`tasks.statuses.${status}`, { defaultValue: status })}
    </span>
  );
}

function duration(task: BackgroundTaskResponse): string {
  if (!task.started_at) return "—";
  const end = task.completed_at ? parseISO(task.completed_at) : new Date();
  const secs = differenceInSeconds(end, parseISO(task.started_at));
  if (secs < 60) return `${secs}s`;
  return `${Math.floor(secs / 60)}m ${secs % 60}s`;
}

function TaskRow({ task }: { task: BackgroundTaskResponse }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const hasDetail = task.result !== null || task.error_message !== null;

  return (
    <>
      <tr
        className={`border-b border-gray-100 transition-colors hover:bg-red-50/30 ${hasDetail ? "cursor-pointer" : ""}`}
        onClick={() => hasDetail && setExpanded((v) => !v)}
      >
        <td className="px-4 py-3">
          {hasDetail ? (
            expanded ? (
              <ChevronDown className="h-3.5 w-3.5 text-gray-400" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 text-gray-400" />
            )
          ) : (
            <span className="inline-block h-3.5 w-3.5" />
          )}
        </td>
        <td className="px-4 py-3 font-mono text-sm text-gray-700">
          {task.task_name}
        </td>
        <td className="px-4 py-3">
          <StatusBadge status={task.status} />
        </td>
        <td className="px-4 py-3 text-sm text-gray-500">
          {task.related_type ? (
            <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs">
              {task.related_type}
            </span>
          ) : (
            "—"
          )}
        </td>
        <td className="px-4 py-3 text-sm text-gray-500">
          {formatDistanceToNow(parseISO(task.created_at), { addSuffix: true })}
        </td>
        <td className="px-4 py-3 text-sm text-gray-500">{duration(task)}</td>
      </tr>
      {expanded && (
        <tr className="border-b border-gray-100 bg-gray-50">
          <td colSpan={6} className="px-8 py-3">
            {task.error_message && (
              <div className="mb-2">
                <p className="mb-1 text-xs font-semibold text-red-600">{t("tasks.error")}</p>
                <pre className="overflow-x-auto rounded bg-red-50 p-2 text-xs whitespace-pre-wrap text-red-700">
                  {task.error_message}
                </pre>
              </div>
            )}
            {task.result && (
              <div>
                <p className="mb-1 text-xs font-semibold text-gray-500">
                  {t("tasks.result")}
                </p>
                <pre className="overflow-x-auto rounded border border-gray-200 bg-white p-2 text-xs text-gray-700">
                  {JSON.stringify(task.result, null, 2)}
                </pre>
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

export function TasksPage() {
  const { t } = useTranslation();
  const [params, setParams] = useState<TaskListParams>({
    page: 1,
    page_size: 20,
  });

  const { data, isFetching, refetch } = useQuery({
    queryKey: ["tasks", params],
    queryFn: () => tasksApi.list(params),
    refetchInterval: 5000,
  });

  const totalPages = data
    ? Math.ceil(data.total / (params.page_size ?? 20))
    : 1;

  return (
    <div className="flex-1 overflow-auto p-6">
      <div className="mx-auto max-w-6xl">
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-gray-900">{t("tasks.title")}</h1>
            <p className="mt-0.5 text-sm text-gray-500">
              {t("tasks.autoRefreshNote")}
            </p>
          </div>
          <button
            onClick={() => refetch()}
            className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-600 transition-colors hover:bg-gray-50 hover:text-gray-900"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`}
            />
            {t("tasks.refresh")}
          </button>
        </div>

        {/* Filters */}
        <SearchFilterBar
          hideSearch
          className="mb-4"
          filters={
            <>
              <Select
                value={params.status ?? "__all__"}
                onValueChange={(v) =>
                  setParams((p) => ({
                    ...p,
                    page: 1,
                    status: v === "__all__" ? undefined : v,
                  }))
                }
              >
                <SelectTrigger className="w-[160px] text-sm">
                  <SelectValue placeholder={t("tasks.allStatus")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">{t("tasks.allStatus")}</SelectItem>
                  {STATUS_OPTIONS.filter(Boolean).map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select
                value={params.task_name ?? "__all__"}
                onValueChange={(v) =>
                  setParams((p) => ({
                    ...p,
                    page: 1,
                    task_name: v === "__all__" ? undefined : v,
                  }))
                }
              >
                <SelectTrigger className="w-[180px] text-sm">
                  <SelectValue placeholder={t("tasks.allTask")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">{t("tasks.allTask")}</SelectItem>
                  {TASK_NAME_OPTIONS.filter(Boolean).map((n) => (
                    <SelectItem key={n} value={n}>
                      {n}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </>
          }
          trailing={
            data ? (
              <span className="text-sm text-gray-400">
                {t("tasks.taskCount", { count: data.total })}
              </span>
            ) : undefined
          }
        />

        {/* Table */}
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50 text-xs text-gray-500">
                <th className="w-8 px-4 py-2.5" />
                <th className="px-4 py-2.5 text-left font-medium">{t("tasks.task")}</th>
                <th className="px-4 py-2.5 text-left font-medium">{t("common.status")}</th>
                <th className="px-4 py-2.5 text-left font-medium">{t("common.type")}</th>
                <th className="px-4 py-2.5 text-left font-medium">{t("tasks.createdAt")}</th>
                <th className="px-4 py-2.5 text-left font-medium">{t("tasks.duration")}</th>
              </tr>
            </thead>
            <tbody>
              {data?.items.map((task) => (
                <TaskRow key={task.id} task={task} />
              ))}
              {data?.items.length === 0 && (
                <tr>
                  <td
                    colSpan={6}
                    className="px-4 py-12 text-center text-sm text-gray-400"
                  >
                    {t("tasks.noTasks")}
                  </td>
                </tr>
              )}
              {!data && isFetching && (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center">
                    <Loader2 className="mx-auto h-5 w-5 animate-spin text-gray-400" />
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <PaginationBar
          page={params.page ?? 1}
          totalPages={totalPages}
          total={data?.total ?? 0}
          pageSize={params.page_size ?? 20}
          onPageChange={(p) => setParams((prev) => ({ ...prev, page: p }))}
          className="mt-4 px-0"
        />
      </div>
    </div>
  );
}
