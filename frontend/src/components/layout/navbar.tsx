"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";

import { Link, usePathname, useRouter } from "@/i18n/navigation";
import { useTranslations } from "next-intl";
import { Button } from "../ui/button";
import { CloudLightning, CreditCard, Grid, LogOut, Menu, RefreshCw, UserRound } from "lucide-react";

import { apiRequest } from "@/lib/api";
import { isAuthed as isAuthedCookie, markLoggedOut, subscribeAuthChanged } from "@/lib/auth";
import { ensureAuthed } from "@/lib/auth-bootstrap";
import { dispatchDashboardMobileMenuToggle } from "@/lib/events";
import UserInfo from "@/components/layout/user-info";
import ThemeToggle from "@/components/layout/theme-toggle";

type Props = {
  initialAuthed?: boolean;
};

export function Navbar({ initialAuthed }: Props) {
  const nav = useTranslations("Nav");
  const common = useTranslations("Common");
  const [isAuthed, setIsAuthed] = useState(() => Boolean(initialAuthed));
  const [menuOpen, setMenuOpen] = useState(false);
  const [logoutLoading, setLogoutLoading] = useState(false);
  const bootstrapRef = useRef(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const pathname = usePathname() || "";
  const router = useRouter();
  const params = useParams<{ locale?: string }>();
  const locale = useMemo(() => params?.locale || "zh", [params]);
  const enablePrefetch = process.env.NODE_ENV === "production";

  const isDashboardRoute = useMemo(() => {
    const prefix = `/${locale}`;
    const path = pathname.startsWith(prefix) ? pathname.slice(prefix.length) || "/" : pathname || "/";
    const dashboardPrefixes = [
      "/accounts",
      "/domains",
      "/dns",
      "/ssl",
      "/cache",
      "/speed",
      "/rules",
      "/other",
      "/tasks",
      "/operation-logs",
      "/subscription",
    ];
    return dashboardPrefixes.some((p) => path === p || path.startsWith(`${p}/`));
  }, [locale, pathname]);

  async function doLogout(redirectTo: "home" | "login") {
    setLogoutLoading(true);
    try {
      await apiRequest("/api/v1/auth/logout", { method: "POST", auth: false }).catch(() => null);
    } finally {
      markLoggedOut();
      setMenuOpen(false);
      setLogoutLoading(false);
      router.replace(redirectTo === "login" ? "/login" : "/", { locale });
    }
  }

  useEffect(() => {
    const update = () => {
      const authed = isAuthedCookie();
      if (!authed && initialAuthed && !bootstrapRef.current) {
        bootstrapRef.current = true;
        setIsAuthed(true);
        ensureAuthed(initialAuthed).then((ok) => {
          if (!ok) setIsAuthed(false);
        });
        return;
      }

      setIsAuthed(authed);
    };
    update();
    return subscribeAuthChanged(update);
  }, [initialAuthed]);

  useEffect(() => {
    if (!menuOpen) return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    const handleClick = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (!menuRef.current) return;
      if (!menuRef.current.contains(target)) setMenuOpen(false);
    };
    document.addEventListener("keydown", handleKey);
    document.addEventListener("mousedown", handleClick);
    return () => {
      document.removeEventListener("keydown", handleKey);
      document.removeEventListener("mousedown", handleClick);
    };
  }, [menuOpen]);

  return (
    <nav className="sticky top-0 z-50 w-full glass-nav transition-colors duration-300">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
        <Link
          href="/"
          prefetch={enablePrefetch}
          className="flex items-center gap-2 text-foreground text-xl font-semibold tracking-tight"
        >
          <CloudLightning className="h-6 w-6 text-[#0071e3]" />
          <span className="hidden sm:inline-block">{nav("brand")}</span>
        </Link>
        
        <div className="hidden md:flex items-center space-x-8">
          <Link
            href="/features"
            prefetch={enablePrefetch}
            className="text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            {nav("features")}
          </Link>
          <Link
            href="/pricing"
            prefetch={enablePrefetch}
            className="text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            {nav("pricing")}
          </Link>
        </div>

        <div className="flex items-center gap-3">
          <ThemeToggle />

          {isAuthed && isDashboardRoute ? (
            <button
              type="button"
              className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-black/5 bg-white/40 text-[#1d1d1f] shadow-sm transition-colors duration-200 hover:bg-white/70 dark:border-white/10 dark:bg-white/10 dark:text-white dark:hover:bg-white/15 md:hidden"
              onClick={() => {
                dispatchDashboardMobileMenuToggle();
              }}
              aria-label={common("menu")}
            >
              <Menu className="h-5 w-5" />
            </button>
          ) : null}

          {isAuthed ? (
            <div className="relative" ref={menuRef}>
              <button
                type="button"
                className="inline-flex h-11 items-center gap-2 rounded-full border border-black/5 bg-white/40 px-4 text-sm font-semibold text-[#1d1d1f] shadow-sm transition-colors duration-200 hover:bg-white/70 dark:border-white/10 dark:bg-white/10 dark:text-white dark:hover:bg-white/15 md:min-w-[5.5rem]"
                onClick={() => setMenuOpen((v) => !v)}
                aria-haspopup="menu"
                aria-expanded={menuOpen}
              >
                <UserRound className="h-4 w-4" />
                <span className="hidden md:inline">{nav("account")}</span>
              </button>

              {menuOpen ? (
                <div
                  className="absolute right-0 mt-3 w-80 overflow-hidden rounded-2xl border border-gray-200 bg-white/80 shadow-[0_24px_48px_-12px_rgba(0,0,0,0.18)] backdrop-blur-[60px] dark:border-gray-700 dark:bg-gray-900/80"
                  role="menu"
                >
                  <div className="border-b border-gray-200/70 p-4 dark:border-gray-700/70">
                    <UserInfo />
                  </div>
                  <div className="p-2">
                    <Link
                      href="/accounts"
                      prefetch={enablePrefetch}
                      className="flex items-center gap-3 rounded-xl px-3 py-2 text-sm text-gray-700 transition-colors duration-200 hover:bg-white/70 hover:text-gray-900 dark:text-gray-200 dark:hover:bg-gray-800/60"
                      role="menuitem"
                      onClick={() => setMenuOpen(false)}
                    >
                      <Grid className="h-4 w-4" />
                      <span>{nav("dashboard")}</span>
                    </Link>
                    <Link
                      href="/subscription"
                      prefetch={enablePrefetch}
                      className="flex items-center gap-3 rounded-xl px-3 py-2 text-sm text-gray-700 transition-colors duration-200 hover:bg-white/70 hover:text-gray-900 dark:text-gray-200 dark:hover:bg-gray-800/60"
                      role="menuitem"
                      onClick={() => setMenuOpen(false)}
                    >
                      <CreditCard className="h-4 w-4" />
                      <span>{nav("subscription")}</span>
                    </Link>

                    <div className="my-2 h-px bg-gray-200/70 dark:bg-gray-700/70" />

                    <button
                      type="button"
                      className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm text-gray-700 transition-colors duration-200 hover:bg-white/70 hover:text-gray-900 disabled:opacity-50 dark:text-gray-200 dark:hover:bg-gray-800/60"
                      role="menuitem"
                      onClick={() => void doLogout("home")}
                      disabled={logoutLoading}
                    >
                      <LogOut className="h-4 w-4" />
                      <span>{nav("logout")}</span>
                    </button>

                    <button
                      type="button"
                      className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm text-gray-700 transition-colors duration-200 hover:bg-white/70 hover:text-gray-900 disabled:opacity-50 dark:text-gray-200 dark:hover:bg-gray-800/60"
                      role="menuitem"
                      onClick={() => void doLogout("login")}
                      disabled={logoutLoading}
                    >
                      <RefreshCw className="h-4 w-4" />
                      <span>{nav("switchAccount")}</span>
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          ) : (
            <>
              <Link
                href="/login"
                prefetch={enablePrefetch}
              >
                <Button variant="ghost" size="default" className="rounded-full h-11 px-6 text-sm">
                  {nav("login")}
                </Button>
              </Link>
              <Link
                href="/register"
                prefetch={enablePrefetch}
                className="hidden sm:block"
              >
                <Button size="default" className="rounded-full h-11 px-6 text-sm">
                  {nav("register")}
                </Button>
              </Link>
            </>
          )}
        </div>
      </div>
    </nav>
  );
}
