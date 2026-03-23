"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";

import { ApiError, apiRequest } from "@/lib/api";
import { buildFormCacheKey, loadFormCache, saveFormCache } from "@/lib/form-cache";
import { cancelTask, exportTaskResults, NotLoggedInError } from "@/lib/task";
import {
  createBatchTaskSseHandlers,
  INITIAL_TASK_PROGRESS,
  openTaskEventSource,
  parseTaskRecovery,
  resetFailedDomains,
} from "@/lib/task-sse";
import { parseLines } from "@/lib/text";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import DashboardPageHeader from "@/components/dashboard/page-header";
import TaskProgressLogPanel, { TaskLogRow } from "@/components/task/task-progress-log-panel";

type Account = {
  id: string;
  name: string;
};

type RulesReadResponse = {
  domain: string;
  rules: Record<string, Array<Record<string, unknown>>>;
};

type TaskCreateResponse = {
  task_id: string;
  total: number;
};

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
};

type FormCache = {
  v: 1;
  accountId?: string;
  sourceDomain?: string;
  targetDomainsText?: string;
  deleteDomainsText?: string;
  confirmDelete?: boolean;
  typePageRules?: boolean;
  typeRedirectRules?: boolean;
  typeCacheRules?: boolean;
  taskId?: string;
  lastAction?: "clone" | "delete";
};

export default function RulesPage() {
  const t = useTranslations("Rules");
  const common = useTranslations("Common");

  const FORM_KEY = buildFormCacheKey("rules");

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountId, setAccountId] = useState("");

  const [sourceDomain, setSourceDomain] = useState("");
  const [targetDomainsText, setTargetDomainsText] = useState("");
  const [deleteDomainsText, setDeleteDomainsText] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  const [typePageRules, setTypePageRules] = useState(true);
  const [typeRedirectRules, setTypeRedirectRules] = useState(false);
  const [typeCacheRules, setTypeCacheRules] = useState(false);

  const ruleTypes = useMemo(() => {
    const out: string[] = [];
    if (typePageRules) out.push("page_rules");
    if (typeRedirectRules) out.push("redirect_rules");
    if (typeCacheRules) out.push("cache_rules");
    return out;
  }, [typeCacheRules, typePageRules, typeRedirectRules]);

  const [loaded, setLoaded] = useState<RulesReadResponse | null>(null);
  const [selected, setSelected] = useState<Record<string, Record<string, boolean>>>({});

  const [taskId, setTaskId] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [progress, setProgress] = useState(INITIAL_TASK_PROGRESS);
  const [logs, setLogs] = useState<TaskLogRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const eventSourceRef = useRef<EventSource | null>(null);
  const failedDomainsRef = useRef<Set<string>>(new Set());
  const [failedCount, setFailedCount] = useState(0);
  const [lastAction, setLastAction] = useState<"clone" | "delete" | null>(null);

  async function loadAccounts(preferredAccountId?: string) {
    setError(null);
    try {
      const data = await apiRequest<Account[]>("/api/v1/accounts", { method: "GET" });
      setAccounts(data);

      const preferred = (preferredAccountId || "").trim();
      if (preferred && data.some((a) => a.id === preferred)) {
        setAccountId(preferred);
        return;
      }
      if (!accountId && data.length > 0) setAccountId(data[0].id);
      if (accountId && !data.some((a) => a.id === accountId) && data.length > 0) setAccountId(data[0].id);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : common("unknownError"));
    }
  }

  useEffect(() => {
    const cached = loadFormCache<FormCache>(FORM_KEY);
    if (cached) {
      setSourceDomain(cached.sourceDomain || "");
      setTargetDomainsText(cached.targetDomainsText || "");
      setDeleteDomainsText(cached.deleteDomainsText || "");
      setConfirmDelete(Boolean(cached.confirmDelete));
      setTypePageRules(cached.typePageRules ?? true);
      setTypeRedirectRules(Boolean(cached.typeRedirectRules));
      setTypeCacheRules(Boolean(cached.typeCacheRules));
      setLastAction(cached.lastAction || null);
    }
    void loadAccounts(cached?.accountId);
    if (cached?.taskId) void recoverTask(cached.taskId);
    return () => {
      eventSourceRef.current?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    saveFormCache(FORM_KEY, {
      v: 1,
      accountId,
      sourceDomain,
      targetDomainsText,
      deleteDomainsText,
      confirmDelete,
      typePageRules,
      typeRedirectRules,
      typeCacheRules,
      taskId: taskId || undefined,
      lastAction: lastAction || undefined,
    });
  }, [
    FORM_KEY,
    accountId,
    confirmDelete,
    deleteDomainsText,
    sourceDomain,
    targetDomainsText,
    taskId,
    typeCacheRules,
    typePageRules,
    typeRedirectRules,
    lastAction,
  ]);

  function clearTask() {
    eventSourceRef.current?.close();
    eventSourceRef.current = null;
    setTaskId(null);
    setRunning(false);
    setProgress({ ...INITIAL_TASK_PROGRESS });
    setLogs([]);
    setLastAction(null);
    resetFailedDomains(failedDomainsRef, setFailedCount);
  }

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
        failedDomainsRef,
        setFailedCount,
      })
    );
  }

  async function recoverTask(id: string) {
    try {
      const task = await apiRequest<Record<string, unknown>>(`/api/v1/tasks/${id}`, { method: "GET" });
      const snapshot = parseTaskRecovery(task);

      setTaskId(id);
      setProgress(snapshot.progress);
      setRunning(snapshot.running);
      setLogs([]);
      setError(null);
      resetFailedDomains(failedDomainsRef, setFailedCount);
      startSse(id, { cursor: snapshot.cursorStart, historyEnd: snapshot.historyEnd });
    } catch {
      // ignore
    }
  }

  async function onRead() {
    if (!accountId) return;
    if (!ruleTypes.length) {
      setError(t("needRuleTypes"));
      return;
    }
    setError(null);
    setMessage(null);
    setLoaded(null);
    setSelected({});

    const sd = sourceDomain.trim();
    if (!sd) {
      setError(t("needSourceDomain"));
      return;
    }

    try {
      const data = await apiRequest<RulesReadResponse>("/api/v1/rules/read", {
        method: "POST",
        body: JSON.stringify({ account_id: accountId, source_domain: sd, rule_types: ruleTypes }),
      });
      setLoaded(data);

      const nextSelected: Record<string, Record<string, boolean>> = {};
      for (const [rt, rules] of Object.entries(data.rules || {})) {
        nextSelected[rt] = {};
        for (const r of rules || []) {
          const id = String((r as any).id || "");
          if (id) nextSelected[rt][id] = true;
        }
      }
      setSelected(nextSelected);
      setMessage(t("readOk"));
    } catch (e: unknown) {
      setError(e instanceof ApiError ? e.message : common("unknownError"));
    }
  }

  function toggleRule(ruleType: string, id: string) {
    setSelected((prev) => ({
      ...prev,
      [ruleType]: {
        ...(prev[ruleType] || {}),
        [id]: !prev[ruleType]?.[id],
      },
    }));
  }

  async function onClone() {
    if (!accountId) return;
    if (!loaded) {
      setError(t("needReadFirst"));
      return;
    }
    setError(null);
    setMessage(null);
    setLogs([]);
    setProgress({ ...INITIAL_TASK_PROGRESS });
    setLastAction("clone");
    resetFailedDomains(failedDomainsRef, setFailedCount);

    const targets = parseLines(targetDomainsText);
    if (!targets.length) {
      setError(t("needTargets"));
      return;
    }

    const selectedRules: Record<string, string[]> = {};
    for (const rt of ruleTypes) {
      const map = selected[rt] || {};
      selectedRules[rt] = Object.keys(map).filter((id) => map[id]);
    }
    const hasAny = Object.values(selectedRules).some((xs) => xs.length > 0);
    if (!hasAny) {
      setError(t("needSelectedRules"));
      return;
    }

    setRunning(true);
    try {
      const data = await apiRequest<TaskCreateResponse>("/api/v1/rules/clone", {
        method: "POST",
        body: JSON.stringify({
          account_id: accountId,
          source_domain: loaded.domain,
          target_domains: targets,
          rule_types: ruleTypes,
          selected_rules: selectedRules,
        }),
      });
      setTaskId(data.task_id);
      setProgress((p) => ({ ...p, total: data.total }));
      startSse(data.task_id);
    } catch (e: unknown) {
      setRunning(false);
      setError(e instanceof ApiError ? e.message : common("unknownError"));
    }
  }

  async function onDeleteRules() {
    if (!accountId) return;
    if (!ruleTypes.length) {
      setError(t("needRuleTypes"));
      return;
    }
    setError(null);
    setMessage(null);
    setLogs([]);
    setProgress({ ...INITIAL_TASK_PROGRESS });
    setLastAction("delete");
    resetFailedDomains(failedDomainsRef, setFailedCount);

    const domains = parseLines(deleteDomainsText);
    if (!domains.length || !confirmDelete) {
      setError(t("needDeleteConfirm"));
      return;
    }

    setRunning(true);
    try {
      const data = await apiRequest<TaskCreateResponse>("/api/v1/rules/delete", {
        method: "POST",
        body: JSON.stringify({
          account_id: accountId,
          domains,
          rule_types: ruleTypes,
          confirm: true,
        }),
      });
      setTaskId(data.task_id);
      setProgress((p) => ({ ...p, total: data.total }));
      startSse(data.task_id);
    } catch (e: unknown) {
      setRunning(false);
      setError(e instanceof ApiError ? e.message : common("unknownError"));
    }
  }

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
    } catch (e: unknown) {
      setError(e instanceof ApiError ? e.message : common("unknownError"));
    } finally {
      setCancelling(false);
    }
  }

  return (
    <div className="space-y-6">
      <DashboardPageHeader title={t("title")} subtitle={t("subtitle")} />

      <div className="rounded-[28px] zen-surface p-6">
        <div className="grid gap-4 md:grid-cols-3">
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="account" className="text-sm tracking-wide">
              {t("account")}
            </Label>
            <select
              id="account"
              value={accountId}
              onChange={(e) => {
                const next = e.target.value;
                if (next === accountId) return;
                clearTask();
                setLoaded(null);
                setSelected({});
                setMessage(null);
                setError(null);
                setConfirmDelete(false);
                setAccountId(next);
              }}
              className="zen-surface-subtle h-14 w-full rounded-xl px-4 text-lg text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/25 focus-visible:ring-offset-2"
              disabled={running}
            >
              {accounts.length === 0 ? (
                <option value="">{t("noAccount")}</option>
              ) : (
                accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))
              )}
            </select>
          </div>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-3">
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="sourceDomain" className="text-sm tracking-wide">
              {t("sourceDomain")}
            </Label>
            <Input
              id="sourceDomain"
              value={sourceDomain}
              onChange={(e) => setSourceDomain(e.target.value)}
              placeholder="template.com"
              disabled={running}
              className="h-14 text-lg"
            />
          </div>
          <div className="space-y-2">
            <Label>{t("ruleTypes")}</Label>
            <div className="flex flex-wrap gap-3 pt-1 text-sm text-muted-foreground">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-black/20 accent-primary"
                  checked={typePageRules}
                  onChange={(e) => setTypePageRules(e.target.checked)}
                  disabled={running}
                />
                page_rules
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-black/20 accent-primary"
                  checked={typeRedirectRules}
                  onChange={(e) => setTypeRedirectRules(e.target.checked)}
                  disabled={running}
                />
                redirect_rules
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-black/20 accent-primary"
                  checked={typeCacheRules}
                  onChange={(e) => setTypeCacheRules(e.target.checked)}
                  disabled={running}
                />
                cache_rules
              </label>
            </div>
          </div>
        </div>

        <div className="mt-6 flex flex-wrap gap-2">
          <Button size="lg" onClick={() => void onRead()} disabled={running || !accountId}>
            {t("read")}
          </Button>
          <Button variant="secondary" size="lg" onClick={clearTask} disabled={running}>
            {t("clear")}
          </Button>
          <Button
            variant="secondary"
            size="lg"
            onClick={() => {
              const failed = Array.from(failedDomainsRef.current);
              if (failed.length === 0) return;
              if (lastAction === "delete") setDeleteDomainsText(failed.join("\n"));
              else setTargetDomainsText(failed.join("\n"));
            }}
            disabled={running || failedCount === 0}
          >
            {common("retryFailed")}
          </Button>
          <Button variant="secondary" size="lg" onClick={() => void onExportResults()} disabled={!taskId || exporting}>
            {exporting ? common("loading") : common("exportResultsCsv")}
          </Button>
          <Button
            variant="destructive"
            size="lg"
            onClick={() => void onCancelTask()}
            disabled={!taskId || !running || cancelling}
          >
            {cancelling ? common("loading") : common("cancelTask")}
          </Button>
        </div>

        {message ? <div className="mt-4 text-sm text-emerald-700">{message}</div> : null}
        {error ? <div className="mt-4 text-sm text-destructive">{error}</div> : null}
      </div>

      <div className="rounded-[28px] zen-surface p-6">
        <div className="text-base font-semibold text-foreground">{t("selectTitle")}</div>
        {loaded ? (
          <div className="mt-4 space-y-6">
            {Object.entries(loaded.rules || {}).map(([rt, rules]) => (
              <div key={rt} className="space-y-2">
                <div className="text-sm font-semibold text-foreground">
                  {rt} <span className="text-xs text-muted-foreground">({rules.length})</span>
                </div>
                {rules.length === 0 ? (
                  <div className="text-sm text-muted-foreground">{t("noRules")}</div>
                ) : (
                  <div className="space-y-2">
                    {rules.map((r) => {
                      const obj = r as any;
                      const id = String(obj.id || "");
                      const label = String(obj.description || obj.expression || "");
                      return (
                        <label
                          key={id}
                          className="flex items-start gap-3 rounded-2xl zen-surface-subtle p-4 text-sm"
                        >
                          <input
                            type="checkbox"
                            className="mt-0.5 h-4 w-4 rounded border-black/20 accent-primary"
                            checked={Boolean(selected[rt]?.[id])}
                            onChange={() => toggleRule(rt, id)}
                          />
                          <div className="min-w-0">
                            <div className="font-mono text-xs text-muted-foreground">{id}</div>
                            {label ? <div className="mt-1 break-words text-xs text-muted-foreground">{label}</div> : null}
                          </div>
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="mt-2 text-sm text-muted-foreground">{t("readFirstTip")}</div>
        )}
      </div>

      <div className="rounded-[28px] zen-surface p-6">
        <div className="text-base font-semibold text-foreground">{t("cloneTitle")}</div>
        <div className="mt-4 space-y-2">
          <Label htmlFor="targets" className="text-sm tracking-wide">
            {t("targets")}
          </Label>
          <textarea
            id="targets"
            value={targetDomainsText}
            onChange={(e) => setTargetDomainsText(e.target.value)}
            placeholder={t("targetsPlaceholder")}
            className="zen-surface-subtle min-h-32 w-full rounded-xl p-4 text-lg text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/25 focus-visible:ring-offset-2"
            disabled={running}
          />
        </div>
        <div className="mt-4">
          <Button size="lg" onClick={() => void onClone()} disabled={running || !accountId}>
            {running ? t("running") : t("clone")}
          </Button>
        </div>
      </div>

      <div className="rounded-[28px] zen-surface p-6">
        <div className="text-base font-semibold text-foreground">{t("deleteTitle")}</div>
        <div className="mt-4 space-y-2">
          <Label htmlFor="deleteDomains" className="text-sm tracking-wide">
            {t("deleteDomains")}
          </Label>
          <textarea
            id="deleteDomains"
            value={deleteDomainsText}
            onChange={(e) => setDeleteDomainsText(e.target.value)}
            placeholder={t("deleteDomainsPlaceholder")}
            className="zen-surface-subtle min-h-32 w-full rounded-xl p-4 text-lg text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/25 focus-visible:ring-offset-2"
            disabled={running}
          />
        </div>
        <div className="mt-4 flex items-center gap-2">
          <input
            id="confirmDelete"
            type="checkbox"
            className="h-4 w-4 rounded border-black/20 accent-primary"
            checked={confirmDelete}
            onChange={(e) => setConfirmDelete(e.target.checked)}
            disabled={running}
          />
          <Label htmlFor="confirmDelete" className="text-sm tracking-wide">
            {t("confirmDelete")}
          </Label>
        </div>
        <div className="mt-4">
          <Button
            variant="destructive"
            size="lg"
            onClick={() => void onDeleteRules()}
            disabled={running || !accountId}
          >
            {running ? t("running") : t("delete")}
          </Button>
        </div>
      </div>

      <TaskProgressLogPanel
        title={t("taskProgress")}
        progress={progress}
        running={running}
        logs={logs}
        emptyText={t("empty")}
        loadingText={common("loading")}
        successLabel={common("success")}
        failedLabel={common("failed")}
        statusLabel={(s) => common(s)}
      />
    </div>
  );
}
