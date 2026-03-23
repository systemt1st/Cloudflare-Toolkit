"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";

import { Link, useRouter } from "@/i18n/navigation";
import { apiRequest, ApiError } from "@/lib/api";
import { isAuthed } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";

type RegisterResponse = {
  id: string;
  email: string;
  nickname: string;
};

function normalizeNext(value: string | null): string | null {
  if (!value) return null;
  if (!value.startsWith("/")) return null;
  if (value.startsWith("//")) return null;
  if (value.includes("://")) return null;
  return value;
}

export default function RegisterPage() {
  const t = useTranslations("Auth");
  const common = useTranslations("Common");
  const router = useRouter();
  const params = useParams<{ locale?: string }>();
  const locale = useMemo(() => params?.locale || "zh", [params]);
  const searchParams = useSearchParams();
  const nextPath = useMemo(() => normalizeNext(searchParams.get("next")), [searchParams]);

  const [email, setEmail] = useState("");
  const [nickname, setNickname] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorDetails, setErrorDetails] = useState<string[]>([]);

  useEffect(() => {
    if (isAuthed()) {
      router.replace(nextPath ?? "/accounts", { locale });
    }
  }, [locale, nextPath, router]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setErrorDetails([]);
    const trimmedEmail = email.trim();
    const trimmedNickname = nickname.trim();
    if (password.length < 8) {
      setError(t("passwordMinLength"));
      return;
    }
    if (/[A-Z]/.test(trimmedNickname)) {
      setError(t("nicknameNoUppercase"));
      return;
    }
    setLoading(true);
    try {
      await apiRequest<RegisterResponse>("/api/v1/auth/register", {
        method: "POST",
        body: JSON.stringify({ email: trimmedEmail, password, nickname: trimmedNickname }),
        auth: false,
      });
      router.replace(
        nextPath ? `/login?next=${encodeURIComponent(nextPath)}` : "/login",
        { locale }
      );
    } catch (e: unknown) {
      if (e instanceof ApiError) {
        setError(e.message);
        setErrorDetails(
          e.details?.map((detail) => detail.message).filter((message): message is string => Boolean(message)) ?? []
        );
      } else {
        setError(common("unknownError"));
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card className="w-full">
      <CardHeader className="space-y-1">
        <CardTitle className="text-2xl text-center">{t("registerTitle")}</CardTitle>
        <CardDescription className="text-center">
          {t("registerSubtitle")}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid gap-2">
            <Input
              id="email"
              type="email"
              placeholder={t("email")}
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div className="grid gap-2">
            <Input
              id="nickname"
              placeholder={t("nickname")}
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              required
            />
          </div>
          <div className="grid gap-2">
            <Input
              id="password"
              type="password"
              placeholder={t("password")}
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={8}
              required
            />
            <p className="text-xs text-muted-foreground">{t("passwordMinLength")}</p>
          </div>

          {error ? (
            <div className="space-y-1 text-center text-sm text-destructive">
              <div>{error}</div>
              {errorDetails.length ? (
                <div className="text-xs text-destructive/80">
                  {errorDetails.join(" · ")}
                </div>
              ) : null}
            </div>
          ) : null}

          <Button className="w-full" type="submit" disabled={loading}>
            {loading ? common("loading") : t("registerAction")}
          </Button>
        </form>
      </CardContent>
      <CardFooter>
        <div className="text-sm text-muted-foreground w-full text-center">
          {t("haveAccount")}{" "}
          <Link href="/login" className="text-primary underline-offset-4 hover:underline">
            {t("loginAction")}
          </Link>
        </div>
      </CardFooter>
    </Card>
  );
}
