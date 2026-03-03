import { TopNav } from "@/components/layout/top-nav";
import { CommandBar } from "@/components/command-bar/command-bar";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background">
      <TopNav />
      <main className="flex-1 overflow-auto p-6">{children}</main>
      <CommandBar />
    </div>
  );
}
