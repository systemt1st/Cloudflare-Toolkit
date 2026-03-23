"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";

import { useRouter } from "@/i18n/navigation";
import { apiRequest, ApiError } from "@/lib/api";
import { markAuthed } from "@/lib/auth";

declare global {
  interface Window {
    google?: any;
  }
}

type GoogleCredentialResponse = {
  credential?: string;
};

function loadGoogleScript(errorMessage: string): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (window.google?.accounts?.id) return Promise.resolve();

  const existing = document.querySelector<HTMLScriptElement>(
    'script[src="https://accounts.google.com/gsi/client"]'
  );
  if (existing) {
    return new Promise((resolve, reject) => {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject(new Error(errorMessage)));
    });
  }

  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(errorMessage));
    document.head.appendChild(script);
  });
}

type Props = {
  redirectTo?: string;
};

export default function GoogleLoginButton({ redirectTo }: Props) {
  const t = useTranslations("Auth");
  const common = useTranslations("Common");
  const router = useRouter();
  const params = useParams<{ locale?: string }>();
  const locale = useMemo(() => params?.locale || "zh", [params]);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState<string | null>(null);

  const googleClientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID?.trim() || null;

  useEffect(() => {
    let cancelled = false;
    let renderCheckTimer: number | null = null;
    if (!googleClientId) return;

    async function init() {
      try {
        await loadGoogleScript(t("googleScriptFailed"));
        if (cancelled) return;

        const google = window.google;
        if (!google?.accounts?.id || !containerRef.current) return;

        google.accounts.id.initialize({
          client_id: googleClientId,
          callback: async (res: GoogleCredentialResponse) => {
            setError(null);
            try {
              const credential = res.credential;
              if (!credential) throw new Error(t("googleNoCredential"));

              await apiRequest("/api/v1/auth/google", {
                method: "POST",
                body: JSON.stringify({ credential }),
                auth: false,
              });

              markAuthed();
              router.replace(redirectTo ?? "/accounts", { locale });
            } catch (e: unknown) {
              setError(e instanceof ApiError ? e.message : common("unknownError"));
            }
          },
        });

        const containerWidth = containerRef.current.getBoundingClientRect().width || 360;
        const buttonWidth = Math.min(400, Math.floor(containerWidth));
        containerRef.current.innerHTML = "";
        google.accounts.id.renderButton(containerRef.current, {
          theme: "outline",
          size: "large",
          width: buttonWidth,
        });

        renderCheckTimer = window.setTimeout(() => {
          if (cancelled) return;
          const container = containerRef.current;
          if (!container) return;
          if (container.childElementCount === 0) {
            setError(t("googleOriginNotAllowed", { origin: window.location.origin }));
          }
        }, 600);
      } catch (e: unknown) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : common("unknownError"));
      }
    }

    void init();
    return () => {
      cancelled = true;
      if (renderCheckTimer) window.clearTimeout(renderCheckTimer);
    };
  }, [common, googleClientId, locale, redirectTo, router, t]);

  if (!googleClientId) return null;

  return (
    <div className="space-y-2">
      <div ref={containerRef} className="w-full" />
      {error ? <div className="text-sm text-destructive">{error}</div> : null}
    </div>
  );
}
