"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { useParams, useRouter } from "next/navigation";

import { apiRequest, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import DashboardPageHeader from "@/components/dashboard/page-header";

type Account = {
  id: string;
  name: string;
  credential_type: "api_token" | "global_key";
  created_at: string;
};

export default function AccountEditPage() {
  const t = useTranslations("AccountEdit");
  const common = useTranslations("Common");
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const accountId = params?.id || "";

  const [account, setAccount] = useState<Account | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [credentialType, setCredentialType] = useState<Account["credential_type"]>("api_token");
  const [apiToken, setApiToken] = useState("");
  const [cfEmail, setCfEmail] = useState("");
  const [apiKey, setApiKey] = useState("");

  const isApiToken = useMemo(() => credentialType === "api_token", [credentialType]);

  async function load() {
    if (!accountId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await apiRequest<Account>(`/api/v1/accounts/${accountId}`, { method: "GET" });
      setAccount(data);
      setName(data.name);
      setCredentialType(data.credential_type);
    } catch (e: unknown) {
      setError(e instanceof ApiError ? e.message : common("unknownError"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId]);

  function buildUpdatePayload(): { name: string; credential_type?: string; credentials?: object } {
    const payload: { name: string; credential_type?: string; credentials?: object } = { name };
    if (!account) return payload;

    const typeChanged = credentialType !== account.credential_type;
    const hasAnyCredential = Boolean(apiToken.trim() || cfEmail.trim() || apiKey.trim());

    if (!typeChanged && !hasAnyCredential) return payload;

    payload.credential_type = credentialType;
    if (credentialType === "api_token") {
      if (!apiToken.trim()) throw new Error(t("needApiToken"));
      payload.credentials = { api_token: apiToken.trim() };
      return payload;
    }

    if (!cfEmail.trim() || !apiKey.trim()) throw new Error(t("needEmailAndKey"));
    payload.credentials = { email: cfEmail.trim(), api_key: apiKey.trim() };
    return payload;
  }

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    if (!accountId) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const payload = buildUpdatePayload();
      const updated = await apiRequest<Account>(`/api/v1/accounts/${accountId}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
      setAccount(updated);
      setMessage(t("saved"));
      setApiToken("");
      setCfEmail("");
      setApiKey("");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : common("unknownError"));
    } finally {
      setSaving(false);
    }
  }

  async function onVerify() {
    if (!accountId) return;
    setVerifying(true);
    setError(null);
    setMessage(null);
    try {
      await apiRequest<{ verified: boolean }>(`/api/v1/accounts/${accountId}/verify`, { method: "POST" });
      setMessage(t("verified"));
    } catch (e: unknown) {
      setError(e instanceof ApiError ? e.message : common("unknownError"));
    } finally {
      setVerifying(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <DashboardPageHeader title={t("title")} subtitle={t("subtitle")} />

        <div className="rounded-[28px] zen-surface p-6">
          <div className="space-y-4">
            <div className="space-y-2">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-14 w-full rounded-xl" />
            </div>

            <div className="space-y-2">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-14 w-full rounded-xl" />
              <Skeleton className="h-4 w-96 max-w-full" />
            </div>

            <div className="space-y-2">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-14 w-full rounded-xl" />
            </div>

            <div className="flex flex-wrap gap-2">
              <Skeleton className="h-14 w-32 rounded-full" />
              <Skeleton className="h-14 w-32 rounded-full" />
              <Skeleton className="h-14 w-32 rounded-full" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!account) {
    return (
      <div className="space-y-3">
        <div className="text-sm text-destructive">{error || t("notFound")}</div>
        <Button variant="secondary" onClick={() => router.back()}>
          {common("back")}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <DashboardPageHeader title={t("title")} subtitle={t("subtitle")} />

      <div className="rounded-[28px] zen-surface p-6">
        <form className="space-y-4" onSubmit={onSave}>
          <div className="space-y-2">
            <Label htmlFor="name" className="text-sm tracking-wide">
              {t("name")}
            </Label>
            <Input id="name" value={name} onChange={(e) => setName(e.target.value)} required className="h-14 text-lg" />
          </div>

          <div className="space-y-2">
            <Label htmlFor="type" className="text-sm tracking-wide">
              {t("credentialType")}
            </Label>
            <select
              id="type"
              value={credentialType}
              onChange={(e) => setCredentialType(e.target.value as Account["credential_type"])}
              className="zen-surface-subtle h-14 w-full rounded-xl px-4 text-lg text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/25 focus-visible:ring-offset-2"
            >
              <option value="api_token">{t("apiToken")}</option>
              <option value="global_key">{t("globalKey")}</option>
            </select>
            <div className="text-xs text-muted-foreground">{t("credentialsHint")}</div>
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
                  className="h-14 text-lg"
                />
              </div>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="lg" disabled={saving}>
              {saving ? common("loading") : t("save")}
            </Button>
            <Button
              variant="secondary"
              size="lg"
              type="button"
              onClick={() => void onVerify()}
              disabled={verifying}
            >
              {verifying ? common("loading") : t("verify")}
            </Button>
            <Button variant="secondary" size="lg" type="button" onClick={() => router.back()}>
              {common("back")}
            </Button>
          </div>

          {message ? <div className="text-sm text-emerald-700">{message}</div> : null}
          {error ? <div className="text-sm text-destructive">{error}</div> : null}
        </form>
      </div>
    </div>
  );
}
