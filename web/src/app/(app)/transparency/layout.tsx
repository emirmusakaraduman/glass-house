import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Every loan, in the open",
  description: "Every GlassHouse loan's terms, payments and provisions, pool health and the loss order. Pseudonymous: no borrower identity is shown.",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
