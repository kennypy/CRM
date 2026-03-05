import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "@/components/providers";


export const metadata: Metadata = {
  title: "NexCRM — AI-Native Revenue OS",
  description: "Zero-entry CRM powered by graph relationships and AI inference",
  icons: { icon: "/favicon.ico" },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen bg-background antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
