import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Stress test",
  description: "Drop prices, let loans default and follow the loss through every layer, next to a 2008-style lender with 3% down and no first-loss capital.",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
