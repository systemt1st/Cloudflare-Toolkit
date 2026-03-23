import { useTranslations } from "next-intl";

import { Link } from "@/i18n/navigation";
import AuthAwareLink from "@/components/auth/auth-aware-link";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ArrowRight, Globe, Shield, Zap } from "lucide-react";

export const dynamic = "force-dynamic";

export default function FeaturesPage() {
  const t = useTranslations("Features");
  const nav = useTranslations("Nav");

  const items = [
    {
      Icon: Globe,
      title: t("items.global.title"),
      description: t("items.global.description"),
    },
    {
      Icon: Zap,
      title: t("items.batch.title"),
      description: t("items.batch.description"),
    },
    {
      Icon: Shield,
      title: t("items.secure.title"),
      description: t("items.secure.description"),
    },
  ];

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-16">
      <div className="mx-auto max-w-3xl text-center">
        <h1 className="text-4xl font-bold tracking-tight text-foreground sm:text-5xl">
          {t("title")}
        </h1>
        <p className="mt-4 text-lg text-muted-foreground">{t("subtitle")}</p>

        <div className="mt-8 flex flex-col items-center justify-center gap-4 sm:flex-row">
          <AuthAwareLink
            guestHref="/register"
            authedHref="/accounts"
            guestChildren={
              <Button size="lg" className="h-12 px-8 text-base">
                {nav("register")}
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            }
            authedChildren={
              <Button size="lg" className="h-12 px-8 text-base">
                {nav("dashboard")}
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            }
          />
          <Link href="/pricing">
            <Button variant="outline" size="lg" className="h-12 px-8 text-base">
              {nav("pricing")}
            </Button>
          </Link>
        </div>
      </div>

      <div className="mt-14 grid gap-6 md:grid-cols-3">
        {items.map(({ Icon, title, description }) => (
          <Card key={title} className="transition-all hover:bg-white/55">
            <CardHeader>
              <div
                className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-2xl zen-surface-subtle text-primary"
              >
                <Icon className="h-6 w-6" />
              </div>
              <CardTitle className="text-xl">{title}</CardTitle>
              <CardDescription className="text-base">
                {description}
              </CardDescription>
            </CardHeader>
          </Card>
        ))}
      </div>
    </div>
  );
}
