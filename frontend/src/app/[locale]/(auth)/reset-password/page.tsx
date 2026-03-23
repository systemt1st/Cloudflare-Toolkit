"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { useParams, useSearchParams } from "next/navigation";

import { Link } from "@/i18n/navigation";
import { apiRequest, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";

export default function ResetPasswordPage() {
  const t = useTranslations("Auth");
  const common = useTranslations("Common");

  const params = useParams<{ locale?: string }>();
  const locale = useMemo(() => params?.locale || "zh", [params]);

  const searchParams = useSearchParams();
  const token = searchParams.get("token") || "";

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setDone(false);

    if (!token) {
      setError(t("resetPasswordMissingToken"));
      return;
    }
    if (password !== confirmPassword) {
      setError(t("passwordMismatch"));
      return;
    }

    setLoading(true);
    try {
      await apiRequest("/api/v1/auth/reset-password", {
        method: "POST",
        body: JSON.stringify({ token, password }),
        auth: false,
      });
      setDone(true);
      setPassword("");
      setConfirmPassword("");
    } catch (e: unknown) {
      setError(e instanceof ApiError ? e.message : common("unknownError"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card className="w-full">
      <CardHeader className="space-y-1">
        <CardTitle className="text-2xl text-center">{t("resetPasswordTitle")}</CardTitle>
        <CardDescription className="text-center">{t("resetPasswordSubtitle")}</CardDescription>
      </CardHeader>

      <CardContent>
        <form className="space-y-4" onSubmit={onSubmit}>
          <div className="space-y-2">
            <Label htmlFor="password">{t("newPassword")}</Label>
            <Input
              id="password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="confirmPassword">{t("confirmPassword")}</Label>
            <Input
              id="confirmPassword"
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
            />
          </div>

          {done ? <div className="text-sm text-emerald-700">{t("resetPasswordSuccess")}</div> : null}
          {error ? <div className="text-sm text-destructive">{error}</div> : null}

          <Button className="w-full" type="submit" disabled={loading}>
            {loading ? common("loading") : t("resetPasswordAction")}
          </Button>
        </form>
      </CardContent>

      <CardFooter>
        <div className="text-sm text-muted-foreground w-full text-center">
          <Link href="/login" className="font-medium text-foreground underline">
            {t("backToLogin")}
          </Link>
        </div>
      </CardFooter>
    </Card>
  );
}

