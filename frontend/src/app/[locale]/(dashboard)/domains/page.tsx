"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, usePathname, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { ArrowUpDown, ChevronDown, ChevronUp, X } from "lucide-react";

import { useRouter } from "@/i18n/navigation";
import { apiRequest, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import ConfirmDialog from "@/components/ui/confirm-dialog";
import DashboardPageHeader from "@/components/dashboard/page-header";
import { Skeleton } from "@/components/ui/skeleton";

type Account = {
  id: string;
  name: string;
};

type DomainItem = {
  domain: string;
  zone_id: string;
  status: string;
  name_servers?: string[] | null;
  cached_at: string;
};

function normalizeSortKey(value: string | null): "domain" | "status" | "dns" {
  if (value === "status" || value === "dns" || value === "domain") return value;
  return "domain";
}

function normalizeSortDir(value: string | null): "asc" | "desc" {
  if (value === "desc" || value === "asc") return value;
  return "asc";
}

export default function DomainsPage() {
  const t = useTranslations("Domains");
  const common = useTranslations("Common");
  const router = useRouter();
  const params = useParams<{ locale?: string }>();
  const locale = useMemo(() => params?.locale || "zh", [params]);
  const pathname = usePathname() || "";
  const searchParams = useSearchParams();

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountId, setAccountId] = useState<string>(() => searchParams.get("account") ?? "");

  const [domains, setDomains] = useState<DomainItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: "success" | "info"; text: string } | null>(null);
  const [keyword, setKeyword] = useState(() => searchParams.get("q") ?? "");
  const [sortKey, setSortKey] = useState<"domain" | "status" | "dns">(() =>
    normalizeSortKey(searchParams.get("sort"))
  );
  const [sortDir, setSortDir] = useState<"asc" | "desc">(() => normalizeSortDir(searchParams.get("dir")));
  const [deleting, setDeleting] = useState<Record<string, boolean>>({});
  const [pendingDelete, setPendingDelete] = useState<DomainItem | null>(null);

  const pathWithoutLocale = useMemo(() => {
    const prefix = `/${locale}`;
    if (pathname === prefix) return "/";
    if (pathname.startsWith(`${prefix}/`)) return pathname.slice(prefix.length) || "/";
    return pathname || "/";
  }, [locale, pathname]);
  const queryString = searchParams.toString();

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const next = new URLSearchParams(queryString);

      if (accountId) next.set("account", accountId);
      else next.delete("account");

      const q = keyword.trim();
      if (q) next.set("q", q);
      else next.delete("q");

      if (sortKey === "domain") next.delete("sort");
      else next.set("sort", sortKey);

      if (sortDir === "asc") next.delete("dir");
      else next.set("dir", sortDir);

      const nextString = next.toString();
      if (nextString === queryString) return;
      const href = nextString ? `${pathWithoutLocale}?${nextString}` : pathWithoutLocale;
      router.replace(href, { locale });
    }, 200);
    return () => window.clearTimeout(timer);
  }, [accountId, keyword, locale, pathWithoutLocale, queryString, router, sortDir, sortKey]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 3000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const filtered = useMemo(() => {
    const q = keyword.trim().toLowerCase();
    if (!q) return domains;
    return domains.filter((d) => d.domain.toLowerCase().includes(q));
  }, [domains, keyword]);

  const sorted = useMemo(() => {
    const list = filtered.slice();
    const getValue = (item: DomainItem) => {
      if (sortKey === "status") return (item.status || "").toLowerCase();
      if (sortKey === "dns") return (item.name_servers?.join(", ") || "").toLowerCase();
      return (item.domain || "").toLowerCase();
    };
    list.sort((a, b) => {
      const av = getValue(a);
      const bv = getValue(b);
      const result = av.localeCompare(bv);
      return sortDir === "asc" ? result : -result;
    });
    return list;
  }, [filtered, sortDir, sortKey]);

  function toggleSort(key: "domain" | "status" | "dns") {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(key);
    setSortDir("asc");
  }

  function renderSortIcon(key: "domain" | "status" | "dns") {
    if (sortKey !== key) return <ArrowUpDown className="h-4 w-4 text-muted-foreground/70" />;
    return sortDir === "asc" ? (
      <ChevronUp className="h-4 w-4 text-foreground" />
    ) : (
      <ChevronDown className="h-4 w-4 text-foreground" />
    );
  }

  function getStatusBadgeClass(status: string) {
    const value = String(status || "").toLowerCase();
    if (value === "active") return "bg-green-100 text-green-700 dark:bg-green-900/20 dark:text-green-300";
    if (value === "pending" || value === "initializing") {
      return "bg-amber-100 text-amber-900 dark:bg-amber-900/20 dark:text-amber-200";
    }
    return "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300";
  }

  async function loadAccounts() {
    setError(null);
    setNotice(null);
    try {
      const data = await apiRequest<Account[]>("/api/v1/accounts", { method: "GET" });
      setAccounts(data);
      setAccountId((prev) => {
        if (data.length === 0) return "";
        if (prev && data.some((a) => a.id === prev)) return prev;
        return data[0].id;
      });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : common("unknownError"));
    }
  }

  async function loadDomains(selectedAccountId: string) {
    if (!selectedAccountId) return;
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      const data = await apiRequest<DomainItem[]>(
        `/api/v1/accounts/${selectedAccountId}/domains`,
        { method: "GET" }
      );
      setDomains(data);
    } catch (e: unknown) {
      setError(e instanceof ApiError ? e.message : common("unknownError"));
    } finally {
      setLoading(false);
    }
  }

  async function refreshDomains() {
    if (!accountId) return;
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      await apiRequest<{ count: number }>(
        `/api/v1/accounts/${accountId}/domains/refresh`,
        { method: "POST" }
      );
      await loadDomains(accountId);
    } catch (e: unknown) {
      setError(e instanceof ApiError ? e.message : common("unknownError"));
    } finally {
      setLoading(false);
    }
  }

  function downloadTextFile(filename: string, content: string, mimeType: string) {
    const blob = new Blob([content], { type: `${mimeType};charset=utf-8` });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function escapeCsvField(value: string) {
    const escaped = value.replace(/\"/g, '""');
    return `"${escaped}"`;
  }

  function buildCsv(rows: DomainItem[]) {
    const header = ["domain", "status", "cached_at", "name_servers"].join(",");
    const lines = rows.map((d) => {
      const nameServers = d.name_servers?.length ? d.name_servers.join(" | ") : "";
      return [
        escapeCsvField(d.domain),
        escapeCsvField(d.status || ""),
        escapeCsvField(d.cached_at || ""),
        escapeCsvField(nameServers),
      ].join(",");
    });
    return "\ufeff" + [header, ...lines].join("\n");
  }

  function onExport(format: "csv" | "txt") {
    if (!sorted.length) {
      setNotice({ kind: "info", text: t("nothingToExport") });
      return;
    }
    const filename = accountId ? `domains-${accountId}.${format}` : `domains.${format}`;
    if (format === "txt") {
      const content = sorted.map((d) => d.domain).join("\n");
      downloadTextFile(filename, content, "text/plain");
      setNotice({ kind: "success", text: t("exportedTxt") });
      return;
    }
    const csvText = buildCsv(sorted);
    downloadTextFile(filename, csvText, "text/csv");
    setNotice({ kind: "success", text: t("exportedCsv") });
  }

  async function onDeleteDomain(domain: DomainItem) {
    if (!accountId) return;
    setDeleting((prev) => ({ ...prev, [domain.zone_id]: true }));
    setError(null);
    setNotice(null);
    try {
      await apiRequest<{ task_id: string }>(`/api/v1/domains/delete`, {
        method: "POST",
        body: JSON.stringify({ account_id: accountId, domains: [domain.domain] }),
      });
      await refreshDomains();
      setNotice({ kind: "success", text: t("deletedSuccess") });
    } catch (e: unknown) {
      setError(e instanceof ApiError ? e.message : common("unknownError"));
    } finally {
      setDeleting((prev) => {
        const next = { ...prev };
        delete next[domain.zone_id];
        return next;
      });
    }
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    await onDeleteDomain(pendingDelete);
    setPendingDelete(null);
  }

  useEffect(() => {
    void loadAccounts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void loadDomains(accountId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId]);

  return (
    <div className="space-y-3">
      <DashboardPageHeader title={t("title")} subtitle={t("subtitle")} />

      <div className="rounded-[28px] zen-surface p-5">
        <div className="grid gap-3 md:grid-cols-3">
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="account" className="text-sm tracking-wide">
              {t("account")}
            </Label>
            <select
              id="account"
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              className="zen-surface-subtle h-14 w-full rounded-xl px-4 text-lg text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/25 focus-visible:ring-offset-2"
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

          <div className="flex items-end gap-2">
            <Button
              variant="secondary"
              size="lg"
              onClick={() => void loadDomains(accountId)}
              disabled={!accountId || loading}
            >
              {t("load")}
            </Button>
            <Button size="lg" onClick={() => void refreshDomains()} disabled={!accountId || loading}>
              {loading ? common("loading") : t("refresh")}
            </Button>
          </div>
        </div>

        <div className="mt-3 space-y-2">
          <Label htmlFor="keyword" className="text-sm tracking-wide">
            {t("search")}
          </Label>
          <div className="relative">
            <Input
              id="keyword"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder={t("searchPlaceholder")}
              className="h-14 pr-12 text-lg"
            />
            {keyword ? (
              <button
                type="button"
                onClick={() => setKeyword("")}
                className="absolute right-3 top-1/2 inline-flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground transition-colors duration-200 hover:bg-white/55 hover:text-foreground dark:hover:bg-gray-700/30"
                aria-label={t("clearSearch")}
              >
                <X className="h-4 w-4" />
              </button>
            ) : null}
          </div>
        </div>

        {notice ? (
          <div
            className={`mt-3 rounded-lg border px-3 py-2 text-sm shadow-sm transition-colors duration-200 ${
              notice.kind === "success"
                ? "border-green-200 bg-green-50 text-green-700 dark:border-green-900/40 dark:bg-green-900/20 dark:text-green-300"
                : "border-gray-200 bg-gray-50 text-gray-700 dark:border-gray-700 dark:bg-gray-800/40 dark:text-gray-200"
            }`}
            role="status"
          >
            {notice.text}
          </div>
        ) : null}
        {error ? (
          <div
            className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600 shadow-sm transition-colors duration-200 dark:border-red-900/40 dark:bg-red-900/20 dark:text-red-300"
            role="alert"
          >
            {error}
          </div>
        ) : null}
      </div>

      <div className="rounded-[28px] zen-surface overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b zen-divider px-5 py-4">
          <div className="text-xl font-semibold text-foreground">
            {t("list")} ({sorted.length})
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => onExport("csv")}
              disabled={!accountId || sorted.length === 0}
            >
              {t("exportCsv")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => onExport("txt")}
              disabled={!accountId || sorted.length === 0}
            >
              {t("exportTxt")}
            </Button>
          </div>
        </div>

        <div className="p-5">
          {!accountId ? (
            <div className="text-lg text-muted-foreground">{t("selectAccountFirst")}</div>
          ) : loading ? (
            <div className="space-y-2" aria-busy="true" aria-live="polite">
              {Array.from({ length: 8 }).map((_, idx) => (
                <div key={idx} className="rounded-2xl zen-surface-subtle p-4">
                  <div className="flex items-center justify-between gap-4">
                    <Skeleton className="h-6 w-72 max-w-[65%]" />
                    <Skeleton className="h-6 w-20 rounded-full" />
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <Skeleton className="h-4 w-40" />
                    <Skeleton className="h-4 w-56" />
                  </div>
                </div>
              ))}
            </div>
          ) : sorted.length === 0 ? (
            <div className="text-lg text-muted-foreground">{t("empty")}</div>
          ) : (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2 md:hidden">
                <button
                  type="button"
                  onClick={() => toggleSort("domain")}
                  className="inline-flex items-center gap-2 rounded-full border border-gray-200 bg-white/60 px-3 py-1.5 text-sm text-foreground shadow-sm transition-colors duration-200 hover:bg-white dark:border-gray-700 dark:bg-gray-800/40 dark:hover:bg-gray-800"
                  aria-pressed={sortKey === "domain"}
                >
                  <span>{t("sortDomain")}</span>
                  {renderSortIcon("domain")}
                </button>
                <button
                  type="button"
                  onClick={() => toggleSort("status")}
                  className="inline-flex items-center gap-2 rounded-full border border-gray-200 bg-white/60 px-3 py-1.5 text-sm text-foreground shadow-sm transition-colors duration-200 hover:bg-white dark:border-gray-700 dark:bg-gray-800/40 dark:hover:bg-gray-800"
                  aria-pressed={sortKey === "status"}
                >
                  <span>{t("sortStatus")}</span>
                  {renderSortIcon("status")}
                </button>
                <button
                  type="button"
                  onClick={() => toggleSort("dns")}
                  className="inline-flex items-center gap-2 rounded-full border border-gray-200 bg-white/60 px-3 py-1.5 text-sm text-foreground shadow-sm transition-colors duration-200 hover:bg-white dark:border-gray-700 dark:bg-gray-800/40 dark:hover:bg-gray-800"
                  aria-pressed={sortKey === "dns"}
                >
                  <span>{t("sortDns")}</span>
                  {renderSortIcon("dns")}
                </button>
              </div>
              <div className="hidden grid-cols-12 gap-4 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground md:grid">
                <button
                  type="button"
                  onClick={() => toggleSort("domain")}
                  className="col-span-4 inline-flex items-center gap-2 rounded-lg px-2 py-1 transition-colors duration-200 hover:bg-white/55 dark:hover:bg-gray-700/30"
                >
                  <span>{t("sortDomain")}</span>
                  {renderSortIcon("domain")}
                </button>
                <button
                  type="button"
                  onClick={() => toggleSort("status")}
                  className="col-span-3 inline-flex items-center gap-2 rounded-lg px-2 py-1 transition-colors duration-200 hover:bg-white/55 dark:hover:bg-gray-700/30"
                >
                  <span>{t("sortStatus")}</span>
                  {renderSortIcon("status")}
                </button>
                <button
                  type="button"
                  onClick={() => toggleSort("dns")}
                  className="col-span-3 inline-flex items-center gap-2 rounded-lg px-2 py-1 transition-colors duration-200 hover:bg-white/55 dark:hover:bg-gray-700/30"
                >
                  <span>{t("sortDns")}</span>
                  {renderSortIcon("dns")}
                </button>
                <div className="col-span-2 px-2 py-1 text-right">{t("actions")}</div>
              </div>
              {sorted.map((d) => (
                <div
                  key={d.zone_id}
                  className="rounded-2xl zen-surface-subtle p-4 transition-colors duration-200 hover:bg-white/55 dark:hover:bg-gray-700/30 md:grid md:grid-cols-12 md:items-center md:gap-4"
                >
                  <div className="min-w-0 md:col-span-4">
                    <div className="truncate text-lg font-semibold text-foreground">{d.domain}</div>
                  </div>

                  <div className="text-sm text-muted-foreground md:col-span-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${getStatusBadgeClass(d.status)}`}>
                        {d.status}
                      </span>
                    </div>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      {t("cachedAt")}: {new Date(d.cached_at).toLocaleString()}
                    </div>
                  </div>

                  <div className="text-sm text-muted-foreground md:col-span-3 md:text-right">
                    <div className="truncate">{d.name_servers?.length ? d.name_servers.join(", ") : "-"}</div>
                  </div>

                  <div className="flex justify-end md:col-span-2">
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => setPendingDelete(d)}
                      disabled={deleting[d.zone_id]}
                    >
                      {t("delete")}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title={t("confirmDelete")}
        description={pendingDelete ? t("confirmDeleteDescription", { domain: pendingDelete.domain }) : undefined}
        confirmText={t("delete")}
        cancelText={common("cancel")}
        confirmVariant="destructive"
        loading={Boolean(pendingDelete && deleting[pendingDelete.zone_id])}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => void confirmDelete()}
      />
    </div>
  );
}
