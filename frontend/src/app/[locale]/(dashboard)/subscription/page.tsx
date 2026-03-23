"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";

import { apiRequest, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { LucideCheck, LucideCreditCard, LucideQrCode, LucideWallet } from "lucide-react";
import { cn } from "@/lib/utils";
import DashboardPageHeader from "@/components/dashboard/page-header";

type Me = {
  id: string;
  email: string;
  nickname: string;
  subscription_status: string;
  credits: number;
};

type SubscriptionMe = {
  plan_type: string;
  status: string;
  start_time?: string | null;
  end_time?: string | null;
};

type PaymentCheckoutResponse = {
  order_id: string;
  trade_id: string;
  payment_url: string;
  trade_type: string;
  amount: number;
  currency: string;
  token: string;
  actual_amount: string;
  expires_at: string;
};

type StripeCheckoutResponse = {
  order_id: string;
  session_id: string;
  checkout_url: string;
  expires_at?: string | null;
};

type PaymentOrder = {
  order_id: string;
  provider: string;
  plan_type: string;
  amount: number;
  currency: string;
  trade_type: string;
  status: string;
  trade_id?: string | null;
  payment_url?: string | null;
  token?: string | null;
  actual_amount?: string | null;
  expires_at?: string | null;
  paid_at?: string | null;
};

const TRADE_TYPE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "usdt.trc20", label: "USDT (TRC20)" },
  { value: "usdc.trc20", label: "USDC (TRC20)" },
  { value: "usdt.erc20", label: "USDT (ERC20)" },
  { value: "usdc.erc20", label: "USDC (ERC20)" },
  { value: "usdt.bep20", label: "USDT (BEP20)" },
  { value: "usdc.bep20", label: "USDC (BEP20)" },
  { value: "usdt.polygon", label: "USDT (Polygon)" },
  { value: "usdc.polygon", label: "USDC (Polygon)" },
  { value: "usdt.arbitrum", label: "USDT (Arbitrum)" },
  { value: "usdc.arbitrum", label: "USDC (Arbitrum)" },
  { value: "usdt.solana", label: "USDT (Solana)" },
  { value: "usdc.solana", label: "USDC (Solana)" },
  { value: "usdt.aptos", label: "USDT (Aptos)" },
  { value: "usdc.aptos", label: "USDC (Aptos)" },
  { value: "usdt.xlayer", label: "USDT (X-Layer)" },
  { value: "usdc.xlayer", label: "USDC (X-Layer)" },
  { value: "usdt.plasma", label: "USDT (Plasma)" },
  { value: "usdc.base", label: "USDC (Base)" },
];

const BENEFITS = [
  "payment_benefit_1",
  "payment_benefit_2",
  "payment_benefit_3",
  "payment_benefit_4",
];

const ACTIVATION_CODE_PURCHASE_URL = "https://ifdian.net/item/58d1e50cea9811f0b4e952540025c377";

export default function SubscriptionPage() {
  const t = useTranslations("Subscription");
  const common = useTranslations("Common");
  const params = useParams<{ locale?: string }>();
  const locale = useMemo(() => params?.locale || "zh", [params]);
  const searchParams = useSearchParams();
  const orderIdFromQuery = useMemo(() => searchParams.get("order_id") ?? "", [searchParams]);

  const [me, setMe] = useState<Me | null>(null);
  const [sub, setSub] = useState<SubscriptionMe | null>(null);
  const [loading, setLoading] = useState(true);
  const [activating, setActivating] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<"crypto" | "stripe" | "wechat">("crypto");
  const [tradeType, setTradeType] = useState("usdt.trc20");
  const [checkingOrder, setCheckingOrder] = useState(false);
  const [order, setOrder] = useState<PaymentOrder | null>(null);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [stripeCheckoutLoading, setStripeCheckoutLoading] = useState(false);
  const [redeemLoading, setRedeemLoading] = useState(false);
  const [activationCode, setActivationCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      const [meData, subData] = await Promise.all([
        apiRequest<Me>("/api/v1/users/me", { method: "GET" }),
        apiRequest<SubscriptionMe>("/api/v1/subscriptions/me", { method: "GET" }),
      ]);
      setMe(meData);
      setSub(subData);
    } catch (e: unknown) {
      setError(e instanceof ApiError ? e.message : common("unknownError"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const orderId = orderIdFromQuery.trim();
    if (!orderId) return;

    let stopped = false;
    let timer: number | null = null;

    async function tick() {
      if (stopped) return;
      setCheckingOrder(true);
      try {
        const data = await apiRequest<PaymentOrder>(`/api/v1/payments/orders/${encodeURIComponent(orderId)}`, {
          method: "GET",
        });
        if (stopped) return;
        setOrder(data);
        if (data.status === "paid") {
          setMessage(t("paid"));
          void load();
          if (timer) window.clearInterval(timer);
        }
        if (data.status === "expired") {
          setError(t("expired"));
          if (timer) window.clearInterval(timer);
        }
        if (data.status === "failed" || data.status === "cancelled") {
          setError(t("failed"));
          if (timer) window.clearInterval(timer);
        }
      } catch (e: unknown) {
        if (stopped) return;
        setError(e instanceof ApiError ? e.message : common("unknownError"));
      } finally {
        if (!stopped) setCheckingOrder(false);
      }
    }

    void tick();
    timer = window.setInterval(() => void tick(), 2000);
    return () => {
      stopped = true;
      if (timer) window.clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderIdFromQuery]);

  async function onDevActivate() {
    setActivating(true);
    setError(null);
    setMessage(null);
    try {
      const subData = await apiRequest<SubscriptionMe>("/api/v1/subscriptions/dev/activate", {
        method: "POST",
        body: JSON.stringify({ plan_type: "yearly", days: 365 }),
      });
      setSub(subData);
      setMessage(t("activated"));
      await load();
    } catch (e: unknown) {
      setError(e instanceof ApiError ? e.message : common("unknownError"));
    } finally {
      setActivating(false);
    }
  }

  async function onCheckout() {
    setCheckoutLoading(true);
    setError(null);
    setMessage(null);
    try {
      const data = await apiRequest<PaymentCheckoutResponse>("/api/v1/payments/bepusdt/checkout", {
        method: "POST",
        body: JSON.stringify({ plan_type: "yearly", trade_type: tradeType, locale }),
      });
      window.location.href = data.payment_url;
    } catch (e: unknown) {
      setError(e instanceof ApiError ? e.message : common("unknownError"));
    } finally {
      setCheckoutLoading(false);
    }
  }

  async function onStripeCheckout() {
    setStripeCheckoutLoading(true);
    setError(null);
    setMessage(null);
    try {
      const data = await apiRequest<StripeCheckoutResponse>("/api/v1/payments/stripe/checkout", {
        method: "POST",
        body: JSON.stringify({ plan_type: "yearly", locale }),
      });
      window.location.href = data.checkout_url;
    } catch (e: unknown) {
      setError(e instanceof ApiError ? e.message : common("unknownError"));
    } finally {
      setStripeCheckoutLoading(false);
    }
  }

  async function onRedeemActivationCode() {
    const code = activationCode.trim();
    if (!code) {
      setError(t("activationCodeRequired"));
      return;
    }

    setRedeemLoading(true);
    setError(null);
    setMessage(null);
    try {
      const subData = await apiRequest<SubscriptionMe>("/api/v1/subscriptions/redeem", {
        method: "POST",
        body: JSON.stringify({ code }),
      });
      setSub(subData);
      setActivationCode("");
      const endDate = subData.end_time
        ? new Date(subData.end_time).toLocaleDateString(locale === "zh" ? "zh-CN" : "en-US")
        : "";
      setMessage(endDate ? t("redeemSuccess", { date: endDate }) : t("activated"));
      await load();
    } catch (e: unknown) {
      if (e instanceof ApiError) {
        const code = e.code || "";
        if (code === "ACTIVATION_CODE_REQUIRED") {
          setError(t("activationCodeRequired"));
        } else if (code === "ACTIVATION_CODE_INVALID") {
          setError(t("activationCodeInvalid"));
        } else if (code === "ACTIVATION_CODE_USED") {
          setError(t("activationCodeUsed"));
        } else if (code === "ACTIVATION_CODE_EXPIRED") {
          setError(t("activationCodeExpired"));
        } else {
          setError(e.message || t("redeemFailed"));
        }
      } else {
        setError(common("unknownError"));
      }
    } finally {
      setRedeemLoading(false);
    }
  }

  const handleCheckout = () => {
    if (paymentMethod === "crypto") {
      void onCheckout();
    } else if (paymentMethod === "stripe") {
      void onStripeCheckout();
    } else {
      window.open(ACTIVATION_CODE_PURCHASE_URL, "_blank", "noopener,noreferrer");
    }
  };

  return (
    <div className="space-y-6">
      <DashboardPageHeader title={t("title")} subtitle={t("subtitle")} />

      {error ? <div className="text-sm text-destructive">{error}</div> : null}
      {message ? <div className="text-sm text-emerald-700">{message}</div> : null}

      <div className="grid gap-6 md:grid-cols-2 md:items-start">
        <Card>
          <CardHeader>
            <CardTitle>{t("currentStatus")}</CardTitle>
            <CardDescription>{t("manageStatus")}</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="space-y-3">
                <Skeleton className="h-5 w-full" />
                <Skeleton className="h-5 w-3/4" />
                <Skeleton className="h-5 w-5/6" />
                <Skeleton className="h-5 w-2/3" />
                <div className="pt-4">
                  <Skeleton className="h-10 w-32 rounded-lg" />
                </div>
              </div>
            ) : (
              <div className="space-y-6">
                <div className="grid gap-4 text-sm">
                  <div className="flex justify-between border-b pb-2">
                    <span className="text-muted-foreground">{t("email")}</span>
                    <span className="font-medium">{me?.email || "-"}</span>
                  </div>
                  <div className="flex justify-between border-b pb-2">
                    <span className="text-muted-foreground">{t("plan")}</span>
                    <span className="font-medium capitalize">{me?.subscription_status || "free"}</span>
                  </div>
                  <div className="flex justify-between border-b pb-2">
                    <span className="text-muted-foreground">{t("credits")}</span>
                    <span className="font-medium">{me?.subscription_status === "yearly" ? "∞" : me?.credits}</span>
                  </div>
                  <div className="flex justify-between border-b pb-2">
                    <span className="text-muted-foreground">{t("subStatus")}</span>
                    <span className="font-medium capitalize">{sub?.status || "free"}</span>
                  </div>
                  {sub?.start_time && (
                    <div className="flex justify-between border-b pb-2">
                      <span className="text-muted-foreground">{t("startTime")}</span>
                      <span className="font-medium">{new Date(sub.start_time).toLocaleDateString()}</span>
                    </div>
                  )}
                  {sub?.end_time && (
                    <div className="flex justify-between border-b pb-2">
                      <span className="text-muted-foreground">{t("endTime")}</span>
                      <span className="font-medium">{new Date(sub.end_time).toLocaleDateString()}</span>
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap gap-3">
                  <Button variant="outline" onClick={() => void load()} disabled={loading || activating} className="flex-1">
                    {t("refresh")}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => void onDevActivate()} disabled={loading || activating} className="text-xs text-muted-foreground">
                    {activating ? common("loading") : t("devActivate")}
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="relative overflow-hidden border-primary/10 bg-gradient-to-br from-background to-primary/5">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              {t("upgradeTitle")}
              <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">PRO</span>
            </CardTitle>
            <CardDescription>{t("upgradeSubtitle")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-2">
              <Label className="text-sm font-medium">{t("selectPaymentMethod")}</Label>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3" role="group" aria-label={t("selectPaymentMethod")}>
                <button
                  type="button"
                  className={cn(
                    "rounded-xl border-2 p-4 text-left transition-[background-color,border-color,box-shadow,transform] hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/25 focus-visible:ring-offset-2 focus-visible:ring-offset-background active:translate-y-px",
                    paymentMethod === "crypto" ? "border-primary bg-accent shadow-sm" : "border-transparent bg-secondary/50"
                  )}
                  aria-pressed={paymentMethod === "crypto"}
                  onClick={() => setPaymentMethod("crypto")}
                >
                  <div className="flex items-center gap-2 font-medium">
                    <LucideWallet className="h-4 w-4" />
                    {t("methodCrypto")}
                  </div>
                </button>
                <button
                  type="button"
                  className={cn(
                    "rounded-xl border-2 p-4 text-left transition-[background-color,border-color,box-shadow,transform] hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/25 focus-visible:ring-offset-2 focus-visible:ring-offset-background active:translate-y-px",
                    paymentMethod === "stripe" ? "border-primary bg-accent shadow-sm" : "border-transparent bg-secondary/50"
                  )}
                  aria-pressed={paymentMethod === "stripe"}
                  onClick={() => setPaymentMethod("stripe")}
                >
                  <div className="flex items-center gap-2 font-medium">
                    <LucideCreditCard className="h-4 w-4" />
                    {t("methodStripe")}
                  </div>
                </button>
                <button
                  type="button"
                  className={cn(
                    "rounded-xl border-2 p-4 text-left transition-[background-color,border-color,box-shadow,transform] hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/25 focus-visible:ring-offset-2 focus-visible:ring-offset-background active:translate-y-px",
                    paymentMethod === "wechat" ? "border-primary bg-accent shadow-sm" : "border-transparent bg-secondary/50"
                  )}
                  aria-pressed={paymentMethod === "wechat"}
                  onClick={() => setPaymentMethod("wechat")}
                >
                  <div className="flex items-center gap-2 font-medium">
                    <LucideQrCode className="h-4 w-4" />
                    {t("methodWechat")}
                  </div>
                </button>
              </div>
            </div>

            {paymentMethod === "crypto" && (
              <div className="space-y-2">
                <Label htmlFor="tradeType" className="text-sm font-medium">
                  {t("networkCurrency")}
                </Label>
                <select
                  id="tradeType"
                  value={tradeType}
                  onChange={(e) => setTradeType(e.target.value)}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {TRADE_TYPE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="rounded-lg bg-secondary/50 p-4">
              <ul className="space-y-2 text-sm">
                {BENEFITS.map((benefit, i) => (
                  <li key={i} className="flex items-center gap-2">
                    <LucideCheck className="h-4 w-4 text-primary" />
                    <span className="text-muted-foreground">{t(benefit)}</span>
                  </li>
                ))}
              </ul>
            </div>

            <Button
              onClick={handleCheckout}
              disabled={checkoutLoading || stripeCheckoutLoading}
              className="h-11 w-full text-base shadow-lg shadow-primary/20 transition-all hover:shadow-primary/30"
            >
              {checkoutLoading || stripeCheckoutLoading ? common("loading") : paymentMethod === "wechat" ? t("buyActivationCode") : t("payNow")}
            </Button>

            <div className="space-y-3 rounded-xl border bg-background/60 p-4">
              <div className="space-y-1">
                <div className="text-sm font-medium">{t("haveActivationCode")}</div>
                <div className="text-xs text-muted-foreground">{t("activationCodeTip")}</div>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input
                  value={activationCode}
                  onChange={(e) => {
                    setActivationCode(e.target.value);
                    if (error) setError(null);
                  }}
                  placeholder={t("activationCodePlaceholder")}
                  autoComplete="one-time-code"
                />
                <Button
                  onClick={() => void onRedeemActivationCode()}
                  disabled={redeemLoading}
                  className="shrink-0"
                >
                  {redeemLoading ? common("loading") : t("redeem")}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {orderIdFromQuery && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">{t("orderStatus")}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-1">
                <div className="text-xs text-muted-foreground">{t("orderId")}</div>
                <div className="font-mono text-sm">{orderIdFromQuery}</div>
              </div>
              <div className="space-y-1">
                <div className="text-xs text-muted-foreground">{t("paymentStatus")}</div>
                <div className="font-medium">
                  {checkingOrder ? (
                    <span className="flex items-center gap-2">
                      <span className="h-2 w-2 animate-pulse rounded-full bg-primary" />
                      {common("loading")}
                    </span>
                  ) : (
                    <span className={cn(
                      "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
                      order?.status === "paid" ? "bg-emerald-100 text-emerald-700" : 
                      order?.status === "expired" ? "bg-destructive/10 text-destructive" :
                      "bg-secondary text-secondary-foreground"
                    )}>
                      {order?.status || "-"}
                    </span>
                  )}
                </div>
              </div>
              {order?.actual_amount && order?.token && (
                <div className="space-y-1">
                  <div className="text-xs text-muted-foreground">{t("payAmount")}</div>
                  <div className="font-mono text-sm">
                    {order.actual_amount} <span className="text-muted-foreground">→</span> {order.token}
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
