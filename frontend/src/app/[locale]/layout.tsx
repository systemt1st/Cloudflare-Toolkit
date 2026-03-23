import { hasLocale, NextIntlClientProvider } from "next-intl";
import { getMessages } from "next-intl/server";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";

import { Navbar } from "@/components/layout/navbar";
import GlobalNoticeBar from "@/components/layout/global-notice";
import { routing } from "@/i18n/routing";
import { AUTH_STATUS_COOKIE_KEY } from "@/lib/auth";

type Props = {
  children: React.ReactNode;
  params: { locale: string };
};

export const dynamic = "force-dynamic";

export default async function LocaleLayout({ children, params }: Props) {
  const { locale } = params;
  if (!hasLocale(routing.locales, locale)) notFound();

  const messages = await getMessages();
  const cookieStore = cookies();
  const initialAuthed =
    Boolean(cookieStore.get("refresh_token")?.value) ||
    cookieStore.get(AUTH_STATUS_COOKIE_KEY)?.value === "1";

  return (
    <NextIntlClientProvider locale={locale} messages={messages}>
      <Navbar initialAuthed={initialAuthed} />
      <GlobalNoticeBar />
      {children}
    </NextIntlClientProvider>
  );
}
