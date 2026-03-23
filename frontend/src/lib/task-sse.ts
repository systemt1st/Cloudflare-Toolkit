"use client";

import { refreshAccessToken } from "./api";
import { getTaskStreamUrlWithCursor } from "./task";

export type TaskSseOptions = {
  cursor?: number;
  historyEnd?: number;
};

export type TaskSseMeta = {
  cursor?: number;
  isHistory: boolean;
};

export type TaskSseHandlers<TProgress = any, TComplete = any> = {
  onOpen?: () => void;
  onProgress?: (data: TProgress, meta: TaskSseMeta) => void;
  onComplete?: (data: TComplete | null) => void;
  onError?: () => void;
  onFatal?: (data: TProgress) => void;
};

function safeJsonParse<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function parseCursor(lastEventId: string | null | undefined): number | undefined {
  if (!lastEventId) return undefined;
  const n = Number(lastEventId);
  if (!Number.isFinite(n)) return undefined;
  return Math.floor(n);
}

export function openTaskEventSource<TProgress = any, TComplete = any>(
  taskId: string,
  opts: TaskSseOptions | undefined,
  handlers: TaskSseHandlers<TProgress, TComplete>
): EventSource {
  const url = getTaskStreamUrlWithCursor(taskId, opts?.cursor);
  const historyEnd = opts?.historyEnd;
  const es = new EventSource(url, { withCredentials: true });

  let probeInFlight = false;
  let probeBackoffMs = 500;
  let nextProbeAt = 0;

  async function probeAuth(): Promise<void> {
    if (probeInFlight) return;
    const now = Date.now();
    if (now < nextProbeAt) return;

    probeInFlight = true;
    nextProbeAt = now + probeBackoffMs;
    probeBackoffMs = Math.min(Math.floor(probeBackoffMs * 1.5), 5000);

    try {
      const res = await fetch(`/api/v1/tasks/${encodeURIComponent(taskId)}`, { method: "GET", credentials: "include" });
      if (res.status === 401 || res.status === 403) {
        await refreshAccessToken();
        return;
      }
      if (res.ok) {
        probeBackoffMs = 500;
      }
    } catch {
      // ignore
    } finally {
      probeInFlight = false;
    }
  }

  es.onopen = () => {
    probeBackoffMs = 500;
    nextProbeAt = 0;
    handlers.onOpen?.();
  };

  es.addEventListener("progress", (evt) => {
    const cursor = parseCursor((evt as MessageEvent).lastEventId);
    const isHistory =
      typeof historyEnd === "number" && Number.isFinite(historyEnd) && cursor !== undefined && cursor <= historyEnd;

    const data = safeJsonParse<TProgress>((evt as MessageEvent).data);
    if (!data) return;

    handlers.onProgress?.(data, { cursor, isHistory });
    if ((data as any)?.fatal) {
      handlers.onFatal?.(data);
      es.close();
    }
  });

  es.addEventListener("complete", (evt) => {
    const data = safeJsonParse<TComplete>((evt as MessageEvent).data);
    handlers.onComplete?.(data);
    es.close();
  });

  es.onerror = () => {
    handlers.onError?.();
    void probeAuth();
  };

  return es;
}

export type TaskRecoverySnapshot = {
  status: string;
  running: boolean;
  progress: { current: number; total: number; success: number; failed: number };
  historyEnd: number;
  cursorStart: number;
};

function toInt(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.floor(n);
}

export function parseTaskRecovery(task: Record<string, unknown>, historyTail: number = 200): TaskRecoverySnapshot {
  const status = String(task.status || "").toLowerCase();
  const total = toInt(task.total);
  const current = toInt(task.current);
  const success = toInt(task.success);
  const failed = toInt(task.failed);
  const eventSeq = Number(task.event_seq);
  const eventOffset = toInt(task.event_offset);
  const historyEnd = Number.isFinite(eventSeq) ? Math.floor(eventSeq) : -1;
  const tail = Math.max(0, Math.floor(Number(historyTail) || 200));
  const cursorStart = Math.max(eventOffset, historyEnd - tail);
  const running = status === "running" || status === "pending" || status === "cancelling";
  return {
    status,
    running,
    progress: { current, total, success, failed },
    historyEnd,
    cursorStart,
  };
}

export type TaskProgressState = { current: number; total: number; success: number; failed: number };

export type SetState<T> = (value: T | ((prev: T) => T)) => void;

type Ref<T> = { current: T };

export const INITIAL_TASK_PROGRESS: TaskProgressState = { current: 0, total: 0, success: 0, failed: 0 };

export function resetFailedDomains(ref: { current: Set<string> }, setFailedCount: (n: number) => void): void {
  ref.current = new Set();
  setFailedCount(0);
}

type BatchTaskSseBaseProgress = {
  current: number;
  total: number;
  domain?: string;
  status?: "success" | "error";
  message?: string;
  fatal?: boolean;
};

type BatchTaskSseBaseComplete = {
  success: number;
  failed: number;
  total: number;
  status?: string;
};

type BatchTaskSseCommonOptions<TProgress extends BatchTaskSseBaseProgress, TComplete extends BatchTaskSseBaseComplete> = {
  reconnectingMessage: string;
  fatalMessageFallback: string;

  setError: (value: string | null) => void;
  setRunning: (value: boolean) => void;
  setProgress: SetState<TaskProgressState>;

  onOpenExtra?: () => void;
  onProgressExtra?: (data: TProgress, meta: TaskSseMeta) => void;
  onFatalExtra?: (data: TProgress) => void;
  onCompleteExtra?: (data: TComplete | null) => void;
};

type BatchTaskSseLogOptions<TProgress extends BatchTaskSseBaseProgress, TLogRow> =
  | {
      setLogs: SetState<TLogRow[]>;
      buildLogRow: (data: TProgress) => TLogRow | null;
      logLimit?: number;
    }
  | {
      setLogs?: undefined;
      buildLogRow?: undefined;
      logLimit?: number;
    };

type BatchTaskSseFailedOptions =
  | { failedDomainsRef: Ref<Set<string>>; setFailedCount: (n: number) => void }
  | { failedDomainsRef?: undefined; setFailedCount?: undefined };

export function createBatchTaskSseHandlers<
  TProgress extends BatchTaskSseBaseProgress,
  TComplete extends BatchTaskSseBaseComplete,
  TLogRow,
>(
  options: BatchTaskSseCommonOptions<TProgress, TComplete> &
    BatchTaskSseLogOptions<TProgress, TLogRow> &
    BatchTaskSseFailedOptions
): TaskSseHandlers<TProgress, TComplete> {
  const logLimit = Math.max(0, Math.floor(Number(options.logLimit) || 200));

  return {
    onOpen: () => {
      options.setError(null);
      options.onOpenExtra?.();
    },
    onProgress: (data, meta) => {
      if (!meta.isHistory) {
        options.setProgress((p) => {
          const isSuccess = data.status === "success";
          return {
            current: data.current ?? p.current,
            total: data.total ?? p.total,
            success: p.success + (isSuccess ? 1 : 0),
            failed: p.failed + (!isSuccess ? 1 : 0),
          };
        });
      }

      if (options.setLogs && options.buildLogRow && data.domain && data.status) {
        const row = options.buildLogRow(data);
        if (row) {
          options.setLogs((prev) => {
            const next = [...prev, row];
            return logLimit > 0 && next.length > logLimit ? next.slice(-logLimit) : next;
          });
        }
      }

      if (
        options.failedDomainsRef &&
        options.setFailedCount &&
        data.domain &&
        data.status === "error"
      ) {
        options.failedDomainsRef.current.add(data.domain);
        options.setFailedCount(options.failedDomainsRef.current.size);
      }

      options.onProgressExtra?.(data, meta);
    },
    onFatal: (data) => {
      options.setError(data.message || options.fatalMessageFallback);
      options.setRunning(false);
      options.onFatalExtra?.(data);
    },
    onComplete: (data) => {
      if (data) {
        options.setProgress((p) => ({
          ...p,
          success: data.success,
          failed: data.failed,
          total: data.total,
          current: data.total,
        }));
      }
      options.setRunning(false);
      options.onCompleteExtra?.(data);
    },
    onError: () => options.setError(options.reconnectingMessage),
  };
}
