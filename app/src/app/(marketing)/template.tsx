// Re-mounted on every navigation, so the content fades in (150ms). No animation with reduced motion.
export default function Template({ children }: { children: React.ReactNode }) {
  return <div className="page-fade">{children}</div>;
}
