import type { Metadata } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import "@solana/wallet-adapter-react-ui/styles.css";
import "./globals.css";
import { Providers } from "@/components/providers/Providers";

// Root: only html/body, the font and providers. Each route group brings its own chrome:
// (marketing) has the top nav and footer, (app) has the sidebar, top bar and mobile tab bar.

const jakarta = Plus_Jakarta_Sans({ subsets: ["latin", "latin-ext"], variable: "--font-jakarta", display: "swap" });

const DESCRIPTION = "Earn in USDC, borrow in USDC: home and car loans on Solana where every loan is public, no identity is, and we take the first loss.";

export const metadata: Metadata = {
  // Set NEXT_PUBLIC_SITE_URL to the deployed URL so OpenGraph links are absolute.
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000"),
  title: { default: "GlassHouse: home and car loans anyone can audit", template: "%s · GlassHouse" },
  description: DESCRIPTION,
  openGraph: { type: "website", siteName: "GlassHouse", title: "GlassHouse: transparent home and car loans on Solana", description: DESCRIPTION },
  twitter: { card: "summary_large_image", title: "GlassHouse: transparent home and car loans on Solana", description: DESCRIPTION },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={jakarta.variable}>
      <body className="min-h-screen">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
