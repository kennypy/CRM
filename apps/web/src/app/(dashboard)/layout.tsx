import { TopNav } from "@/components/layout/top-nav";
import { CommandBar } from "@/components/command-bar/command-bar";
import { ActionBar } from "@/components/action-bar/action-bar";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background">
      <TopNav />
      {/* Global AI action bar — "create a quote for X…", log activity, etc.
          Available on every page (context-free; resolves company by name). */}
      <div className="border-b border-border bg-background px-6 py-3">
        <ActionBar />
      </div>
      <main className="flex-1 overflow-auto p-6">{children}</main>
      <CommandBar />
    </div>
  );
}
