import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Co-sign a loan application",
  description: "The seller checks the borrower's application and signs it with their own wallet.",
  robots: { index: false },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
