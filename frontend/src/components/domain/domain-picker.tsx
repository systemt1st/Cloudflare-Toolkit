"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";

import { ApiError, apiRequest } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";

type DomainItem = {
  domain: string;
  zone_id: string;
  status: string;
  cached_at: string;
  name_servers?: string[] | null;
};

export default function DomainPicker({
  accountId,
  open,
  onClose,
  onConfirm,
}: {
  accountId: string;
  open: boolean;
  onClose: () => void;
  onConfirm: (domains: string[]) => void;
}) {
  const t = useTranslations("DomainPicker");
  const common = useTranslations("Common");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [domains, setDomains] = useState<DomainItem[]>([]);
  const [keyword, setKeyword] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(1);
  const pageSize = 50;

  const dialogRef = useRef<HTMLDivElement | null>(null);
  const keywordRef = useRef<HTMLInputElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  const filtered = useMemo(() => {
    const q = keyword.trim().toLowerCase();
    if (!q) return domains;
    return domains.filter((d) => d.domain.toLowerCase().includes(q));
  }, [domains, keyword]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageItems = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [filtered, currentPage]);

  async function loadDomains() {
    if (!accountId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await apiRequest<DomainItem[]>(`/api/v1/accounts/${accountId}/domains`, {
        method: "GET",
      });
      setDomains(data);
      setPage(1);
    } catch (e: unknown) {
      setError(e instanceof ApiError ? e.message : common("unknownError"));
    } finally {
      setLoading(false);
    }
  }

  async function refreshCache() {
    if (!accountId) return;
    setLoading(true);
    setError(null);
    try {
      await apiRequest(`/api/v1/accounts/${accountId}/domains/refresh`, { method: "POST" });
      await loadDomains();
    } catch (e: unknown) {
      setError(e instanceof ApiError ? e.message : common("unknownError"));
    } finally {
      setLoading(false);
    }
  }

  function toggle(domain: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(domain)) next.delete(domain);
      else next.add(domain);
      return next;
    });
  }

  function selectAllFiltered() {
    setSelected(new Set(filtered.map((d) => d.domain)));
  }

  function clearSelected() {
    setSelected(new Set());
  }

  function confirm() {
    const picked = domains.filter((d) => selected.has(d.domain)).map((d) => d.domain);
    onConfirm(picked);
    onClose();
  }

  useEffect(() => {
    if (!open) return;
    setSelected(new Set());
    setKeyword("");
    void loadDomains();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, accountId]);

  useEffect(() => {
    if (!open) return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key !== "Tab") return;

      const root = dialogRef.current;
      if (!root) return;

      const selectors = [
        'a[href]',
        "button:not([disabled])",
        "input:not([disabled])",
        "select:not([disabled])",
        "textarea:not([disabled])",
        '[tabindex]:not([tabindex="-1"])',
      ].join(", ");

      const candidates = Array.from(root.querySelectorAll<HTMLElement>(selectors));
      const focusables = candidates.filter((el) => {
        const style = window.getComputedStyle(el);
        if (style.visibility === "hidden" || style.display === "none") return false;
        return Boolean(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
      });

      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement as HTMLElement | null;

      if (event.shiftKey) {
        if (!active || active === first) {
          event.preventDefault();
          last.focus();
        }
        return;
      }

      if (active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    previousFocusRef.current = document.activeElement as HTMLElement | null;
    window.setTimeout(() => keywordRef.current?.focus(), 0);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKey);
      previousFocusRef.current?.focus?.();
    };
  }, [onClose, open]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className="w-full max-w-3xl rounded-[32px] zen-surface overflow-hidden"
        role="dialog"
        aria-modal="true"
        aria-labelledby="domain-picker-title"
        aria-describedby="domain-picker-desc"
      >
        <div className="flex items-center justify-between border-b zen-divider px-6 py-4">
          <div id="domain-picker-title" className="text-base font-semibold text-foreground">
            {t("title")}
          </div>
          <Button variant="secondary" onClick={onClose}>
            {t("cancel")}
          </Button>
        </div>

        <div className="space-y-4 px-6 py-4">
          <div className="grid gap-3 md:grid-cols-3">
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="keyword">{t("search")}</Label>
              <Input
                id="keyword"
                ref={keywordRef}
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                placeholder={t("searchPlaceholder")}
                disabled={loading}
              />
            </div>

            <div className="flex items-end gap-2">
              <Button variant="secondary" onClick={() => void loadDomains()} disabled={loading}>
                {t("reload")}
              </Button>
              <Button onClick={() => void refreshCache()} disabled={loading}>
                {t("refreshCache")}
              </Button>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div id="domain-picker-desc" className="text-sm text-muted-foreground">
              {t("selectedCount", { count: selected.size })}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={selectAllFiltered} disabled={loading || filtered.length === 0}>
                {t("selectAll")}
              </Button>
              <Button variant="secondary" onClick={clearSelected} disabled={loading || selected.size === 0}>
                {t("clear")}
              </Button>
              <Button onClick={confirm} disabled={selected.size === 0 || loading}>
                {t("confirm")}
              </Button>
            </div>
          </div>

          {error ? <div className="text-sm text-destructive">{error}</div> : null}

          <div className="max-h-[50vh] overflow-auto rounded-2xl zen-surface-subtle">
            {loading ? (
              <div className="space-y-2 p-4" aria-busy="true" aria-live="polite">
                {Array.from({ length: 10 }).map((_, idx) => (
                  <div key={idx} className="flex items-center gap-3 px-2 py-2">
                    <Skeleton className="h-4 w-4 rounded" />
                    <div className="min-w-0 flex-1 space-y-2">
                      <Skeleton className="h-4 w-64 max-w-full" />
                      <Skeleton className="h-3 w-48 max-w-full" />
                    </div>
                  </div>
                ))}
                <div className="text-xs text-muted-foreground">{common("loading")}</div>
              </div>
            ) : pageItems.length === 0 ? (
              <div className="p-4 text-sm text-muted-foreground">{t("empty")}</div>
            ) : (
              <div className="divide-y divide-black/10">
                {pageItems.map((d) => (
                  <label
                    key={d.zone_id}
                    className="flex cursor-pointer items-center gap-3 px-4 py-3 transition-colors hover:bg-white/55"
                  >
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-black/20 accent-primary"
                      checked={selected.has(d.domain)}
                      onChange={() => toggle(d.domain)}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-foreground">{d.domain}</div>
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        {d.status} · {new Date(d.cached_at).toLocaleString()}
                      </div>
                    </div>
                  </label>
                ))}
              </div>
            )}
          </div>

          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <div>
              {t("page", { current: currentPage, total: totalPages })}
            </div>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={loading || currentPage <= 1}
              >
                {t("prev")}
              </Button>
              <Button
                variant="secondary"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={loading || currentPage >= totalPages}
              >
                {t("next")}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
