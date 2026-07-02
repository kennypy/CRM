import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";
import createNextIntlPlugin from "next-intl/plugin";
import bundleAnalyzer from "@next/bundle-analyzer";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");
const withBundleAnalyzer = bundleAnalyzer({ enabled: process.env.ANALYZE === "true" });

const nextConfig: NextConfig = {
  output: process.env.NEXT_OUTPUT === "standalone" ? "standalone" : undefined,

  // /api/v1/*, /auth/* and /graphql are all handled by Route Handlers
  // (apps/web/src/app/api/ and apps/web/src/app/graphql/). We intentionally do
  // NOT add a direct rewrite for /graphql: a rewrite would proxy straight to the
  // gateway and bypass the server-side auth/cookie injection and the demo
  // read-only guard. See apps/web/src/app/graphql/route.ts.

  async headers() {
    const isProd = process.env.NODE_ENV === "production";
    // Whether the deployment is actually served over HTTPS. Controls the two
    // transport-forcing headers (HSTS + CSP upgrade-insecure-requests). These
    // break plain-HTTP LAN/self-hosted deploys: the browser upgrades every
    // request to https:// on a port with no TLS listener, so login (and every
    // API fetch) silently fails. `headers()` is evaluated at BUILD time, so this
    // reads the COOKIE_SECURE build arg — mirror it to the runtime env too.
    // COOKIE_SECURE=false → HTTP deploy (drop these); =true → HTTPS; unset →
    // fall back to isProd (same default as the Secure-cookie gate).
    const httpsEnforced =
      process.env.COOKIE_SECURE === "false"
        ? false
        : process.env.COOKIE_SECURE === "true"
          ? true
          : isProd;
    return [
      {
        source: "/(.*)",
        headers: [
          // Prevent this app being embedded in iframes (clickjacking)
          { key: "X-Frame-Options", value: "DENY" },
          // Prevent MIME-type sniffing
          { key: "X-Content-Type-Options", value: "nosniff" },
          // Referrer policy: send origin only on cross-origin requests
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // Disable browser features not needed by the app
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
          },
          // Disable DNS prefetching
          { key: "X-DNS-Prefetch-Control", value: "off" },
          // HSTS — only when actually served over HTTPS
          ...(httpsEnforced
            ? [
                {
                  key: "Strict-Transport-Security",
                  value: "max-age=63072000; includeSubDomains; preload",
                },
              ]
            : []),
          // Content Security Policy
          // - connect-src 'self': all API calls go through Next.js Route Handler proxy
          // - script-src 'unsafe-inline': required for Next.js hydration scripts
          // - style-src 'unsafe-inline': required for Tailwind utility classes
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline'" + (isProd ? "" : " 'unsafe-eval'"),
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: blob: https:",
              "font-src 'self'",
              "connect-src 'self'",
              "media-src 'none'",
              "object-src 'none'",
              "frame-src 'none'",
              "frame-ancestors 'none'",
              "base-uri 'self'",
              "form-action 'self'",
              ...(httpsEnforced ? ["upgrade-insecure-requests"] : []),
            ].join("; "),
          },
        ],
      },
    ];
  },

  experimental: {
    reactCompiler: false,
  },
};

export default withSentryConfig(withBundleAnalyzer(withNextIntl(nextConfig)), {
  // Suppress verbose Sentry CLI output during builds
  silent: !process.env.CI,
  // Upload source maps only in CI to avoid bloating local builds
  sourcemaps: {
    disable: process.env.CI !== "true",
  },
  widenClientFileUpload: true,
  hideSourceMaps: true,
  automaticVercelMonitors: false,
});
