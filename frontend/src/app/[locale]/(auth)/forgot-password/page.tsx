"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { useParams } from "next/navigation";

import { Link } from "@/i18n/navigation";
import { apiRequest, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";

type ForgotPasswordResponse = {
  message: string;
  reset_url?: string;
};

export default function ForgotPasswordPage() {
  const t = useTranslations("Auth");
  const common = useTranslations("Common");

  const params = useParams<{ locale?: string }>();
  const locale = useMemo(() => params?.locale || "zh", [params]);

  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [devUrl, setDevUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSent(false);
    setDevUrl(null);
    setLoading(true);
    try {
      const data = await apiRequest<ForgotPasswordResponse>("/api/v1/auth/forgot-password", {
        method: "POST",
        body: JSON.stringify({ email, locale }),
        auth: false,
      });
      setSent(true);
      if (data.reset_url) setDevUrl(data.reset_url);
    } catch (e: unknown) {
      setError(e instanceof ApiError ? e.message : common("unknownError"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card className="w-full">
      <CardHeader className="space-y-1">
        <CardTitle className="text-2xl text-center">{t("forgotPasswordTitle")}</CardTitle>
        <CardDescription className="text-center">{t("forgotPasswordSubtitle")}</CardDescription>
      </CardHeader>

      <CardContent>
        <form className="space-y-4" onSubmit={onSubmit}>
          <div className="space-y-2">
            <Label htmlFor="email">{t("email")}</Label>
            <Input
              id="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="user@example.com"
              required
            />
          </div>

          {sent ? <div className="text-sm text-emerald-700">{t("forgotPasswordSent")}</div> : null}
          {devUrl ? (
            <div className="text-xs text-muted-foreground">
              dev:{" "}
              <a className="underline" href={devUrl}>
                {devUrl}
              </a>
            </div>
          ) : null}
          {error ? <div className="text-sm text-destructive">{error}</div> : null}

          <Button className="w-full" type="submit" disabled={loading}>
            {loading ? common("loading") : t("sendResetLink")}
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

