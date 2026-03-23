import { ApiError, apiRequest } from "./api";
import { downloadFromApi } from "./download";

export class NotLoggedInError extends Error {
  constructor() {
    super("NOT_LOGGED_IN");
    this.name = "NotLoggedInError";
  }
}

export async function exportTaskResults(taskId: string): Promise<void> {
  try {
    await downloadFromApi(`/api/v1/tasks/${taskId}/export`, `task-${taskId}.csv`);
  } catch (e: unknown) {
    if (e instanceof ApiError && e.status === 401) throw new NotLoggedInError();
    throw e;
  }
}

export function getTaskStreamUrl(taskId: string): string {
  return `/api/v1/tasks/${taskId}/stream`;
}

export function getTaskStreamUrlWithCursor(taskId: string, cursor?: number): string {
  const base = getTaskStreamUrl(taskId);
  if (cursor === undefined || cursor === null) return base;
  const n = Number(cursor);
  if (!Number.isFinite(n) || n < 0) return base;
  return `${base}?cursor=${encodeURIComponent(String(Math.floor(n)))}`;
}

export async function cancelTask(taskId: string): Promise<void> {
  await apiRequest(`/api/v1/tasks/${taskId}/cancel`, { method: "POST" });
}
