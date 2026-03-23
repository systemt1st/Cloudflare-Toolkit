"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, usePathname, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";

import { isAuthed, subscribeAuthChanged } from "@/lib/auth";
import { ensureAuthed } from "@/lib/auth-bootstrap";
import { cn } from "@/lib/utils";
import { useRouter } from "@/i18n/navigation";

type Props = {
  children: React.ReactNode;
  className?: string;
  initialAuthed?: boolean;
};

export default function RequireAuth({ children, className, initialAuthed }: Props) {
  const params = useParams<{ locale?: string }>();
  const locale = useMemo(() => params?.locale || "zh", [params]);
  const pathname = usePathname() || "";
  const searchParams = useSearchParams();
  const nextPath = useMemo(() => {
    const prefix = `/${locale}`;
    const path = pathname.startsWith(prefix) ? pathname.slice(prefix.length) || "/" : pathname || "/";
    const query = searchParams.toString();
    return query ? `${path}?${query}` : path;
  }, [locale, pathname, searchParams]);
  const router = useRouter();
  const common = useTranslations("Common");
  const [ready, setReady] = useState(() => isAuthed() || Boolean(initialAuthed));

  useEffect(() => {
    let cancelled = false;

    const update = async () => {
      const ok = await ensureAuthed(initialAuthed);
      if (ok) {
        if (!cancelled) setReady(true);
        return;
      }

      if (cancelled) return;
      setReady(false);
      router.replace(`/login?next=${encodeURIComponent(nextPath)}`, { locale });
    };

    void update();
    const unsubscribe = subscribeAuthChanged(() => void update());
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [initialAuthed, locale, nextPath, router]);

  if (!ready) {
    return (
      <div className={cn("flex min-h-[calc(100vh-4rem)] items-center justify-center", className)}>
        <div className="text-sm text-muted-foreground">{common("loading")}</div>
      </div>
    );
  }

  return <>{children}</>;
}
