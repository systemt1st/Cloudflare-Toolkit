"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { useTranslations } from "next-intl";

import { applyTheme, getThemeMode, resolveTheme } from "@/lib/theme";

export default function ThemeToggle() {
  const common = useTranslations("Common");

  const [resolved, setResolved] = useState<"light" | "dark">("light");

  useEffect(() => {
    const update = () => {
      const mode = getThemeMode();
      setResolved(resolveTheme(mode));
    };
    update();

    const media = window.matchMedia?.("(prefers-color-scheme: dark)");
    const handler = () => update();
    media?.addEventListener?.("change", handler);
    window.addEventListener("storage", handler);
    return () => {
      media?.removeEventListener?.("change", handler);
      window.removeEventListener("storage", handler);
    };
  }, []);

  const label = common("toggleTheme");

  return (
    <button
      type="button"
      className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-black/5 bg-white/40 text-foreground shadow-sm transition-colors duration-200 hover:bg-white/70 dark:border-white/10 dark:bg-white/10 dark:hover:bg-white/15"
      onClick={() => {
        const next = resolved === "dark" ? "light" : "dark";
        applyTheme(next);
        setResolved(next);
      }}
      aria-label={label}
      title={label}
    >
      {resolved === "dark" ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
    </button>
  );
}
