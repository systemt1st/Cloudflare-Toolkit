"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { X } from "lucide-react";
import { useParams } from "next/navigation";

import { useRouter } from "@/i18n/navigation";
import { isAuthed as isAuthedCookie, subscribeAuthChanged } from "@/lib/auth";
import { ensureAuthed } from "@/lib/auth-bootstrap";
import LoginCard from "@/components/auth/login-card";

type Props = {
  initialAuthed?: boolean;
};

export default function HeroLogin({ initialAuthed }: Props) {
  const t = useTranslations("Home");
  const nav = useTranslations("Nav");
  const common = useTranslations("Common");
  const auth = useTranslations("Auth");
  const [open, setOpen] = useState(false);
  const [authed, setAuthed] = useState(() => Boolean(initialAuthed));
  const bootstrapRef = useRef(false);
  const router = useRouter();
  const params = useParams<{ locale?: string }>();
  const locale = useMemo(() => params?.locale || "zh", [params]);

  useEffect(() => {
    if (!open) return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", handleKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  useEffect(() => {
    const update = () => {
      const currentAuthed = isAuthedCookie();
      if (!currentAuthed && initialAuthed && !bootstrapRef.current) {
        bootstrapRef.current = true;
        setAuthed(true);
        ensureAuthed(true).then((ok) => {
          if (!ok) setAuthed(false);
        });
        return;
      }
      setAuthed(currentAuthed);
    };
    update();
    return subscribeAuthChanged(update);
  }, [initialAuthed]);

  return (
    <>
      <button
        type="button"
        onClick={() => {
          if (authed) {
            router.replace("/accounts", { locale });
            return;
          }
          setOpen(true);
        }}
        className="min-w-[10rem] whitespace-nowrap rounded-full border border-white/10 bg-[#1C1C1E] px-8 py-3 text-base font-semibold text-white shadow-[0_18px_40px_rgba(0,0,0,0.18)] ring-1 ring-inset ring-white/15 transition duration-200 hover:border-white/20 hover:bg-[#111113] hover:shadow-[0_24px_48px_-12px_rgba(0,0,0,0.24)] active:scale-95"
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        {authed ? nav("dashboard") : t("ctaLogin")}
      </button>

      {open ? (
        <div className="fixed inset-0 z-[70] overflow-y-auto">
          <div
            className="absolute inset-0 bg-black/5 backdrop-blur-[32px]"
            onClick={() => setOpen(false)}
          />
          <div className="relative z-10 flex min-h-screen items-center justify-center px-6 py-12">
            <div
              className="relative w-full max-w-md"
              onClick={(event) => event.stopPropagation()}
              role="dialog"
              aria-modal="true"
              aria-label={auth("loginTitle")}
            >
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="absolute right-4 top-4 z-20 inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/60 bg-white/60 text-[#1C1C1E] shadow-[0_12px_24px_rgba(0,0,0,0.12)] backdrop-blur-[40px] transition hover:bg-white/80 active:scale-95"
                aria-label={common("close")}
              >
                <X className="h-4 w-4" />
              </button>

              <div className="rounded-[40px] border border-gray-200/40 bg-white/50 p-1 shadow-[0_24px_48px_-12px_rgba(0,0,0,0.08)]">
                <LoginCard
                  className="rounded-[32px] border border-white/60"
                  onSuccess={() => setOpen(false)}
                />
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
