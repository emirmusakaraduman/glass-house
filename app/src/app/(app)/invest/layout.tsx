import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Investor dashboard",
  description: "Deposit USDC into the home or car pool and see every loan behind your shares, the share price and who pays before you do.",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
