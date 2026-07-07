/**
 * Public booking layout — clean, unauthenticated shell (no dashboard chrome)
 * for the meetings scheduler at /book/[slug].
 */

export default function BookLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen bg-background text-foreground">{children}</div>;
}
