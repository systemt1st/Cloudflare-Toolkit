import { useTranslations } from "next-intl";

import { Link } from "@/i18n/navigation";
import AuthAwareLink from "@/components/auth/auth-aware-link";
import HeroLogin from "@/components/home/hero-login";

type Props = {
  initialAuthed?: boolean;
};

export default function MarketingLanding({ initialAuthed }: Props) {
  const t = useTranslations("Home");
  const common = useTranslations("Common");

  return (
    <div className="bg-background text-foreground font-sans">
      {/* Hero 区域 */}
      <section className="pt-32 pb-20 px-6 text-center">
        <div className="max-w-4xl mx-auto animate-fade-in-up">
          <h1 className="text-5xl md:text-7xl font-extrabold tracking-tight mb-6 hero-text-gradient leading-tight">
            {t("heroTitle")}<br />
            <span className="text-[#0071e3]">{t("heroHighlight")}</span>
          </h1>
          <p className="text-xl md:text-2xl text-muted-foreground font-medium max-w-2xl mx-auto mb-10 leading-relaxed whitespace-pre-line">
            {t("subtitle")}
          </p>
          <div className="flex flex-col sm:flex-row justify-center items-center gap-4">
            <HeroLogin initialAuthed={initialAuthed} />
          </div>
        </div>
      </section>

      {/* 功能 Bento Grid */}
      <section id="features" className="py-20 px-6">
        <div className="max-w-7xl mx-auto">
          <h2 className="text-3xl md:text-4xl font-semibold text-center mb-16 text-foreground">
            {t("featuresTitle")}
          </h2>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 auto-rows-[400px]">
            {/* 主功能卡片：大图 */}
            <div className="md:col-span-2 rounded-[30px] p-10 bento-card zen-surface relative overflow-hidden group hover:scale-[1.02] hover:shadow-[0_20px_40px_rgba(0,0,0,0.08)] transition-all duration-500 ease-out">
              <div className="relative z-10">
                <div className="inline-flex items-center gap-2 bg-orange-50 text-orange-600 px-3 py-1 rounded-full text-xs font-semibold mb-4 dark:bg-orange-950/40 dark:text-orange-200">
                  {t("featureCoreTag")}
                </div>
                <h3 className="text-3xl font-semibold mb-4">{t("featureCoreTitle")}</h3>
                <p className="text-muted-foreground text-lg max-w-md">{t("featureCoreDescription")}</p>
                <div className="mt-8">
                  <AuthAwareLink guestHref="/register" authedHref="/domains/add">
                    <span className="inline-flex items-center text-[#0071e3] font-medium hover:underline cursor-pointer">
                      {t("featureCoreCta")} <svg className="w-4 h-4 ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7"/></svg>
                    </span>
                  </AuthAwareLink>
                </div>
              </div>
              {/* 装饰性背景图 */}
              <div className="absolute right-[-50px] bottom-[-50px] w-96 h-96 bg-gradient-to-br from-orange-100 to-orange-50 rounded-full opacity-50 blur-3xl group-hover:scale-110 transition-transform duration-700 dark:opacity-25"></div>
              <div className="absolute right-10 bottom-10 opacity-10 transform rotate-[-15deg]">
                <svg className="w-64 h-64" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/></svg>
              </div>
            </div>

            {/* 次功能卡片：DNS */}
            <div className="rounded-[30px] p-8 bento-card zen-surface flex flex-col justify-between overflow-hidden relative group hover:scale-[1.02] hover:shadow-[0_20px_40px_rgba(0,0,0,0.08)] transition-all duration-500 ease-out">
              <div className="relative z-10">
                <div className="w-12 h-12 bg-blue-50 rounded-2xl flex items-center justify-center mb-6 text-blue-500 dark:bg-blue-950/40 dark:text-blue-200">
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2"/></svg>
                </div>
                <h3 className="text-2xl font-semibold mb-2">{t("featureDnsTitle")}</h3>
                <p className="text-muted-foreground">{t("featureDnsDescription")}</p>
              </div>
              <div className="absolute -right-10 -top-10 w-40 h-40 bg-blue-50 rounded-full blur-2xl opacity-50 dark:bg-blue-950/40 dark:opacity-25"></div>
            </div>

            {/* 次功能卡片：SSL */}
            <div className="rounded-[30px] p-8 bento-card zen-surface flex flex-col justify-between overflow-hidden relative group hover:scale-[1.02] hover:shadow-[0_20px_40px_rgba(0,0,0,0.08)] transition-all duration-500 ease-out">
              <div className="relative z-10">
                <div className="w-12 h-12 bg-green-50 rounded-2xl flex items-center justify-center mb-6 text-green-500 dark:bg-green-950/40 dark:text-green-200">
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/></svg>
                </div>
                <h3 className="text-2xl font-semibold mb-2">{t("featureSslTitle")}</h3>
                <p className="text-muted-foreground">{t("featureSslDescription")}</p>
              </div>
              <div className="absolute -right-10 -bottom-10 w-40 h-40 bg-green-50 rounded-full blur-2xl opacity-50 dark:bg-green-950/40 dark:opacity-25"></div>
            </div>

            {/* 缓存管理卡片 */}
            <div className="md:col-span-2 bg-[#1d1d1f] rounded-[30px] p-10 bento-card relative overflow-hidden group text-white hover:scale-[1.02] hover:shadow-[0_20px_40px_rgba(0,0,0,0.08)] transition-all duration-500 ease-out">
              <div className="relative z-10 flex flex-col h-full justify-between">
                <div>
                  <div className="inline-flex items-center gap-2 bg-white/10 text-white/90 backdrop-blur-sm px-3 py-1 rounded-full text-xs font-semibold mb-4">
                    {t("featureCacheTag")}
                  </div>
                  <h3 className="text-3xl font-semibold mb-4">{t("featureCacheTitle")}</h3>
                  <p className="text-gray-400 text-lg max-w-md">{t("featureCacheDescription")}</p>
                </div>
                <div className="mt-8">
                  <AuthAwareLink guestHref="/register" authedHref="/cache/batch">
                    <span className="inline-flex items-center text-white font-medium hover:text-gray-200 cursor-pointer">
                      {t("featureCacheCta")} <svg className="w-4 h-4 ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 8l4 4m0 0l-4 4m4-4H3"/></svg>
                    </span>
                  </AuthAwareLink>
                </div>
              </div>
              <div className="absolute right-0 top-0 h-full w-1/2 bg-gradient-to-l from-[#2d2d2f] to-transparent opacity-50"></div>
            </div>
          </div>
        </div>
      </section>

      {/* 定价 */}
      <section id="pricing" className="py-20 px-6 bg-background">
        <div className="max-w-7xl mx-auto">
          <h2 className="text-3xl md:text-4xl font-semibold text-center mb-16 text-foreground">
            {t("pricingTitle")}
          </h2>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-4xl mx-auto">
            {/* 免费版 */}
            <div className="rounded-[30px] p-10 zen-surface flex flex-col relative overflow-hidden">
              <h3 className="text-2xl font-semibold mb-2">{t("pricingFreeTitle")}</h3>
              <p className="text-muted-foreground mb-8">{t("pricingFreeSubtitle")}</p>
              <div className="text-5xl font-bold mb-8">{t("pricingFreePrice")}</div>
              <ul className="space-y-4 mb-10 flex-1">
                <li className="flex items-center text-muted-foreground">
                  <svg className="w-5 h-5 mr-3 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"/></svg>
                  {t("pricingFreeFeature1")}
                </li>
                <li className="flex items-center text-muted-foreground">
                  <svg className="w-5 h-5 mr-3 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"/></svg>
                  {t("pricingFreeFeature2")}
                </li>
              </ul>
              <AuthAwareLink guestHref="/register" authedHref="/accounts">
                <span className="w-full block text-center py-4 rounded-full border border-black/10 text-foreground font-medium hover:bg-white/55 transition cursor-pointer dark:border-white/10 dark:hover:bg-white/10">
                  {t("pricingFreeCta")}
                </span>
              </AuthAwareLink>
            </div>

            {/* 专业版 */}
            <div className="rounded-[30px] p-10 bg-[#1d1d1f] text-white flex flex-col relative overflow-hidden shadow-2xl dark:bg-[#0f0f11]">
              <div className="absolute top-0 right-0 bg-[#0071e3] text-white text-xs font-bold px-4 py-1 rounded-bl-xl">
                {t("pricingProBadge")}
              </div>
              <h3 className="text-2xl font-semibold mb-2">{t("pricingProTitle")}</h3>
              <p className="text-gray-400 mb-8">{t("pricingProSubtitle")}</p>
              <div className="text-5xl font-bold mb-8">
                {t("pricingProPrice")}{" "}
                <span className="text-lg font-normal text-gray-400">{t("pricingProPeriod")}</span>
              </div>
              <ul className="space-y-4 mb-10 flex-1">
                <li className="flex items-center">
                  <svg className="w-5 h-5 mr-3 text-[#0071e3]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"/></svg>
                  {t("pricingProFeature1")}
                </li>
                <li className="flex items-center">
                  <svg className="w-5 h-5 mr-3 text-[#0071e3]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"/></svg>
                  {t("pricingProFeature2")}
                </li>
                <li className="flex items-center">
                  <svg className="w-5 h-5 mr-3 text-[#0071e3]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"/></svg>
                  {t("pricingProFeature3")}
                </li>
              </ul>
              <AuthAwareLink guestHref="/register" authedHref="/subscription">
                <span className="w-full block text-center py-4 rounded-full bg-[#0071e3] text-white font-medium hover:bg-[#0077ed] transition cursor-pointer">
                  {t("pricingProCta")}
                </span>
              </AuthAwareLink>
            </div>
          </div>
        </div>
      </section>

      {/* Language Switcher */}
      <div className="py-12 bg-background border-t zen-divider">
        <div className="flex justify-center gap-4 text-sm text-muted-foreground">
          <Link href="/" locale="zh" className="hover:text-foreground transition-colors">
            {common("languageZh")}
          </Link>
          <span>/</span>
          <Link href="/" locale="en" className="hover:text-foreground transition-colors">
            {common("languageEn")}
          </Link>
        </div>
      </div>
    </div>
  );
}
