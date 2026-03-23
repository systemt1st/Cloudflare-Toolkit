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

type FormCache = {
  v: 1;
  accountId?: string;
  domainsText?: string;
  crawlerHints?: string;
  botFightMode?: string;
  aiScrapeShield?: string;
  crawlerProtection?: string;
  managedRobotsTxt?: string;
  http2ToOrigin?: string;
  urlNormalization?: string;
  webAnalytics?: string;
  http3?: string;
  websockets?: string;
  browserCheck?: string;
  hotlinkProtection?: string;
  taskId?: string;
};

function triToBool(value: string): boolean | null {
  if (!value) return null;
  return value === "on";
}

export default function OtherBatchPage() {
  const t = useTranslations("OtherBatch");
  const common = useTranslations("Common");

  const FORM_KEY = buildFormCacheKey("other.batch");

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountId, setAccountId] = useState("");

  const [domainPickerOpen, setDomainPickerOpen] = useState(false);
  const [domainsText, setDomainsText] = useState("");

  const triOptions = useMemo(() => ["", "on", "off"], []);
  const aiOptions = useMemo(() => ["", "block", "only_on_ad_pages", "disabled"], []);
  const urlNormOptions = useMemo(() => ["", "none", "incoming"], []);

  const [crawlerHints, setCrawlerHints] = useState("");
  const [botFightMode, setBotFightMode] = useState("");
  const [aiScrapeShield, setAiScrapeShield] = useState("");
  const [crawlerProtection, setCrawlerProtection] = useState("");
  const [managedRobotsTxt, setManagedRobotsTxt] = useState("");
  const [http2ToOrigin, setHttp2ToOrigin] = useState("");
  const [urlNormalization, setUrlNormalization] = useState("");
  const [webAnalytics, setWebAnalytics] = useState("");
  const [http3, setHttp3] = useState("");
  const [websockets, setWebsockets] = useState("");
  const [browserCheck, setBrowserCheck] = useState("");
  const [hotlinkProtection, setHotlinkProtection] = useState("");

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

    const domains = parseLines(domainsText);
    if (!domains.length) {
      setError(t("parseError"));
      return;
    }

    const settings = {
      crawler_hints: triToBool(crawlerHints),
      bot_fight_mode: triToBool(botFightMode),
      ai_scrape_shield: aiScrapeShield || null,
      crawler_protection: triToBool(crawlerProtection),
      managed_robots_txt: triToBool(managedRobotsTxt),
      http2_to_origin: triToBool(http2ToOrigin),
      url_normalization: urlNormalization || null,
      web_analytics: triToBool(webAnalytics),
      http3: triToBool(http3),
      websockets: triToBool(websockets),
      browser_check: triToBool(browserCheck),
      hotlink_protection: triToBool(hotlinkProtection),
    };

    const hasAny = Object.values(settings).some((v) => v !== null);
    if (!hasAny) {
      setError(t("parseError"));
      return;
    }

    setRunning(true);
    try {
      const data = await apiRequest<TaskCreateResponse>("/api/v1/other/batch", {
        method: "POST",
        body: JSON.stringify({ account_id: accountId, domains, settings }),
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
      setDomainsText(cached.domainsText || "");
      setCrawlerHints(cached.crawlerHints || "");
      setBotFightMode(cached.botFightMode || "");
      setAiScrapeShield(cached.aiScrapeShield || "");
      setCrawlerProtection(cached.crawlerProtection || "");
      setManagedRobotsTxt(cached.managedRobotsTxt || "");
      setHttp2ToOrigin(cached.http2ToOrigin || "");
      setUrlNormalization(cached.urlNormalization || "");
      setWebAnalytics(cached.webAnalytics || "");
      setHttp3(cached.http3 || "");
      setWebsockets(cached.websockets || "");
      setBrowserCheck(cached.browserCheck || "");
      setHotlinkProtection(cached.hotlinkProtection || "");
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
      domainsText,
      crawlerHints,
      botFightMode,
      aiScrapeShield,
      crawlerProtection,
      managedRobotsTxt,
      http2ToOrigin,
      urlNormalization,
      webAnalytics,
      http3,
      websockets,
      browserCheck,
      hotlinkProtection,
      taskId: taskId || undefined,
    });
  }, [
    FORM_KEY,
    accountId,
    aiScrapeShield,
    botFightMode,
    browserCheck,
    crawlerHints,
    crawlerProtection,
    domainsText,
    hotlinkProtection,
    http2ToOrigin,
    http3,
    managedRobotsTxt,
    taskId,
    urlNormalization,
    webAnalytics,
    websockets,
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
          <div className="space-y-2">
            <Label htmlFor="crawlerHints" className="text-sm tracking-wide">
              {t("crawlerHints")}
            </Label>
            <select
              id="crawlerHints"
              value={crawlerHints}
              onChange={(e) => setCrawlerHints(e.target.value)}
              className="zen-surface-subtle h-14 w-full rounded-xl px-4 text-lg text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/25 focus-visible:ring-offset-2"
              disabled={running}
            >
              {triOptions.map((x) => (
                <option key={x || "keep"} value={x}>
                  {x ? x : t("keep")}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="botFightMode" className="text-sm tracking-wide">
              {t("botFightMode")}
            </Label>
            <select
              id="botFightMode"
              value={botFightMode}
              onChange={(e) => setBotFightMode(e.target.value)}
              className="zen-surface-subtle h-14 w-full rounded-xl px-4 text-lg text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/25 focus-visible:ring-offset-2"
              disabled={running}
            >
              {triOptions.map((x) => (
                <option key={x || "keep"} value={x}>
                  {x ? x : t("keep")}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="aiScrapeShield" className="text-sm tracking-wide">
              {t("aiScrapeShield")}
            </Label>
            <select
              id="aiScrapeShield"
              value={aiScrapeShield}
              onChange={(e) => setAiScrapeShield(e.target.value)}
              className="zen-surface-subtle h-14 w-full rounded-xl px-4 text-lg text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/25 focus-visible:ring-offset-2"
              disabled={running}
            >
              {aiOptions.map((x) => (
                <option key={x || "keep"} value={x}>
                  {x ? x : t("keep")}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="crawlerProtection" className="text-sm tracking-wide">
              {t("crawlerProtection")}
            </Label>
            <select
              id="crawlerProtection"
              value={crawlerProtection}
              onChange={(e) => setCrawlerProtection(e.target.value)}
              className="zen-surface-subtle h-14 w-full rounded-xl px-4 text-lg text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/25 focus-visible:ring-offset-2"
              disabled={running}
            >
              {triOptions.map((x) => (
                <option key={x || "keep"} value={x}>
                  {x ? x : t("keep")}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="managedRobotsTxt" className="text-sm tracking-wide">
              {t("managedRobotsTxt")}
            </Label>
            <select
              id="managedRobotsTxt"
              value={managedRobotsTxt}
              onChange={(e) => setManagedRobotsTxt(e.target.value)}
              className="zen-surface-subtle h-14 w-full rounded-xl px-4 text-lg text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/25 focus-visible:ring-offset-2"
              disabled={running}
            >
              {triOptions.map((x) => (
                <option key={x || "keep"} value={x}>
                  {x ? x : t("keep")}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="http2ToOrigin" className="text-sm tracking-wide">
              {t("http2ToOrigin")}
            </Label>
            <select
              id="http2ToOrigin"
              value={http2ToOrigin}
              onChange={(e) => setHttp2ToOrigin(e.target.value)}
              className="zen-surface-subtle h-14 w-full rounded-xl px-4 text-lg text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/25 focus-visible:ring-offset-2"
              disabled={running}
            >
              {triOptions.map((x) => (
                <option key={x || "keep"} value={x}>
                  {x ? x : t("keep")}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="urlNormalization" className="text-sm tracking-wide">
              {t("urlNormalization")}
            </Label>
            <select
              id="urlNormalization"
              value={urlNormalization}
              onChange={(e) => setUrlNormalization(e.target.value)}
              className="zen-surface-subtle h-14 w-full rounded-xl px-4 text-lg text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/25 focus-visible:ring-offset-2"
              disabled={running}
            >
              {urlNormOptions.map((x) => (
                <option key={x || "keep"} value={x}>
                  {x ? x : t("keep")}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="webAnalytics" className="text-sm tracking-wide">
              {t("webAnalytics")}
            </Label>
            <select
              id="webAnalytics"
              value={webAnalytics}
              onChange={(e) => setWebAnalytics(e.target.value)}
              className="zen-surface-subtle h-14 w-full rounded-xl px-4 text-lg text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/25 focus-visible:ring-offset-2"
              disabled={running}
            >
              {triOptions.map((x) => (
                <option key={x || "keep"} value={x}>
                  {x ? x : t("keep")}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-4">
          <div className="space-y-2">
            <Label htmlFor="http3" className="text-sm tracking-wide">
              {t("http3")}
            </Label>
            <select
              id="http3"
              value={http3}
              onChange={(e) => setHttp3(e.target.value)}
              className="zen-surface-subtle h-14 w-full rounded-xl px-4 text-lg text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/25 focus-visible:ring-offset-2"
              disabled={running}
            >
              {triOptions.map((x) => (
                <option key={x || "keep"} value={x}>
                  {x ? x : t("keep")}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="websockets" className="text-sm tracking-wide">
              {t("websockets")}
            </Label>
            <select
              id="websockets"
              value={websockets}
              onChange={(e) => setWebsockets(e.target.value)}
              className="zen-surface-subtle h-14 w-full rounded-xl px-4 text-lg text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/25 focus-visible:ring-offset-2"
              disabled={running}
            >
              {triOptions.map((x) => (
                <option key={x || "keep"} value={x}>
                  {x ? x : t("keep")}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="browserCheck" className="text-sm tracking-wide">
              {t("browserCheck")}
            </Label>
            <select
              id="browserCheck"
              value={browserCheck}
              onChange={(e) => setBrowserCheck(e.target.value)}
              className="zen-surface-subtle h-14 w-full rounded-xl px-4 text-lg text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/25 focus-visible:ring-offset-2"
              disabled={running}
            >
              {triOptions.map((x) => (
                <option key={x || "keep"} value={x}>
                  {x ? x : t("keep")}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="hotlinkProtection" className="text-sm tracking-wide">
              {t("hotlinkProtection")}
            </Label>
            <select
              id="hotlinkProtection"
              value={hotlinkProtection}
              onChange={(e) => setHotlinkProtection(e.target.value)}
              className="zen-surface-subtle h-14 w-full rounded-xl px-4 text-lg text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/25 focus-visible:ring-offset-2"
              disabled={running}
            >
              {triOptions.map((x) => (
                <option key={x || "keep"} value={x}>
                  {x ? x : t("keep")}
                </option>
              ))}
            </select>
          </div>
        </div>

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
            disabled={running || failedCount === 0}
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
        onConfirm={(domains) => setDomainsText(domains.join("\n"))}
      />
    </div>
  );
}
