"use client";

export type RecentTaskItem = {
  taskId: string;
  formKey?: string;
  namespace?: string;
  seenAt: number;
};

const TASKS_KEY = "cf_toolkit:tasks:recent";
const FORM_PREFIX = "cf_toolkit:form:";
const MAX_ITEMS = 50;

function safeParseJson(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function getNamespaceFromFormKey(formKey?: string): string | undefined {
  const key = String(formKey || "");
  if (!key.startsWith(FORM_PREFIX)) return undefined;
  const ns = key.slice(FORM_PREFIX.length).trim();
  return ns || undefined;
}

export function loadRecentTasks(): RecentTaskItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(TASKS_KEY);
    if (!raw) return [];
    const data = safeParseJson(raw);
    if (!Array.isArray(data)) return [];
    const items: RecentTaskItem[] = [];
    for (const x of data) {
      if (!x || typeof x !== "object") continue;
      const obj = x as Record<string, unknown>;
      const taskId = String(obj.taskId || "").trim();
      if (!taskId) continue;
      const seenAt = Number(obj.seenAt);
      const formKey = typeof obj.formKey === "string" ? obj.formKey : undefined;
      const namespace =
        typeof obj.namespace === "string" ? obj.namespace : getNamespaceFromFormKey(formKey);
      items.push({
        taskId,
        formKey,
        namespace,
        seenAt: Number.isFinite(seenAt) ? Math.floor(seenAt) : 0,
      });
    }
    return items;
  } catch {
    return [];
  }
}

export function saveRecentTasks(items: RecentTaskItem[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(TASKS_KEY, JSON.stringify(items));
  } catch {
    // ignore quota/security errors
  }
}

export function recordRecentTask(taskId: string, meta?: { formKey?: string; namespace?: string }): void {
  if (typeof window === "undefined") return;
  const id = String(taskId || "").trim();
  if (!id) return;

  const now = Date.now();
  const prev = loadRecentTasks();
  const existing = prev.find((x) => x.taskId === id);
  const formKey = meta?.formKey ? String(meta.formKey) : existing?.formKey;
  const namespace = meta?.namespace ? String(meta.namespace) : existing?.namespace || getNamespaceFromFormKey(formKey);

  const next: RecentTaskItem[] = [
    { taskId: id, formKey, namespace, seenAt: now },
    ...prev.filter((x) => x.taskId !== id),
  ];
  saveRecentTasks(next.slice(0, MAX_ITEMS));
}

export function removeRecentTask(taskId: string): void {
  if (typeof window === "undefined") return;
  const id = String(taskId || "").trim();
  if (!id) return;
  const prev = loadRecentTasks();
  const next = prev.filter((x) => x.taskId !== id);
  saveRecentTasks(next);
}

export function clearRecentTasks(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(TASKS_KEY);
  } catch {
    // ignore
  }
}

export function recordRecentTaskFromFormCache(formKey: string, formValue: unknown): void {
  if (typeof window === "undefined") return;
  try {
    if (!formValue || typeof formValue !== "object") return;
    const obj = formValue as Record<string, unknown>;
    const taskId = String(obj.taskId || "").trim();
    if (!taskId) return;
    recordRecentTask(taskId, { formKey, namespace: getNamespaceFromFormKey(formKey) });
  } catch {
    // ignore
  }
}

export function seedRecentTasksFromFormCaches(): RecentTaskItem[] {
  if (typeof window === "undefined") return [];
  try {
    const now = Date.now();
    const seen = new Set<string>();
    const collected: RecentTaskItem[] = [];
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const key = window.localStorage.key(i);
      if (!key || !key.startsWith(FORM_PREFIX)) continue;
      const raw = window.localStorage.getItem(key);
      if (!raw) continue;
      const data = safeParseJson(raw);
      if (!data || typeof data !== "object") continue;
      const obj = data as Record<string, unknown>;
      const taskId = String(obj.taskId || "").trim();
      if (!taskId || seen.has(taskId)) continue;
      seen.add(taskId);
      collected.push({ taskId, formKey: key, namespace: getNamespaceFromFormKey(key), seenAt: now });
    }
    if (!collected.length) return [];
    const prev = loadRecentTasks();
    const merged = [...collected, ...prev.filter((x) => !seen.has(x.taskId))].slice(0, MAX_ITEMS);
    saveRecentTasks(merged);
    return merged;
  } catch {
    return [];
  }
}
