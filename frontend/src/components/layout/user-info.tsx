"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

import { apiRequest, ApiError } from "@/lib/api";
import { isAuthed, markLoggedOut, subscribeAuthChanged } from "@/lib/auth";

type Me = {
  id: string;
  email: string;
  nickname: string;
  subscription_status: string;
  credits: number;
};

export default function UserInfo() {
  const t = useTranslations("Common");
  const [authed, setAuthed] = useState(() => isAuthed());
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setAuthed(isAuthed());
    return subscribeAuthChanged(() => setAuthed(isAuthed()));
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!authed) {
      setMe(null);
      setError(null);
      return () => {
        cancelled = true;
      };
    }
    apiRequest<Me>("/api/v1/users/me")
      .then((data) => {
        if (cancelled) return;
        setMe(data);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        if (e instanceof ApiError && e.status === 401) {
          markLoggedOut();
          setMe(null);
          setError(null);
          return;
        }
        setError(e instanceof Error ? e.message : t("unknownError"));
      });
    return () => {
      cancelled = true;
    };
  }, [authed, t]);

  if (error) return <div className="text-xs text-destructive">{error}</div>;
  if (!me) return <div className="text-xs text-muted-foreground">{t("notLoggedIn")}</div>;

  return (
    <div className="text-xs text-muted-foreground">
      <div>{me.email}</div>
      <div>
        {t("subscription")}: {me.subscription_status}
      </div>
      <div>
        {t("credits")}: {me.subscription_status === "yearly" ? "∞" : me.credits}
      </div>
    </div>
  );
}
