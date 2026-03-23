"use client";

import { useTranslations } from "next-intl";

export default function Loading() {
  const t = useTranslations("Common");
  return (
    <div className="flex min-h-[60vh] items-center justify-center text-sm text-muted-foreground">
      {t("loading")}
    </div>
  );
}
