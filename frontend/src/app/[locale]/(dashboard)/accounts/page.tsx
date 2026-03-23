"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";

import { Link } from "@/i18n/navigation";
import { apiRequest, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import ConfirmDialog from "@/components/ui/confirm-dialog";
import DashboardPageHeader from "@/components/dashboard/page-header";

type Account = {
  id: string;
  name: string;
  credential_type: "api_token" | "global_key";
  created_at: string;
};

export default function AccountsPage() {
  const t = useTranslations("Accounts");
  const common = useTranslations("Common");

  const [items, setItems] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [credentialType, setCredentialType] = useState<Account["credential_type"]>("api_token");
  const [apiToken, setApiToken] = useState("");
  const [cfEmail, setCfEmail] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Account | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [verifyState, setVerifyState] = useState<
    Record<string, { status: "verifying" | "success" | "error"; progress: number; message: string }>
  >({});
  const verifyTimers = useRef<Record<string, number>>({});

  const isApiToken = useMemo(() => credentialType === "api_token", [credentialType]);

  useEffect(() => {
    const timers = verifyTimers.current;
    return () => {
      Object.values(timers).forEach((timer) => window.clearInterval(timer));
    };
  }, []);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const data = await apiRequest<Account[]>("/api/v1/accounts", { method: "GET" });
      setItems(data);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : common("unknownError"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setMessage(null);
    try {
      const credentials =
        credentialType === "api_token"
          ? { api_token: apiToken }
          : { email: cfEmail, api_key: apiKey };

      await apiRequest<Account>("/api/v1/accounts", {
        method: "POST",
        body: JSON.stringify({ name, credential_type: credentialType, credentials }),
      });

      setName("");
      setApiToken("");
      setCfEmail("");
      setApiKey("");
      setMessage(t("created"));
      await load();
    } catch (e: unknown) {
      setMessage(null);
      setError(e instanceof ApiError ? e.message : common("unknownError"));
    } finally {
      setSubmitting(false);
    }
  }

  async function onVerify(id: string) {
    setMessage(null);
    setError(null);
    setVerifyState((prev) => ({
      ...prev,
      [id]: { status: "verifying", progress: 12, message: common("loading") },
    }));
    if (verifyTimers.current[id]) window.clearInterval(verifyTimers.current[id]);
    delete verifyTimers.current[id];
    verifyTimers.current[id] = window.setInterval(() => {
      setVerifyState((prev) => {
        const current = prev[id];
        if (!current || current.status !== "verifying") return prev;
        const nextProgress = Math.min(current.progress + 6 + Math.floor(Math.random() * 8), 90);
        return {
          ...prev,
          [id]: { ...current, progress: nextProgress },
        };
      });
    }, 320);
    try {
      await apiRequest<{ verified: boolean }>(`/api/v1/accounts/${id}/verify`, { method: "POST" });
      if (verifyTimers.current[id]) window.clearInterval(verifyTimers.current[id]);
      delete verifyTimers.current[id];
      setVerifyState((prev) => ({
        ...prev,
        [id]: { status: "success", progress: 100, message: t("verified") },
      }));
    } catch (e: unknown) {
      const msg = e instanceof ApiError ? e.message : common("unknownError");
      if (verifyTimers.current[id]) window.clearInterval(verifyTimers.current[id]);
      delete verifyTimers.current[id];
      setVerifyState((prev) => ({
        ...prev,
        [id]: { status: "error", progress: 100, message: msg },
      }));
    }
  }

  async function onDelete(id: string) {
    setMessage(null);
    setError(null);
    setDeletingId(id);
    try {
      await apiRequest<void>(`/api/v1/accounts/${id}`, { method: "DELETE" });
      setMessage(t("deleted"));
      await load();
    } catch (e: unknown) {
      setError(e instanceof ApiError ? e.message : common("unknownError"));
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="space-y-6">
      <DashboardPageHeader title={t("title")} subtitle={t("subtitle")} />

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
          <CardTitle className="text-xl">{t("listTitle")}</CardTitle>
          <Button variant="secondary" onClick={() => void load()} disabled={loading} size="sm">
            {t("refresh")}
          </Button>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-3" aria-busy="true" aria-live="polite">
              {Array.from({ length: 3 }).map((_, idx) => (
                <div key={idx} className="rounded-2xl zen-surface-subtle p-4">
                  <Skeleton className="h-5 w-64 max-w-full" />
                  <Skeleton className="mt-2 h-4 w-80 max-w-full" />
                </div>
              ))}
            </div>
          ) : items.length === 0 ? (
            <div className="text-sm text-muted-foreground">{t("empty")}</div>
          ) : (
            <div className="space-y-4">
              {items.map((a) => (
                <div
                  key={a.id}
                  className="flex flex-col justify-between gap-4 rounded-2xl zen-surface-subtle p-4 transition-colors hover:bg-white/55 md:flex-row md:items-center"
                >
                  <div className="min-w-0">
                    <div className="truncate text-base font-medium">{a.name}</div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {t("type")}: <span className="font-mono text-xs">{a.credential_type}</span> · {t("createdAt")}:{" "}
                      {new Date(a.created_at).toLocaleString()}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Link href={`/accounts/${a.id}/edit`}>
                      <Button variant="outline" size="sm" className="h-9">
                        {t("edit")}
                      </Button>
                    </Link>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => void onVerify(a.id)}
                      className="h-9"
                      disabled={verifyState[a.id]?.status === "verifying"}
                    >
                      {t("verify")}
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => setPendingDelete(a)}
                      className="h-9"
                      disabled={deletingId === a.id}
                    >
                      {t("delete")}
                    </Button>
                    {verifyState[a.id] ? (
                      <div className="w-full md:w-56">
                        <div className="h-2 w-full rounded-full bg-gray-100 dark:bg-gray-800">
                          <div
                            className={`h-full rounded-full transition-[width] duration-200 ${
                              verifyState[a.id].status === "error"
                                ? "bg-red-600 dark:bg-red-500"
                                : verifyState[a.id].status === "success"
                                  ? "bg-green-600 dark:bg-green-500"
                                  : "bg-blue-600 dark:bg-blue-500"
                            }`}
                            style={{ width: `${verifyState[a.id].progress}%` }}
                          />
                        </div>
                        <div
                          className={`mt-1 text-xs transition-colors duration-200 ${
                            verifyState[a.id].status === "error"
                              ? "text-red-600 dark:text-red-400"
                              : verifyState[a.id].status === "success"
                                ? "text-green-600 dark:text-green-400"
                                : "text-gray-500 dark:text-gray-400"
                          }`}
                          role={verifyState[a.id].status === "error" ? "alert" : "status"}
                        >
                          {verifyState[a.id].message}
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title={t("confirmDelete")}
        description={pendingDelete ? pendingDelete.name : undefined}
        confirmText={t("delete")}
        cancelText={common("cancel")}
        confirmVariant="destructive"
        loading={Boolean(pendingDelete && deletingId === pendingDelete.id)}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => {
          if (!pendingDelete) return;
          void onDelete(pendingDelete.id).finally(() => setPendingDelete(null));
        }}
      />

      <Card>
        <CardHeader>
          <CardTitle>{t("addTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={onCreate}>
            <div className="space-y-2">
              <Label htmlFor="name" className="text-sm tracking-wide">
                {t("name")}
              </Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                placeholder={t("name")}
                className="h-14 text-lg"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="type" className="text-sm tracking-wide">
                {t("credentialType")}
              </Label>
              <select
                id="type"
                value={credentialType}
                onChange={(e) => setCredentialType(e.target.value as Account["credential_type"])}
                className="zen-surface-subtle h-14 w-full rounded-xl px-4 text-lg text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/25 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <option value="api_token">{t("apiToken")}</option>
                <option value="global_key">{t("globalKey")}</option>
              </select>
            </div>

            {isApiToken ? (
              <div className="space-y-2">
                <Label htmlFor="apiToken" className="text-sm tracking-wide">
                  {t("apiTokenValue")}
                </Label>
                <Input
                  id="apiToken"
                  value={apiToken}
                  onChange={(e) => setApiToken(e.target.value)}
                  placeholder="Bearer Token"
                  required
                  className="h-14 text-lg"
                />
              </div>
            ) : (
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="cfEmail" className="text-sm tracking-wide">
                    {t("cfEmail")}
                  </Label>
                  <Input
                    id="cfEmail"
                    value={cfEmail}
                    onChange={(e) => setCfEmail(e.target.value)}
                    placeholder="cf@example.com"
                    required
                    className="h-14 text-lg"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="apiKey" className="text-sm tracking-wide">
                    {t("apiKey")}
                  </Label>
                  <Input
                    id="apiKey"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder="Global API Key"
                    required
                    className="h-14 text-lg"
                  />
                </div>
              </div>
            )}

            <Button type="submit" size="lg" disabled={submitting}>
              {submitting ? common("loading") : t("create")}
            </Button>

            {message ? (
              <div
                className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700 shadow-sm transition-colors duration-200 dark:border-green-900/40 dark:bg-green-900/20 dark:text-green-300"
                role="status"
              >
                {message}
              </div>
            ) : null}
            {error ? (
              <div
                className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600 shadow-sm transition-colors duration-200 dark:border-red-900/40 dark:bg-red-900/20 dark:text-red-300"
                role="alert"
              >
                {error}
              </div>
            ) : null}
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
