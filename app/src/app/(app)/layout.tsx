import { AppContentFooter, AppSidebar, AppTabBar, AppTopBar } from "@/components/layout/AppShell";

// App screens: sidebar on lg and up, fixed bottom tab bar below lg.

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[264px_minmax(0,1fr)]">
      <AppSidebar />
      <div className="flex min-h-screen min-w-0 flex-col">
        <AppTopBar />
        <main className="mx-auto w-full max-w-[1200px] 2xl:max-w-[1400px] flex-1 px-5 pb-10 pt-6 sm:px-8 lg:pt-8">{children}</main>
        {/* Extra bottom space below lg so the fixed tab bar never covers content. */}
        <div className="pb-24 lg:pb-0">
          <AppContentFooter />
        </div>
      </div>
      <AppTabBar />
    </div>
  );
}
