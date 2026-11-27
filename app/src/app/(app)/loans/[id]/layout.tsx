import type { Metadata } from "next";
import { loanLabel, parseLoanKey } from "@/lib/chain/client";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const key = parseLoanKey(id);
  const label = key ? loanLabel(key) : "Loan";
  return {
    title: `${label} loan`,
    description: `${label}: terms, payments, status and the public on-chain record. The borrower's identity stays off-chain.`,
  };
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
