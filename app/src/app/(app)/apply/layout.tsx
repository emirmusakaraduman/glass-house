import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Apply for a loan",
  description: "Three steps from listing to signed application, with every cost shown before you sign: installment, fee, collateral and the fee-inclusive annual cost.",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
