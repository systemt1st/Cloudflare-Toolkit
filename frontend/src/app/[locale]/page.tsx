import { cookies } from "next/headers";

import MarketingLanding from "./(marketing)/landing";
import { Footer } from "@/components/layout/footer";
import { AUTH_STATUS_COOKIE_KEY } from "@/lib/auth";

export default function LocaleHomePage() {
  const cookieStore = cookies();
  const initialAuthed =
    Boolean(cookieStore.get("refresh_token")?.value) ||
    cookieStore.get(AUTH_STATUS_COOKIE_KEY)?.value === "1";

  return (
    <div className="flex min-h-[calc(100vh-4rem)] flex-col">
      <main className="flex-1">
        <MarketingLanding initialAuthed={initialAuthed} />
      </main>
      <Footer />
    </div>
  );
}
