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
  message?: string;
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

type Mode = "same_value" | "different_value" | "site_group" | "custom";

type FormCache = {
  v: 1;
  accountId?: string;
  mode?: Mode;
  recordType?: string;
  recordName?: string;
  recordValue?: string;
  ttl?: number;
  proxied?: boolean;
  domainsText?: string;
  valuesText?: string;
  recordsText?: string;
  taskId?: string;
};

function parseDomainValueLines(text: string): Array<{ domain: string; value: string }> {
  const lines = parseLines(text);
  const out: Array<{ domain: string; value: string }> = [];
  for (const line of lines) {
    const parts = line.split(/[=,\\s]+/g).map((s) => s.trim()).filter(Boolean);
    if (parts.length < 2) continue;
    out.push({ domain: parts[0], value: parts.slice(1).join(" ") });
  }
  return out;
}

export default function DnsResolvePage() {
  const t = useTranslations("DnsResolve");
  const common = useTranslations("Common");

  const FORM_KEY = buildFormCacheKey("dns.resolve");

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountId, setAccountId] = useState("");
  const [domainPickerOpen, setDomainPickerOpen] = useState(false);

  const [mode, setMode] = useState<Mode>("same_value");
  const [recordType, setRecordType] = useState("A");
  const [recordName, setRecordName] = useState("@");
  const [recordValue, setRecordValue] = useState("");
  const [ttl, setTtl] = useState(1);
  const [proxied, setProxied] = useState(true);

  const [domainsText, setDomainsText] = useState("");
  const [valuesText, setValuesText] = useState("");
  const [recordsText, setRecordsText] = useState("");

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

  const recordTypeOptions = useMemo(
    () => ["A", "AAAA", "CNAME", "TXT", "NS", "MX"],
    []
  );

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
      if (mode === "same_value") {
        const domains = parseLines(domainsText);
        if (!domains.length) throw new Error(t("parseError"));
        const value = recordValue.trim();
        if (!value) throw new Error(t("parseError"));
        body = {
          mode,
          account_id: accountId,
          record_type: recordType,
          record_name: recordName || "@",
          ttl,
          proxied,
          domains,
          record_value: value,
        };
      } else if (mode === "different_value") {
        const records = parseDomainValueLines(recordsText);
        if (!records.length) throw new Error(t("parseError"));
        body = {
          mode,
          account_id: accountId,
          record_type: recordType,
          record_name: recordName || "@",
          ttl,
          proxied,
          records,
        };
      } else if (mode === "site_group") {
        const domains = parseLines(domainsText);
        const values = parseLines(valuesText);
        if (!domains.length || !values.length) throw new Error(t("parseError"));
        body = {
          mode,
          account_id: accountId,
          record_type: recordType,
          record_name: recordName || "@",
          ttl,
          proxied,
          domains,
          values,
        };
      } else {
        const parsed = JSON.parse(recordsText);
        if (!Array.isArray(parsed) || parsed.length === 0) throw new Error(t("parseError"));
        body = { mode, account_id: accountId, records: parsed };
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : t("parseError"));
      return;
    }

    setRunning(true);
    try {
      const data = await apiRequest<TaskCreateResponse>("/api/v1/dns/resolve", {
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
      setMode(cached.mode || "same_value");
      setRecordType(cached.recordType || "A");
      setRecordName(cached.recordName || "@");
      setRecordValue(cached.recordValue || "");
      setTtl(typeof cached.ttl === "number" ? cached.ttl : 1);
      setProxied(cached.proxied ?? true);
      setDomainsText(cached.domainsText || "");
      setValuesText(cached.valuesText || "");
      setRecordsText(cached.recordsText || "");
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
      mode,
      recordType,
      recordName,
      recordValue,
      ttl,
      proxied,
      domainsText,
      valuesText,
      recordsText,
      taskId: taskId || undefined,
    });
  }, [
    FORM_KEY,
    accountId,
    domainsText,
    mode,
    proxied,
    recordName,
    recordType,
    recordValue,
    recordsText,
    taskId,
    ttl,
    valuesText,
  ]);

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
                setDomainPickerOpen(false);
                setDomainsText("");
                setValuesText("");
                setRecordsText("");
                setAccountId(next);
              }}
              className="zen-surface-subtle h-14 w-full rounded-xl px-4 text-lg text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/25 focus-visible:ring-offset-2"
              disabled={running}
            >
              {accounts.length === 0 ? (
                <option value="">{t("account")}</option>
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
              <option value="same_value">{t("modeSameValue")}</option>
              <option value="different_value">{t("modeDifferentValue")}</option>
              <option value="site_group">{t("modeSiteGroup")}</option>
              <option value="custom">{t("modeCustom")}</option>
            </select>
          </div>
        </div>

        {mode !== "custom" ? (
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
              <Label htmlFor="ttl" className="text-sm tracking-wide">
                {t("ttl")}
              </Label>
              <Input
                id="ttl"
                type="number"
                min={1}
                value={ttl}
                onChange={(e) => setTtl(Number(e.target.value || 1))}
                disabled={running}
                className="h-14 text-lg"
              />
            </div>

            <div className="flex items-center gap-2 md:col-span-3">
              <input
                id="proxied"
                type="checkbox"
                className="h-4 w-4 rounded border-black/20 accent-primary"
                checked={proxied}
                onChange={(e) => setProxied(e.target.checked)}
                disabled={running}
              />
              <Label htmlFor="proxied" className="text-sm tracking-wide">
                {t("proxied")}
              </Label>
            </div>
          </div>
        ) : null}

        {mode === "same_value" ? (
          <div className="mt-6 grid gap-4 md:grid-cols-2">
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
            <div className="space-y-2 md:col-span-2">
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
                className="zen-surface-subtle min-h-32 w-full rounded-xl p-4 text-lg text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/25 focus-visible:ring-offset-2"
                disabled={running}
              />
            </div>
          </div>
        ) : null}

        {mode === "different_value" ? (
          <div className="mt-6 space-y-2">
            <Label htmlFor="records" className="text-sm tracking-wide">
              {t("records")}
            </Label>
            <textarea
              id="records"
              value={recordsText}
              onChange={(e) => setRecordsText(e.target.value)}
              placeholder={t("recordsPlaceholderDifferent")}
              className="zen-surface-subtle min-h-40 w-full rounded-xl p-4 text-lg text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/25 focus-visible:ring-offset-2"
              disabled={running}
            />
          </div>
        ) : null}

        {mode === "site_group" ? (
          <div className="mt-6 grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="domains2" className="text-sm tracking-wide">
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
                id="domains2"
                value={domainsText}
                onChange={(e) => setDomainsText(e.target.value)}
                placeholder={t("domainsPlaceholder")}
                className="zen-surface-subtle min-h-40 w-full rounded-xl p-4 text-lg text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/25 focus-visible:ring-offset-2"
                disabled={running}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="values" className="text-sm tracking-wide">
                {t("values")}
              </Label>
              <textarea
                id="values"
                value={valuesText}
                onChange={(e) => setValuesText(e.target.value)}
                placeholder={t("valuesPlaceholder")}
                className="zen-surface-subtle min-h-40 w-full rounded-xl p-4 text-lg text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/25 focus-visible:ring-offset-2"
                disabled={running}
              />
            </div>
          </div>
        ) : null}

        {mode === "custom" ? (
          <div className="mt-6 space-y-2">
            <Label htmlFor="custom" className="text-sm tracking-wide">
              {t("records")}
            </Label>
            <textarea
              id="custom"
              value={recordsText}
              onChange={(e) => setRecordsText(e.target.value)}
              placeholder={t("recordsPlaceholderCustom")}
              className="zen-surface-subtle min-h-48 w-full rounded-xl p-4 font-mono text-base text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/25 focus-visible:ring-offset-2"
              disabled={running}
            />
          </div>
        ) : null}

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
            onClick={() => {
              const failed = Array.from(failedDomainsRef.current);
              if (failed.length === 0) return;
              if (mode === "different_value") {
                const failedSet = new Set(failed.map((x) => x.toLowerCase()));
                const kept = parseLines(recordsText).filter((line) => {
                  const parts = line
                    .split(/[=,\\s]+/g)
                    .map((s) => s.trim())
                    .filter(Boolean);
                  if (parts.length === 0) return false;
                  return failedSet.has(parts[0].toLowerCase());
                });
                setRecordsText(kept.join("\n"));
                return;
              }
              if (mode === "custom") return;
              setDomainsText(failed.join("\n"));
            }}
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
