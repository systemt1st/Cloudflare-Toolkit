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
import { ArrowRight, Check } from "lucide-react";

export const dynamic = "force-dynamic";

export default function PricingPage() {
  const t = useTranslations("Pricing");
  const nav = useTranslations("Nav");

  const plans = [
    {
      title: t("plans.free.title"),
      price: t("plans.free.price"),
      description: t("plans.free.description"),
      highlights: [
        t("plans.free.highlights.0"),
        t("plans.free.highlights.1"),
        t("plans.free.highlights.2"),
      ],
      primary: true,
    },
    {
      title: t("plans.pro.title"),
      price: t("plans.pro.price"),
      description: t("plans.pro.description"),
      highlights: [
        t("plans.pro.highlights.0"),
        t("plans.pro.highlights.1"),
        t("plans.pro.highlights.2"),
      ],
      primary: false,
    },
    {
      title: t("plans.enterprise.title"),
      price: t("plans.enterprise.price"),
      description: t("plans.enterprise.description"),
      highlights: [
        t("plans.enterprise.highlights.0"),
        t("plans.enterprise.highlights.1"),
        t("plans.enterprise.highlights.2"),
      ],
      primary: false,
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
              <Button size="lg" className="h-12 min-w-[8rem] px-8 text-base">
                {nav("register")}
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            }
            authedChildren={
              <Button size="lg" className="h-12 min-w-[8rem] px-8 text-base">
                {nav("dashboard")}
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            }
          />
          <Link href="/features">
            <Button variant="outline" size="lg" className="h-12 px-8 text-base">
              {nav("features")}
            </Button>
          </Link>
        </div>
      </div>

      <div className="mt-14 grid gap-6 lg:grid-cols-3">
        {plans.map(({ title, price, description, highlights, primary }) => (
          <Card
            key={title}
            className={`transition-all hover:bg-white/55 ${primary ? "border-primary/25 bg-white/55" : ""}`}
          >
            <CardHeader>
              <div className="flex items-baseline justify-between">
                <CardTitle className="text-xl">{title}</CardTitle>
                <div className="text-sm text-muted-foreground">{price}</div>
              </div>
              <CardDescription className="text-base">{description}</CardDescription>

              <ul className="mt-6 space-y-3 text-sm text-muted-foreground">
                {highlights.map((item, index) => (
                  <li key={index} className="flex items-start gap-2">
                    <Check className="mt-0.5 h-4 w-4 text-primary" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>

              <div className="mt-8">
                <AuthAwareLink
                  guestHref="/register"
                  authedHref={primary ? "/accounts" : "/subscription"}
                  guestChildren={
                    <Button variant={primary ? "default" : "outline"} className="w-full">
                      {nav("register")}
                    </Button>
                  }
                  authedChildren={
                    <Button variant={primary ? "default" : "outline"} className="w-full">
                      {primary ? nav("dashboard") : nav("subscription")}
                    </Button>
                  }
                />
              </div>
            </CardHeader>
          </Card>
        ))}
      </div>
    </div>
  );
}
