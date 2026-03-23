"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";

import { ApiError, apiRequest } from "@/lib/api";
import { cancelTask, exportTaskResults, NotLoggedInError } from "@/lib/task";
import {
  createBatchTaskSseHandlers,
  INITIAL_TASK_PROGRESS,
  openTaskEventSource,
  parseTaskRecovery,
} from "@/lib/task-sse";
import { recordRecentTask } from "@/lib/recent-tasks";
import { Link } from "@/i18n/navigation";
import DashboardPageHeader from "@/components/dashboard/page-header";
import { Button } from "@/components/ui/button";
import TaskProgressLogPanel, { TaskLogRow } from "@/components/task/task-progress-log-panel";

type ProgressEventData = {
  current: number;
  total: number;
  domain?: string;
  status?: "success" | "error";
  message?: string;
  fatal?: boolean;
};

type CompleteEventData = {
  success: number;
  failed: number;
  total: number;
  status?: string;
};

export default function TaskDetailPage() {
  const t = useTranslations("Tasks");
  const common = useTranslations("Common");
  const params = useParams<{ id?: string }>();

  const taskId = useMemo(() => {
    const raw = params?.id;
    if (!raw) return "";
    return String(raw).trim();
  }, [params]);

  const [status, setStatus] = useState("");
  const [running, setRunning] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [progress, setProgress] = useState(INITIAL_TASK_PROGRESS);
  const [logs, setLogs] = useState<TaskLogRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  const eventSourceRef = useRef<EventSource | null>(null);

  function startSse(id: string, opts?: { cursor?: number; historyEnd?: number }) {
    eventSourceRef.current?.close();
    eventSourceRef.current = openTaskEventSource<ProgressEventData, CompleteEventData>(
      id,
      opts,
      createBatchTaskSseHandlers<ProgressEventData, CompleteEventData, TaskLogRow>({
        reconnectingMessage: common("sseReconnecting"),
        fatalMessageFallback: common("fatalError"),
        setError,
        setRunning,
        setProgress,
        setLogs,
        buildLogRow: (data) => ({ domain: data.domain!, status: data.status!, message: data.message || "" }),
        onCompleteExtra: (data) => {
          if (data?.status) setStatus(String(data.status));
        },
      })
    );
  }

  async function recoverTask(id: string) {
    if (!id) return;
    try {
      const task = await apiRequest<Record<string, unknown>>(`/api/v1/tasks/${id}`, { method: "GET" });
      const snapshot = parseTaskRecovery(task);

      setStatus(snapshot.status);
      setProgress(snapshot.progress);
      setRunning(snapshot.running);
      setLogs([]);
      setError(null);
      startSse(id, { cursor: snapshot.cursorStart, historyEnd: snapshot.historyEnd });
    } catch (e: unknown) {
      setError(e instanceof ApiError ? e.message : common("unknownError"));
    }
  }

  useEffect(() => {
    if (!taskId) return;
    recordRecentTask(taskId);
    void recoverTask(taskId);
    return () => {
      eventSourceRef.current?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId]);

  async function onExportResults() {
    if (!taskId) return;
    setExporting(true);
    setError(null);
    try {
      await exportTaskResults(taskId);
    } catch (e: unknown) {
      if (e instanceof NotLoggedInError) {
        setError(common("notLoggedIn"));
        return;
      }
      setError(e instanceof ApiError ? e.message : common("unknownError"));
    } finally {
      setExporting(false);
    }
  }

  async function onCancelTask() {
    if (!taskId) return;
    setCancelling(true);
    setError(null);
    try {
      await cancelTask(taskId);
      await recoverTask(taskId);
    } catch (e: unknown) {
      setError(e instanceof ApiError ? e.message : common("unknownError"));
    } finally {
      setCancelling(false);
    }
  }

  const statusLabel = useMemo(() => {
    const s = (status || "").toLowerCase();
    if (s === "completed") return t("statusCompleted");
    if (s === "cancelled") return t("statusCancelled");
    if (s === "cancelling") return t("statusCancelling");
    if (s === "pending") return t("statusPending");
    if (s === "running") return t("statusRunning");
    return status ? status : t("statusUnknown");
  }, [status, t]);

  return (
    <div className="space-y-6">
      <DashboardPageHeader title={t("detailTitle")} subtitle={taskId || t("detailSubtitle")} />

      <div className="rounded-[28px] zen-surface p-6 space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild variant="secondary">
            <Link href="/tasks">{t("back")}</Link>
          </Button>
          <Button variant="secondary" onClick={() => void recoverTask(taskId)} disabled={!taskId}>
            {t("refresh")}
          </Button>
          <Button variant="secondary" onClick={() => void onExportResults()} disabled={!taskId || exporting}>
            {exporting ? common("loading") : common("exportResultsCsv")}
          </Button>
          <Button variant="destructive" onClick={() => void onCancelTask()} disabled={!taskId || !running || cancelling}>
            {cancelling ? common("loading") : common("cancelTask")}
          </Button>
        </div>

        <div className="text-xs text-muted-foreground">
          {t("status")}: {statusLabel} · {t("progress")} {progress.total ? `${progress.current}/${progress.total}` : ""} ·{" "}
          {common("success")}: {progress.success} · {common("failed")}: {progress.failed}
        </div>
        {error ? <div className="text-sm text-destructive">{error}</div> : null}
      </div>

      <TaskProgressLogPanel
        title={
          <span className="flex items-center gap-2">
            <span>{t("logs")}</span>
            <span className="text-xs font-normal text-muted-foreground">{running ? t("live") : t("idle")}</span>
          </span>
        }
        progress={progress}
        running={running}
        logs={logs}
        emptyText={t("emptyLogs")}
        loadingText={common("loading")}
        successLabel={common("success")}
        failedLabel={common("failed")}
        statusLabel={(s) => common(s)}
      />
    </div>
  );
}
