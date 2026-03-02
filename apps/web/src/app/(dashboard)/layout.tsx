import { Sidebar } from "@/components/layout/sidebar";
import { CommandBar } from "@/components/command-bar/command-bar";
import { TopBar } from "@/components/layout/top-bar";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <TopBar />
        <main className="flex-1 overflow-auto p-6">{children}</main>
      </div>
      {/* Global command bar — accessible from anywhere via ⌘K */}
      <CommandBar />
    </div>
  );
}
