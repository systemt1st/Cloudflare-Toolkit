import { cookies } from "next/headers";

import DashboardShell from "@/components/dashboard/dashboard-shell";
import { AUTH_STATUS_COOKIE_KEY } from "@/lib/auth";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = cookies();
  const initialAuthed =
    Boolean(cookieStore.get("refresh_token")?.value) ||
    cookieStore.get(AUTH_STATUS_COOKIE_KEY)?.value === "1";

  return <DashboardShell initialAuthed={initialAuthed}>{children}</DashboardShell>;
}

