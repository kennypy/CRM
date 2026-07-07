"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { useEffect, useState } from "react";
import { TenantProvider } from "@/lib/tenant-context";
import { ThemeProvider } from "@/components/theme/theme-provider";
import { FontProvider } from "@/components/theme/font-provider";
import { initPostHog, posthog } from "@/lib/posthog";
import { usePathname, useSearchParams } from "next/navigation";

function PostHogPageView() {
  const pathname     = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (pathname) {
      const url = window.origin + pathname + (searchParams?.toString() ? `?${searchParams}` : "");
      posthog.capture("$pageview", { $current_url: url });
    }
  }, [pathname, searchParams]);

  return null;
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30 * 1000,
            retry: 1,
          },
        },
      })
  );

  useEffect(() => {
    initPostHog();
  }, []);

  return (
    <ThemeProvider>
      <FontProvider>
      <QueryClientProvider client={queryClient}>
        <TenantProvider>
          <PostHogPageView />
          {children}
        </TenantProvider>
        {process.env.NODE_ENV === "development" && (
          <ReactQueryDevtools initialIsOpen={false} />
        )}
      </QueryClientProvider>
      </FontProvider>
    </ThemeProvider>
  );
}
