import { useTranslations } from "next-intl";

import { Link } from "@/i18n/navigation";
import { CloudLightning } from "lucide-react";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  const nav = useTranslations("Nav");

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-background flex flex-col items-center justify-center py-12 px-4 sm:px-6 lg:px-8">
      <div className="w-full max-w-md space-y-8">
        <div className="flex flex-col items-center justify-center text-center">
          <Link
            href="/"
            className="mb-8 flex items-center justify-center rounded-[24px] zen-surface-subtle p-4 text-foreground hover:bg-white/55"
          >
             <CloudLightning className="h-8 w-8" />
          </Link>
        </div>
        {children}
      </div>
    </div>
  );
}
