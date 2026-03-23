import { Footer } from "@/components/layout/footer";

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-[calc(100vh-4rem)] flex-col">
      <main className="flex-1">{children}</main>
      <Footer />
    </div>
  );
}
