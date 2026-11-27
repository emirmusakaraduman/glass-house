import { MarketingFooter } from "@/components/layout/MarketingFooter";
import { MarketingNav } from "@/components/layout/MarketingNav";

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <MarketingNav />
      <main className="mx-auto w-full max-w-[1200px] 2xl:max-w-[1400px] flex-1 px-5 pb-20 pt-8 sm:px-8">{children}</main>
      <MarketingFooter />
    </div>
  );
}
