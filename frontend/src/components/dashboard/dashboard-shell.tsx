"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, usePathname } from "next/navigation";
import { useTranslations } from "next-intl";

import { Link } from "@/i18n/navigation";
import RequireAuth from "@/components/auth/require-auth";
import { sidebarConfig } from "@/config/navigation";
import { subscribeDashboardMobileMenuToggle } from "@/lib/events";
import { CloudLightning, X } from "lucide-react";
import { Button } from "@/components/ui/button";

type Props = {
  children: React.ReactNode;
  initialAuthed?: boolean;
};

export default function DashboardShell({ children, initialAuthed }: Props) {
  const nav = useTranslations("Nav");
  const home = useTranslations("Home");
  const common = useTranslations("Common");
  const pathname = usePathname() || "";
  const params = useParams<{ locale?: string }>();
  const locale = useMemo(() => params?.locale || "zh", [params]);
  const [mobileOpen, setMobileOpen] = useState(false);
  const enablePrefetch = process.env.NODE_ENV === "production";

  const pathWithoutLocale = useMemo(() => {
    const prefix = `/${locale}`;
    if (pathname === prefix) return "/";
    if (pathname.startsWith(`${prefix}/`)) return pathname.slice(prefix.length) || "/";
    return pathname || "/";
  }, [locale, pathname]);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  useEffect(() => {
    document.documentElement.classList.add("dashboard-mode");
    return () => {
      document.documentElement.classList.remove("dashboard-mode");
    };
  }, []);

  useEffect(() => {
    return subscribeDashboardMobileMenuToggle(() => setMobileOpen((prev) => !prev));
  }, []);

  useEffect(() => {
    if (!mobileOpen) return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileOpen(false);
    };
    document.addEventListener("keydown", handleKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKey);
    };
  }, [mobileOpen]);

  function isActive(href: string) {
    return pathWithoutLocale === href || pathWithoutLocale.startsWith(`${href}/`);
  }

  return (
    <RequireAuth initialAuthed={initialAuthed}>
      <div className="flex min-h-[calc(100vh-4rem)] bg-background">
        {mobileOpen ? (
          <div className="fixed inset-x-0 bottom-0 top-16 z-[70] md:hidden">
            <button
              type="button"
              className="absolute inset-0 bg-black/40"
              onClick={() => setMobileOpen(false)}
              aria-label={common("close")}
            />

            <aside className="relative z-10 h-full w-[18rem] max-w-[86vw] border-r zen-divider bg-white/55 backdrop-blur-[60px]">
              <div className="flex h-16 items-center justify-between px-6 border-b zen-divider">
                <Link
                  href="/accounts"
                  prefetch={enablePrefetch}
                  className="flex items-center gap-2 font-semibold"
                >
                  <CloudLightning className="h-5 w-5" />
                  <span>{home("title")}</span>
                </Link>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setMobileOpen(false)}
                  aria-label={common("close")}
                >
                  <X className="h-5 w-5" />
                </Button>
              </div>
              <nav className="h-[calc(100%-4rem)] overflow-y-auto p-4 space-y-1">
                {sidebarConfig.map((item) => {
                  const Icon = item.icon;
                  const active = isActive(item.href);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      prefetch={enablePrefetch}
                      className={`flex items-center gap-3 rounded-2xl px-3 py-2 text-sm font-medium transition-colors ${
                        active
                          ? "bg-white/75 text-foreground shadow-sm"
                          : "text-muted-foreground hover:bg-white/55 hover:text-foreground"
                      }`}
                      aria-current={active ? "page" : undefined}
                    >
                      <Icon className="h-4 w-4" />
                      {nav(item.labelKey)}
                    </Link>
                  );
                })}
              </nav>
            </aside>
          </div>
        ) : null}

        <aside className="fixed bottom-0 top-16 z-40 hidden w-64 flex-shrink-0 border-r zen-divider bg-white/45 backdrop-blur-[60px] md:block">
          <div className="flex h-16 items-center px-6 border-b zen-divider">
            <Link
              href="/accounts"
              prefetch={enablePrefetch}
              className="flex items-center gap-2 font-semibold"
            >
              <CloudLightning className="h-6 w-6" />
              <span>{home("title")}</span>
            </Link>
          </div>
          <nav className="h-[calc(100%-4rem)] overflow-y-auto p-4 space-y-1">
            {sidebarConfig.map((item) => {
              const Icon = item.icon;
              const active = isActive(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  prefetch={enablePrefetch}
                  className={`flex items-center gap-3 rounded-2xl px-3 py-2 text-sm font-medium transition-colors ${
                    active
                      ? "bg-white/75 text-foreground shadow-sm"
                      : "text-muted-foreground hover:bg-white/55 hover:text-foreground"
                  }`}
                  aria-current={active ? "page" : undefined}
                >
                  <Icon className="h-4 w-4" />
                  {nav(item.labelKey)}
                </Link>
              );
            })}
          </nav>
        </aside>

        <div className="flex-1 md:pl-64">
          <main className="w-full p-5 md:p-6 space-y-6">{children}</main>
        </div>
      </div>
    </RequireAuth>
  );
}
