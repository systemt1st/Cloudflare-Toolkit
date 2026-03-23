"use client";

import { useEffect, useMemo } from "react";
import { useParams, useSearchParams } from "next/navigation";

import { useRouter } from "@/i18n/navigation";
import { isAuthed } from "@/lib/auth";
import LoginCard from "@/components/auth/login-card";

function normalizeNext(value: string | null): string | null {
  if (!value) return null;
  if (!value.startsWith("/")) return null;
  if (value.startsWith("//")) return null;
  if (value.includes("://")) return null;
  return value;
}

export default function LoginPage() {
  const params = useParams<{ locale?: string }>();
  const locale = useMemo(() => params?.locale || "zh", [params]);
  const searchParams = useSearchParams();
  const nextPath = useMemo(() => normalizeNext(searchParams.get("next")), [searchParams]);
  const router = useRouter();

  useEffect(() => {
    if (isAuthed()) {
      router.replace(nextPath ?? "/accounts", { locale });
    }
  }, [locale, nextPath, router]);

  return <LoginCard className="w-full" redirectTo={nextPath ?? undefined} />;
}
