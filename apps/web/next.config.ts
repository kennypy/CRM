import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

// Gateway URL — server-side only. NEVER use NEXT_PUBLIC_ for internal service URLs.
const GATEWAY_URL = process.env.API_GATEWAY_URL ?? "http://localhost:4000";

const nextConfig: NextConfig = {
  output: process.env.NEXT_OUTPUT === "standalone" ? "standalone" : undefined,

  // /api/v1/* and /auth/* are handled by Route Handlers (apps/web/src/app/api/).
  // Only /graphql still needs the Next.js rewrite since it's not a Route Handler.
  async rewrites() {
    return [
      {
        source: "/graphql",
        destination: `${GATEWAY_URL}/graphql`,
      },
    ];
  },

  async headers() {
    const isProd = process.env.NODE_ENV === "production";
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
          // HSTS — only over HTTPS in production
          ...(isProd
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
              ...(isProd ? ["upgrade-insecure-requests"] : []),
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

export default withSentryConfig(nextConfig, {
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
