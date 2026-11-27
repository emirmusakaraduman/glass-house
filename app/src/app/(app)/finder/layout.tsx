import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Listing finder",
  description: "Enter your USDC income and savings to see the most you can pay, then homes and cars for sale under that price. Your numbers never leave the browser.",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
