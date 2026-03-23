"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";

import { apiRequest, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import DashboardPageHeader from "@/components/dashboard/page-header";

type OperationLogItem = {
  id: string;
  operation_type: string;
  target_domain?: string | null;
  result: string;
  details?: { message?: string } | null;
  created_at: string;
};

type OperationLogListResponse = {
  items: OperationLogItem[];
  total: number;
  limit: number;
  offset: number;
};

export default function OperationLogsPage() {
  const t = useTranslations("OperationLogs");
  const common = useTranslations("Common");

  const [operationType, setOperationType] = useState("");
  const [domainKeyword, setDomainKeyword] = useState("");

  const [items, setItems] = useState<OperationLogItem[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const limit = 50;
  const hasMore = useMemo(() => items.length < total, [items.length, total]);

  async function load(reset = false) {
    setLoading(true);
    setError(null);
    try {
      const nextOffset = reset ? 0 : offset;
      const params = new URLSearchParams({
        limit: String(limit),
        offset: String(nextOffset),
      });
      if (operationType.trim()) params.set("operation_type", operationType.trim());
      if (domainKeyword.trim()) params.set("target_domain", domainKeyword.trim());

      const data = await apiRequest<OperationLogListResponse>(`/api/v1/operation-logs?${params.toString()}`, {
        method: "GET",
      });
      setTotal(data.total);
      setOffset(data.offset + data.items.length);
      setItems((prev) => (reset ? data.items : [...prev, ...data.items]));
    } catch (e: unknown) {
      setError(e instanceof ApiError ? e.message : common("unknownError"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onSearch(e: React.FormEvent) {
    e.preventDefault();
    setItems([]);
    setOffset(0);
    await load(true);
  }

  return (
    <div className="space-y-6">
      <DashboardPageHeader title={t("title")} subtitle={t("subtitle")} />

      <div className="rounded-[28px] zen-surface p-6">
        <form className="grid gap-4 md:grid-cols-3" onSubmit={onSearch}>
          <div className="space-y-2">
            <Label htmlFor="operationType" className="text-sm tracking-wide">
              {t("operationType")}
            </Label>
            <Input
              id="operationType"
              value={operationType}
              onChange={(e) => setOperationType(e.target.value)}
              placeholder={t("operationTypePlaceholder")}
              className="h-14 text-lg"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="domain" className="text-sm tracking-wide">
              {t("domain")}
            </Label>
            <Input
              id="domain"
              value={domainKeyword}
              onChange={(e) => setDomainKeyword(e.target.value)}
              placeholder={t("domainPlaceholder")}
              className="h-14 text-lg"
            />
          </div>
          <div className="flex items-end gap-2">
            <Button type="submit" size="lg" disabled={loading}>
              {loading ? common("loading") : t("search")}
            </Button>
            <Button
              variant="secondary"
              size="lg"
              type="button"
              onClick={() => void load(true)}
              disabled={loading}
            >
              {t("refresh")}
            </Button>
          </div>
        </form>
        {error ? <div className="mt-4 text-sm text-destructive">{error}</div> : null}
      </div>

      <div className="rounded-[28px] zen-surface overflow-hidden">
        <div className="flex items-center justify-between border-b zen-divider px-6 py-4">
          <div className="text-base font-semibold text-foreground">
            {t("listTitle")} {total ? `(${items.length}/${total})` : ""}
          </div>
          {hasMore ? (
            <Button variant="secondary" onClick={() => void load(false)} disabled={loading}>
              {loading ? common("loading") : t("loadMore")}
            </Button>
          ) : null}
        </div>
        <div className="p-6">
          {items.length === 0 ? (
            loading ? (
              <div className="space-y-2" aria-busy="true" aria-live="polite">
                {Array.from({ length: 8 }).map((_, idx) => (
                  <div key={idx} className="rounded-2xl zen-surface-subtle p-4">
                    <div className="flex flex-col justify-between gap-2 md:flex-row md:items-center">
                      <div className="min-w-0 space-y-2">
                        <Skeleton className="h-5 w-64 max-w-full" />
                        <Skeleton className="h-4 w-40 max-w-full" />
                        <Skeleton className="h-4 w-96 max-w-full" />
                      </div>
                      <Skeleton className="h-5 w-20 rounded-full" />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-sm text-muted-foreground">{t("empty")}</div>
            )
          ) : (
            <div className="space-y-2">
              {items.map((r) => (
                <div key={r.id} className="rounded-2xl zen-surface-subtle p-4">
                  <div className="flex flex-col justify-between gap-1 md:flex-row md:items-center">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-foreground">
                        {r.operation_type}
                        {r.target_domain ? ` · ${r.target_domain}` : ""}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">{new Date(r.created_at).toLocaleString()}</div>
                      {r.details?.message ? <div className="mt-2 text-xs text-muted-foreground">{r.details.message}</div> : null}
                    </div>
                    <div className={r.result === "success" ? "text-xs text-emerald-700" : "text-xs text-destructive"}>
                      {r.result === "success" ? common("success") : r.result === "error" ? common("error") : r.result}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
