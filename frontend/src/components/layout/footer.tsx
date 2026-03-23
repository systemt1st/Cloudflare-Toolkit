import { CloudLightning } from "lucide-react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";

export function Footer() {
  const t = useTranslations("Footer");

  return (
    <footer className="mt-16 border-t zen-divider bg-white/35 backdrop-blur-[60px]">
      <div className="container mx-auto px-6 py-12">
        <div className="grid grid-cols-1 gap-10 md:grid-cols-2">
          <div className="space-y-4">
            <div className="flex items-center gap-2 font-semibold">
              <CloudLightning className="h-5 w-5" />
              <span>{t("brand")}</span>
            </div>
            <p className="text-sm text-muted-foreground">
              {t("description")}
            </p>
          </div>
          
          <div>
            <h4 className="mb-4 text-sm font-semibold">{t("sections.product")}</h4>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li>
                <Link href="/features" className="hover:text-primary transition-colors">
                  {t("links.features")}
                </Link>
              </li>
              <li>
                <Link href="/pricing" className="hover:text-primary transition-colors">
                  {t("links.pricing")}
                </Link>
              </li>
            </ul>
          </div>
        </div>
        
        <div className="mt-12 border-t zen-divider pt-8 text-center text-sm text-muted-foreground">
          <p>{t("copyright", { year: new Date().getFullYear() })}</p>
        </div>
      </div>
    </footer>
  );
}
