"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";

import { useRouter } from "@/i18n/navigation";
import { subscribeGlobalNotice, type GlobalNotice } from "@/lib/events";
import { Button } from "@/components/ui/button";

export default function GlobalNoticeBar() {
  const common = useTranslations("Common");
  const router = useRouter();
  const params = useParams<{ locale?: string }>();
  const locale = useMemo(() => params?.locale || "zh", [params]);
  const [notice, setNotice] = useState<GlobalNotice | null>(null);

  useEffect(() => {
    return subscribeGlobalNotice((next) => setNotice(next));
  }, []);

  const visible = Boolean(notice && notice.type === "quota_exceeded");
  if (!visible) return null;

  return (
    <div
      className="sticky top-16 z-40 border-b zen-divider bg-amber-50/70 text-amber-950 backdrop-blur-[40px] dark:bg-amber-950/25 dark:text-amber-50"
      role="status"
      aria-live="polite"
    >
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-2 px-6 py-3 md:flex-row md:items-center md:justify-between">
        <div className="text-sm font-medium">{common("quotaExceeded")}</div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            onClick={() => {
              setNotice(null);
              router.push("/subscription", { locale });
            }}
          >
            {common("goToSubscription")}
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setNotice(null)}>
            {common("close")}
          </Button>
        </div>
      </div>
    </div>
  );
}

