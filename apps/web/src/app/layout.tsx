import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "@/components/providers";
import { Analytics } from "@vercel/analytics/react";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import { DemoBanner } from "@/components/demo-banner";


export const metadata: Metadata = {
  title: "NexCRM — AI-Native Revenue OS",
  description: "Zero-entry CRM powered by graph relationships and AI inference",
  icons: { icon: "/favicon.ico" },
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const locale = await getLocale();
  const messages = await getMessages();

  return (
    <html lang={locale} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: `(function(){try{var t=localStorage.getItem('nexcrm_theme')||'system';var d=t==='dark'||(t==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches);if(d)document.documentElement.classList.add('dark')}catch(e){}})()` }} />
        {/* Apply the user's saved font before paint to avoid a flash of the default. */}
        <script dangerouslySetInnerHTML={{ __html: `(function(){try{var F={system:'system-ui, -apple-system, \\"Segoe UI\\", Roboto, Helvetica, Arial, sans-serif',grotesk:'\\"Segoe UI\\", \\"Helvetica Neue\\", Helvetica, Arial, sans-serif',rounded:'\\"Trebuchet MS\\", \\"Segoe UI\\", Verdana, sans-serif',serif:'Georgia, Cambria, \\"Times New Roman\\", Times, serif',mono:'\\"SF Mono\\", \\"Cascadia Code\\", \\"Consolas\\", ui-monospace, monospace'};var f=localStorage.getItem('nexcrm_font');if(f&&F[f])document.documentElement.style.setProperty('--font-sans',F[f]);}catch(e){}})()` }} />
        {/* Polyfill crypto.randomUUID for insecure (plain-HTTP) contexts. Browsers
            only expose it over HTTPS or localhost, so on a LAN IP over http it is
            undefined and any useState initializer that calls it throws on mount.
            Runs before hydration so every call site is covered. */}
        <script dangerouslySetInnerHTML={{ __html: `(function(){try{if(typeof crypto!=='undefined'&&typeof crypto.randomUUID!=='function'&&crypto.getRandomValues){crypto.randomUUID=function(){var b=crypto.getRandomValues(new Uint8Array(16));b[6]=(b[6]&0x0f)|0x40;b[8]=(b[8]&0x3f)|0x80;var s='';for(var i=0;i<16;i++){s+=(b[i]+0x100).toString(16).slice(1);if(i===3||i===5||i===7||i===9)s+='-';}return s;};}}catch(e){}})()` }} />
      </head>
      <body className="min-h-screen bg-background antialiased">
        <DemoBanner />
        <NextIntlClientProvider messages={messages} locale={locale}>
          <Providers>{children}</Providers>
        </NextIntlClientProvider>
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
