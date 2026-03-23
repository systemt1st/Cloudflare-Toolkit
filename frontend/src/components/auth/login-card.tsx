"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { useParams } from "next/navigation";

import { useRouter, Link } from "@/i18n/navigation";
import { apiRequest, ApiError } from "@/lib/api";
import { markAuthed } from "@/lib/auth";
import GoogleLoginButton from "@/components/auth/google-login-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";

type LoginCardProps = {
  className?: string;
  onSuccess?: () => void;
  redirectTo?: string;
};

export default function LoginCard({ className, onSuccess, redirectTo }: LoginCardProps) {
  const t = useTranslations("Auth");
  const common = useTranslations("Common");
  const router = useRouter();
  const params = useParams<{ locale?: string }>();
  const locale = useMemo(() => params?.locale || "zh", [params]);
  const hasGoogleLogin = Boolean(process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID?.trim());

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await apiRequest("/api/v1/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password, remember_me: rememberMe }),
        auth: false,
      });
      markAuthed();
      onSuccess?.();
      router.replace(redirectTo ?? "/accounts", { locale });
    } catch (e: unknown) {
      setError(e instanceof ApiError ? e.message : common("unknownError"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card className={cn("w-full", className)}>
      <CardHeader className="space-y-1">
        <CardTitle className="text-2xl text-center">{t("loginTitle")}</CardTitle>
        <CardDescription className="text-center">
          {t("loginSubtitle")}
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
              className="bg-gray-100/50 shadow-inner"
              required
            />
          </div>
          <div className="grid gap-2">
            <Input
              id="password"
              type="password"
              placeholder={t("password")}
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="bg-gray-100/50 shadow-inner"
              required
            />
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 text-sm text-muted-foreground">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  className="h-4 w-4 rounded border-black/20 accent-primary"
                />
                {t("rememberMe")}
              </label>
              <Link
                href="/forgot-password"
                className="text-xs text-primary underline-offset-4 hover:underline"
              >
                {t("forgotPassword")}
              </Link>
            </div>
          </div>

          {error ? (
            <div className="text-sm text-destructive text-center">{error}</div>
          ) : null}

          <Button className="w-full active:scale-95" type="submit" disabled={loading}>
            {loading ? common("loading") : t("loginAction")}
          </Button>
        </form>

        {hasGoogleLogin ? (
          <>
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="px-2 text-muted-foreground zen-surface-subtle rounded-full">
                  {t("or")}
                </span>
              </div>
            </div>

            <GoogleLoginButton redirectTo={redirectTo} />
          </>
        ) : null}
      </CardContent>
      <CardFooter>
        <div className="text-sm text-muted-foreground w-full text-center">
          {t("noAccount")}{" "}
          <Link
            href={redirectTo ? `/register?next=${encodeURIComponent(redirectTo)}` : "/register"}
            className="text-primary underline-offset-4 hover:underline"
          >
            {t("registerAction")}
          </Link>
        </div>
      </CardFooter>
    </Card>
  );
}
