"use client";

import { ReactNode } from "react";

import { TaskProgressState } from "@/lib/task-sse";
import { Skeleton } from "@/components/ui/skeleton";

export type TaskLogRow = {
  domain: string;
  status: "success" | "error";
  message: string;
  details?: string[];
};

type Props = {
  title: ReactNode;
  progress: TaskProgressState;
  running: boolean;
  logs: TaskLogRow[];
  emptyText: string;
  loadingText: string;
  successLabel: string;
  failedLabel: string;
  statusLabel: (status: TaskLogRow["status"]) => string;
};

export default function TaskProgressLogPanel(props: Props) {
  const { title, progress, running, logs, emptyText, loadingText, successLabel, failedLabel, statusLabel } = props;

  return (
    <div className="rounded-[28px] zen-surface overflow-hidden">
      <div className="flex items-center justify-between border-b zen-divider px-6 py-4">
        <div className="text-base font-semibold text-foreground">
          {title} {progress.total ? `${progress.current}/${progress.total}` : ""}
        </div>
        <div className="text-xs text-muted-foreground">
          {successLabel}: {progress.success} · {failedLabel}: {progress.failed}
        </div>
      </div>
      <div className="p-6 min-h-[18rem]">
        {logs.length === 0 ? (
          running ? (
            <div className="space-y-2" aria-busy="true" aria-live="polite">
              {Array.from({ length: 6 }).map((_, idx) => (
                <div key={idx} className="flex flex-col justify-between gap-1 rounded-2xl zen-surface-subtle p-4 md:flex-row md:items-center">
                  <div className="min-w-0 space-y-2">
                    <Skeleton className="h-6 w-64 max-w-full" />
                    <Skeleton className="h-4 w-96 max-w-full" />
                  </div>
                  <Skeleton className="h-5 w-20 rounded-full" />
                </div>
              ))}
              <div className="text-xs text-muted-foreground">{loadingText}</div>
            </div>
          ) : (
            <div className="text-sm text-muted-foreground">{emptyText}</div>
          )
        ) : (
          <div className="space-y-2">
            {logs.map((r, idx) => (
              <div
                key={`${r.domain}-${idx}`}
                className="flex flex-col justify-between gap-1 rounded-2xl zen-surface-subtle p-4 md:flex-row md:items-center"
              >
                <div className="min-w-0">
                  <div className="truncate text-lg font-semibold text-foreground">{r.domain}</div>
                  <div className="mt-1 text-xs text-muted-foreground">{r.message}</div>
                  {r.details?.length
                    ? r.details.map((line, i) => (
                        <div key={`${r.domain}-${idx}-d-${i}`} className="mt-1 text-xs text-muted-foreground">
                          {line}
                        </div>
                      ))
                    : null}
                </div>
                <div className={r.status === "success" ? "text-xs text-emerald-700" : "text-xs text-destructive"}>
                  {statusLabel(r.status)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

