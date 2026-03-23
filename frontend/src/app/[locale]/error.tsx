"use client";

import { useTranslations } from "next-intl";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations("Common");

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-center">
      <h2 className="text-2xl font-semibold text-foreground">{t("errorTitle")}</h2>
      <p className="max-w-md text-sm text-muted-foreground">
        {t("errorMessage")}
      </p>
      <button
        type="button"
        onClick={() => reset()}
        className="rounded-full border border-black/10 bg-white/70 px-5 py-2 text-sm font-medium text-foreground shadow-sm transition hover:bg-white"
      >
        {t("retry")}
      </button>
    </div>
  );
}
