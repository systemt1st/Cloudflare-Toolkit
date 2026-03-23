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
import DomainPicker from "@/components/domain/domain-picker";
import DashboardPageHeader from "@/components/dashboard/page-header";
import TaskProgressLogPanel, { TaskLogRow } from "@/components/task/task-progress-log-panel";

type Account = {
  id: string;
  name: string;
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

type Mode = "by_record" | "clear" | "custom";

type FormCache = {
  v: 1;
  accountId?: string;
  mode?: Mode;
  recordType?: string;
  recordName?: string;
  recordValue?: string;
  confirmClear?: boolean;
  domainsText?: string;
  customJson?: string;
  taskId?: string;
};

export default function DnsDeletePage() {
  const t = useTranslations("DnsDelete");
  const common = useTranslations("Common");

  const FORM_KEY = buildFormCacheKey("dns.delete");

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountId, setAccountId] = useState("");

  const [mode, setMode] = useState<Mode>("by_record");
  const [recordType, setRecordType] = useState("A");
  const [recordName, setRecordName] = useState("@");
  const [recordValue, setRecordValue] = useState("");
  const [confirmClear, setConfirmClear] = useState(false);

  const [domainsText, setDomainsText] = useState("");
  const [customJson, setCustomJson] = useState("");
  const [domainPickerOpen, setDomainPickerOpen] = useState(false);

  const [taskId, setTaskId] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [progress, setProgress] = useState(INITIAL_TASK_PROGRESS);
  const [logs, setLogs] = useState<TaskLogRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  const eventSourceRef = useRef<EventSource | null>(null);
  const failedDomainsRef = useRef<Set<string>>(new Set());
  const [failedCount, setFailedCount] = useState(0);

  const recordTypeOptions = useMemo(() => ["A", "AAAA", "CNAME", "TXT", "NS", "MX"], []);

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

  function clearTask() {
    eventSourceRef.current?.close();
    eventSourceRef.current = null;
    setTaskId(null);
    setRunning(false);
    setProgress({ ...INITIAL_TASK_PROGRESS });
    setLogs([]);
    setError(null);
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

  async function onStart() {
    if (!accountId) return;
    setError(null);
    setLogs([]);
    setProgress({ ...INITIAL_TASK_PROGRESS });
    resetFailedDomains(failedDomainsRef, setFailedCount);

    let body: unknown;
    try {
      if (mode === "by_record") {
        const domains = parseLines(domainsText);
        if (!domains.length || !recordType || !recordName) throw new Error(t("parseError"));
        body = {
          mode,
          account_id: accountId,
          record_type: recordType,
          record_name: recordName,
          record_value: recordValue.trim() || null,
          domains,
        };
      } else if (mode === "clear") {
        const domains = parseLines(domainsText);
        if (!domains.length || !confirmClear) throw new Error(t("parseError"));
        body = { mode, account_id: accountId, confirm: true, domains };
      } else {
        const parsed = JSON.parse(customJson);
        if (!Array.isArray(parsed) || parsed.length === 0) throw new Error(t("parseError"));
        body = { mode, account_id: accountId, records: parsed };
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : t("parseError"));
      return;
    }

    setRunning(true);
    try {
      const data = await apiRequest<TaskCreateResponse>("/api/v1/dns/delete", {
        method: "POST",
        body: JSON.stringify(body),
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

  useEffect(() => {
    const cached = loadFormCache<FormCache>(FORM_KEY);
    if (cached) {
      setMode(cached.mode || "by_record");
      setRecordType(cached.recordType || "A");
      setRecordName(cached.recordName || "@");
      setRecordValue(cached.recordValue || "");
      setConfirmClear(Boolean(cached.confirmClear));
      setDomainsText(cached.domainsText || "");
      setCustomJson(cached.customJson || "");
    }
    void loadAccounts(cached?.accountId);
    if (cached?.taskId) void recoverTask(cached.taskId);
    return () => {
      eventSourceRef.current?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    saveFormCache(FORM_KEY, { v: 1, accountId, mode, recordType, recordName, recordValue, confirmClear, domainsText, customJson, taskId: taskId || undefined });
  }, [FORM_KEY, accountId, confirmClear, customJson, domainsText, mode, recordName, recordType, recordValue, taskId]);

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
                setDomainsText("");
                setCustomJson("");
                setConfirmClear(false);
                setDomainPickerOpen(false);
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

          <div className="space-y-2">
            <Label htmlFor="mode" className="text-sm tracking-wide">
              {t("mode")}
            </Label>
            <select
              id="mode"
              value={mode}
              onChange={(e) => setMode(e.target.value as Mode)}
              className="zen-surface-subtle h-14 w-full rounded-xl px-4 text-lg text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/25 focus-visible:ring-offset-2"
              disabled={running}
            >
              <option value="by_record">{t("modeByRecord")}</option>
              <option value="clear">{t("modeClear")}</option>
              <option value="custom">{t("modeCustom")}</option>
            </select>
          </div>
        </div>

        {mode === "by_record" ? (
          <div className="mt-6 grid gap-4 md:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="recordType" className="text-sm tracking-wide">
                {t("recordType")}
              </Label>
              <select
                id="recordType"
                value={recordType}
                onChange={(e) => setRecordType(e.target.value)}
                className="zen-surface-subtle h-14 w-full rounded-xl px-4 text-lg text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/25 focus-visible:ring-offset-2"
                disabled={running}
              >
                {recordTypeOptions.map((x) => (
                  <option key={x} value={x}>
                    {x}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="recordName" className="text-sm tracking-wide">
                {t("recordName")}
              </Label>
              <Input
                id="recordName"
                value={recordName}
                onChange={(e) => setRecordName(e.target.value)}
                disabled={running}
                className="h-14 text-lg"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="recordValue" className="text-sm tracking-wide">
                {t("recordValue")}
              </Label>
              <Input
                id="recordValue"
                value={recordValue}
                onChange={(e) => setRecordValue(e.target.value)}
                disabled={running}
                className="h-14 text-lg"
              />
            </div>
          </div>
        ) : null}

        {mode === "clear" ? (
          <div className="mt-6 flex items-center gap-2">
            <input
              id="confirm"
              type="checkbox"
              className="h-4 w-4 rounded border-black/20 accent-primary"
              checked={confirmClear}
              onChange={(e) => setConfirmClear(e.target.checked)}
              disabled={running}
            />
            <Label htmlFor="confirm" className="text-sm tracking-wide">
              {t("confirmClear")}
            </Label>
          </div>
        ) : null}

        {mode !== "custom" ? (
          <div className="mt-6 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="domains" className="text-sm tracking-wide">
                {t("domains")}
              </Label>
              <Button
                variant="secondary"
                size="lg"
                onClick={() => setDomainPickerOpen(true)}
                disabled={running || !accountId}
              >
                {t("pickDomains")}
              </Button>
            </div>
            <textarea
              id="domains"
              value={domainsText}
              onChange={(e) => setDomainsText(e.target.value)}
              placeholder={t("domainsPlaceholder")}
              className="zen-surface-subtle min-h-40 w-full rounded-xl p-4 text-lg text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/25 focus-visible:ring-offset-2"
              disabled={running}
            />
          </div>
        ) : (
          <div className="mt-6 space-y-2">
            <Label htmlFor="custom" className="text-sm tracking-wide">
              {t("customJson")}
            </Label>
            <textarea
              id="custom"
              value={customJson}
              onChange={(e) => setCustomJson(e.target.value)}
              placeholder={t("customPlaceholder")}
              className="zen-surface-subtle min-h-48 w-full rounded-xl p-4 font-mono text-base text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/25 focus-visible:ring-offset-2"
              disabled={running}
            />
          </div>
        )}

        <div className="mt-6 flex flex-wrap gap-2">
          <Button size="lg" onClick={() => void onStart()} disabled={running || !accountId}>
            {running ? t("running") : t("start")}
          </Button>
          <Button variant="secondary" size="lg" onClick={clearTask} disabled={running}>
            {t("clear")}
          </Button>
          <Button
            variant="secondary"
            size="lg"
            onClick={() => setDomainsText(Array.from(failedDomainsRef.current).join("\n"))}
            disabled={running || failedCount === 0 || mode === "custom"}
          >
            {common("retryFailed")}
          </Button>
          <Button
            variant="secondary"
            size="lg"
            onClick={() => void onExportResults()}
            disabled={!taskId || exporting}
          >
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

        {taskId ? (
          <div className="mt-4 text-sm text-muted-foreground">
            {t("taskId")}: <span className="font-mono">{taskId}</span>
          </div>
        ) : null}

        {error ? <div className="mt-4 text-sm text-destructive">{error}</div> : null}
      </div>

      <TaskProgressLogPanel
        title={t("progress")}
        progress={progress}
        running={running}
        logs={logs}
        emptyText={t("empty")}
        loadingText={common("loading")}
        successLabel={common("success")}
        failedLabel={common("failed")}
        statusLabel={(s) => common(s)}
      />

      <DomainPicker
        accountId={accountId}
        open={domainPickerOpen}
        onClose={() => setDomainPickerOpen(false)}
        onConfirm={(picked) => setDomainsText(picked.join("\n"))}
      />
    </div>
  );
}
