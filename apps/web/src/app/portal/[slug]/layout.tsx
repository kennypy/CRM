/**
 * Customer portal layout — a clean, public, unauthenticated shell with no
 * dashboard chrome. Used for the tenant help centre at /portal/[slug].
 */

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      {children}
    </div>
  );
}
