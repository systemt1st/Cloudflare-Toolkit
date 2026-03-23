"use client";

import { useMemo, useState } from "react";
import { useParams } from "next/navigation";

import { useRouter } from "@/i18n/navigation";
import { apiRequest } from "@/lib/api";
import { markLoggedOut } from "@/lib/auth";
import { Button } from "@/components/ui/button";

type Props = {
  label: string;
};

export default function LogoutButton({ label }: Props) {
  const params = useParams<{ locale?: string }>();
  const locale = useMemo(() => params?.locale || "zh", [params]);
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  return (
    <Button
      variant="ghost"
      disabled={loading}
      onClick={() => {
        setLoading(true);
        apiRequest("/api/v1/auth/logout", { method: "POST", auth: false })
          .catch(() => null)
          .finally(() => {
            markLoggedOut();
            router.replace("/login", { locale });
            setLoading(false);
          });
      }}
    >
      {label}
    </Button>
  );
}
