"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";

import { ApiError, apiRequest } from "@/lib/api";
import { buildFormCacheKey, loadFormCache, saveFormCache } from "@/lib/form-cache";
import { cancelTask, exportTaskResults, NotLoggedInError } from "@/lib/task";
import { Link, useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import DashboardPageHeader from "@/components/dashboard/page-header";

type Account = {
  id: string;
  name: string;
};

type TaskListItem = {
  task_id: string;
  status: string;
  type: string;
  current: number;
  total: number;
  success: number;
  failed: number;
  cancelled: number;
  created_at?: string;
  finished_at?: string;
  metadata?: Record<string, unknown>;
};

type TaskListResponse = {
  items: TaskListItem[];
  total: number;
  limit: number;
  offset: number;
};

type RetryFailedResponse = {
  task_id: string;
  total: number;
};

function toStr(value: unknown): string {
  return String(value || "").trim();
}

export default function TaskCenterPage() {
  const t = useTranslations("Tasks");
  const nav = useTranslations("Nav");
  const common = useTranslations("Common");
  const router = useRouter();

  const [accounts, setAccounts] = useState<Account[]>([]);
  const accountNameMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const a of accounts) map[a.id] = a.name;
    return map;
  }, [accounts]);

  const [items, setItems] = useState<TaskListItem[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exportingIds, setExportingIds] = useState<Set<string>>(new Set());
  const [cancellingIds, setCancellingIds] = useState<Set<string>>(new Set());
  const [retryingIds, setRetryingIds] = useState<Set<string>>(new Set());

  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "running" | "failed">("all");
  const [autoRefresh, setAutoRefresh] = useState(true);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const loadingRef = useRef(false);

  function getToolMetaByType(type?: string): { label: string; href: string; formNamespace: string; lastAction?: "clone" | "delete" } | null {
    const t0 = String(type || "").trim();
    switch (t0) {
      case "domain_add":
        return { label: nav("domainsAdd"), href: "/domains/add", formNamespace: "domains.add" };
      case "domain_delete":
        return { label: nav("domainsDelete"), href: "/domains/delete", formNamespace: "domains.delete" };
      case "dns_resolve":
        return { label: nav("dnsResolve"), href: "/dns/resolve", formNamespace: "dns.resolve" };
      case "dns_replace":
        return { label: nav("dnsReplace"), href: "/dns/replace", formNamespace: "dns.replace" };
      case "dns_delete":
        return { label: nav("dnsDelete"), href: "/dns/delete", formNamespace: "dns.delete" };
      case "dns_proxy":
        return { label: nav("dnsProxy"), href: "/dns/proxy", formNamespace: "dns.proxy" };
      case "cache_batch":
        return { label: nav("cacheBatch"), href: "/cache/batch", formNamespace: "cache.batch" };
      case "cache_purge":
        return { label: nav("cachePurge"), href: "/cache/purge", formNamespace: "cache.purge" };
      case "ssl_batch":
        return { label: nav("sslBatch"), href: "/ssl/batch", formNamespace: "ssl.batch" };
      case "speed_batch":
        return { label: nav("speedBatch"), href: "/speed/batch", formNamespace: "speed.batch" };
      case "other_batch":
        return { label: nav("otherBatch"), href: "/other/batch", formNamespace: "other.batch" };
      case "rules_clone":
        return { label: nav("rules"), href: "/rules", formNamespace: "rules", lastAction: "clone" };
      case "rules_delete":
        return { label: nav("rules"), href: "/rules", formNamespace: "rules", lastAction: "delete" };
      default:
        return null;
    }
  }

  function isRunningStatus(status: string): boolean {
    const s = (status || "").toLowerCase();
    return s === "running" || s === "pending" || s === "cancelling";
  }

  function formatStatus(status: string): { label: string; className: string } {
    const s = (status || "").toLowerCase();
    if (s === "completed") return { label: t("statusCompleted"), className: "text-emerald-700" };
    if (s === "cancelled") return { label: t("statusCancelled"), className: "text-muted-foreground" };
    if (s === "cancelling") return { label: t("statusCancelling"), className: "text-muted-foreground" };
    if (s === "pending") return { label: t("statusPending"), className: "text-muted-foreground" };
    if (s === "running") return { label: t("statusRunning"), className: "text-blue-700" };
    return { label: status || t("statusUnknown"), className: "text-muted-foreground" };
  }

  function formatMode(task: TaskListItem): string {
    const meta = task.metadata || {};
    const mode = toStr(meta.mode);
    if (mode) return mode;
    const source = toStr(meta.source_domain);
    if (source) return source;
    return "-";
  }

  async function loadAccounts() {
    try {
      const data = await apiRequest<Account[]>("/api/v1/accounts", { method: "GET" });
      setAccounts(data);
    } catch {
      // ignore
    }
  }

  async function refresh() {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setLoadingList(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: "200", offset: "0" });
      if (query.trim()) params.set("q", query.trim());
      const data = await apiRequest<TaskListResponse>(`/api/v1/tasks?${params.toString()}`, { method: "GET" });
      setItems(data.items || []);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : common("unknownError"));
    } finally {
      setLoadingList(false);
      loadingRef.current = false;
    }
  }

  useEffect(() => {
    void loadAccounts();
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filteredItems = useMemo(() => {
    if (filter === "running") return items.filter((x) => isRunningStatus(x.status));
    if (filter === "failed") return items.filter((x) => (x.failed || 0) > 0);
    return items;
  }, [filter, items]);

  const hasRunning = useMemo(() => items.some((x) => isRunningStatus(x.status)), [items]);

  useEffect(() => {
    if (!autoRefresh) return;
    if (!hasRunning) return;
    const timer = window.setInterval(() => {
      void refresh();
    }, 3000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRefresh, hasRunning]);

  function toggleSelected(id: string, checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function selectAllCurrent(checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) {
        for (const x of filteredItems) next.add(x.task_id);
      } else {
        for (const x of filteredItems) next.delete(x.task_id);
      }
      return next;
    });
  }

  const allCurrentSelected = useMemo(() => {
    if (filteredItems.length === 0) return false;
    return filteredItems.every((x) => selected.has(x.task_id));
  }, [filteredItems, selected]);

  const selectedItems = useMemo(() => filteredItems.filter((x) => selected.has(x.task_id)), [filteredItems, selected]);

  async function onExport(taskId: string) {
    setExportingIds((prev) => new Set(prev).add(taskId));
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
      setExportingIds((prev) => {
        const next = new Set(prev);
        next.delete(taskId);
        return next;
      });
    }
  }

  async function onCancel(taskId: string) {
    setCancellingIds((prev) => new Set(prev).add(taskId));
    setError(null);
    try {
      await cancelTask(taskId);
      await refresh();
    } catch (e: unknown) {
      setError(e instanceof ApiError ? e.message : common("unknownError"));
    } finally {
      setCancellingIds((prev) => {
        const next = new Set(prev);
        next.delete(taskId);
        return next;
      });
    }
  }

  async function onRetryFailed(taskId: string) {
    setRetryingIds((prev) => new Set(prev).add(taskId));
    setError(null);
    try {
      const data = await apiRequest<RetryFailedResponse>(`/api/v1/tasks/${encodeURIComponent(taskId)}/retry-failed`, {
        method: "POST",
      });
      const newId = toStr(data.task_id);
      if (newId) router.push(`/tasks/${encodeURIComponent(newId)}`);
      await refresh();
    } catch (e: unknown) {
      setError(e instanceof ApiError ? e.message : common("unknownError"));
    } finally {
      setRetryingIds((prev) => {
        const next = new Set(prev);
        next.delete(taskId);
        return next;
      });
    }
  }

  async function onBatchExport() {
    const targets = selectedItems.map((x) => x.task_id);
    if (!targets.length) return;
    setError(null);
    for (const id of targets) {
      // 避免多任务同时触发下载被浏览器拦截，按顺序导出
      // eslint-disable-next-line no-await-in-loop
      await onExport(id);
    }
  }

  async function onBatchCancel() {
    const targets = selectedItems.filter((x) => isRunningStatus(x.status)).map((x) => x.task_id);
    if (!targets.length) return;
    setError(null);
    for (const id of targets) {
      // eslint-disable-next-line no-await-in-loop
      await onCancel(id);
    }
  }

  function onOpenTool(task: TaskListItem, href: string, formNamespace: string, lastAction?: "clone" | "delete") {
    try {
      if (formNamespace) {
        const key = buildFormCacheKey(formNamespace);
        const cached = loadFormCache<Record<string, unknown>>(key);
        const obj = cached && typeof cached === "object" ? cached : {};
        const next: Record<string, unknown> = { ...obj, v: 1, taskId: task.task_id };
        if (lastAction) next.lastAction = lastAction;
        saveFormCache(key, next);
      }
    } catch {
      // ignore
    }
    router.push(href);
  }

  return (
    <div className="space-y-6">
      <DashboardPageHeader title={t("title")} subtitle={t("subtitle")} />

      <div className="rounded-[28px] zen-surface p-6">
        <div className="grid gap-4 md:grid-cols-3">
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="q" className="text-sm tracking-wide">
              {t("search")}
            </Label>
            <Input id="q" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("searchPlaceholder")} className="h-14 text-lg" />
          </div>
          <div className="flex items-end gap-2">
            <Button onClick={() => void refresh()} disabled={loadingList}>
              {loadingList ? common("loading") : t("refresh")}
            </Button>
            <Button variant="secondary" onClick={() => setAutoRefresh((v) => !v)} disabled={loadingList}>
              {autoRefresh ? t("autoRefreshOn") : t("autoRefreshOff")}
            </Button>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button variant={filter === "all" ? "default" : "secondary"} onClick={() => setFilter("all")} disabled={loadingList}>
            {t("filterAll")}
          </Button>
          <Button
            variant={filter === "running" ? "default" : "secondary"}
            onClick={() => setFilter("running")}
            disabled={loadingList}
          >
            {t("filterRunning")}
          </Button>
          <Button
            variant={filter === "failed" ? "default" : "secondary"}
            onClick={() => setFilter("failed")}
            disabled={loadingList}
          >
            {t("filterFailed")}
          </Button>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-black/20 accent-primary"
              checked={allCurrentSelected}
              onChange={(e) => selectAllCurrent(e.target.checked)}
              disabled={filteredItems.length === 0}
            />
            {t("selectAll")} {selected.size ? `(${selected.size})` : ""}
          </label>
          <Button variant="secondary" onClick={() => void onBatchExport()} disabled={selectedItems.length === 0}>
            {t("batchExport")}
          </Button>
          <Button variant="destructive" onClick={() => void onBatchCancel()} disabled={selectedItems.filter((x) => isRunningStatus(x.status)).length === 0}>
            {t("batchCancel")}
          </Button>
        </div>

        {error ? <div className="mt-4 text-sm text-destructive">{error}</div> : null}
      </div>

      <div className="rounded-[28px] zen-surface overflow-hidden">
        <div className="flex items-center justify-between border-b zen-divider px-6 py-4">
          <div className="text-base font-semibold text-foreground">{t("listTitle")}</div>
          <div className="text-xs text-muted-foreground">{filteredItems.length ? `${filteredItems.length}` : ""}</div>
        </div>
        <div className="p-6">
          {filteredItems.length === 0 ? (
            loadingList ? (
              <div className="space-y-2" aria-busy="true" aria-live="polite">
                {Array.from({ length: 6 }).map((_, idx) => (
                  <div key={idx} className="rounded-2xl zen-surface-subtle p-4">
                    <div className="flex flex-col justify-between gap-3 md:flex-row md:items-start">
                      <div className="min-w-0 space-y-2">
                        <Skeleton className="h-5 w-44 max-w-full" />
                        <Skeleton className="h-4 w-80 max-w-full" />
                        <Skeleton className="h-4 w-64 max-w-full" />
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Skeleton className="h-10 w-24 rounded-xl" />
                        <Skeleton className="h-10 w-24 rounded-xl" />
                        <Skeleton className="h-10 w-28 rounded-xl" />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-sm text-muted-foreground">{t("empty")}</div>
            )
          ) : (
            <div className="space-y-2">
              {filteredItems.map((task) => {
                const tool = getToolMetaByType(task.type);
                const status = formatStatus(task.status);
                const running = isRunningStatus(task.status);
                const exporting = exportingIds.has(task.task_id);
                const cancelling = cancellingIds.has(task.task_id);
                const retrying = retryingIds.has(task.task_id);

                const meta = task.metadata || {};
                const accountId = toStr(meta.account_id);
                const accountName = accountId ? accountNameMap[accountId] || accountId : "-";

                return (
                  <div key={task.task_id} className="rounded-2xl zen-surface-subtle p-4">
                    <div className="flex flex-col justify-between gap-3 md:flex-row md:items-start">
                      <div className="min-w-0 space-y-1">
                        <div className="flex items-start gap-3">
                          <input
                            type="checkbox"
                            className="mt-1 h-4 w-4 rounded border-black/20 accent-primary"
                            checked={selected.has(task.task_id)}
                            onChange={(e) => toggleSelected(task.task_id, e.target.checked)}
                          />
                          <div className="min-w-0 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="text-sm font-semibold text-foreground">
                            {tool ? tool.label : t("unknownTool")}
                          </div>
                          <div className={`text-xs ${status.className}`}>{status.label}</div>
                        </div>
                        <div className="font-mono text-xs text-muted-foreground break-all">{task.task_id}</div>
                        <div className="text-xs text-muted-foreground">
                          {t("account")}: {accountName} · {t("mode")}: {formatMode(task)}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {t("progress")} {task.total ? `${task.current}/${task.total}` : ""} · {common("success")}: {task.success} · {common("failed")}:{" "}
                          {task.failed}
                          {task.created_at ? ` · ${t("createdAt")}: ${new Date(task.created_at).toLocaleString()}` : ""}
                        </div>
                          </div>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        <Button asChild variant="secondary">
                          <Link href={`/tasks/${encodeURIComponent(task.task_id)}`}>{t("view")}</Link>
                        </Button>
                        {tool ? (
                          <Button
                            variant="secondary"
                            onClick={() => onOpenTool(task, tool.href, tool.formNamespace, tool.lastAction)}
                            disabled={loadingList}
                          >
                            {t("openTool")}
                          </Button>
                        ) : null}
                        <Button
                          variant="secondary"
                          onClick={() => void onExport(task.task_id)}
                          disabled={exporting || retrying}
                        >
                          {exporting ? common("loading") : common("exportResultsCsv")}
                        </Button>
                        <Button
                          variant="destructive"
                          onClick={() => void onCancel(task.task_id)}
                          disabled={cancelling || !running || retrying}
                        >
                          {cancelling ? common("loading") : common("cancelTask")}
                        </Button>
                        <Button
                          variant="secondary"
                          onClick={() => void onRetryFailed(task.task_id)}
                          disabled={retrying || task.failed <= 0 || running}
                        >
                          {retrying ? common("loading") : t("retryFailedNewTask")}
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
