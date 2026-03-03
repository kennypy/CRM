import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Turborepo-aware output
  output: process.env.NEXT_OUTPUT === "standalone" ? "standalone" : undefined,

  // Proxy API calls to the gateway in dev
  async rewrites() {
    const gateway = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
    return [
      {
        source: "/api/:path*",
        destination: `${gateway}/api/:path*`,
      },
      {
        source: "/auth/:path*",
        destination: `${gateway}/auth/:path*`,
      },
      {
        source: "/graphql",
        destination: `${gateway}/graphql`,
      },
    ];
  },

  experimental: {
    // Optimise server component rendering
    reactCompiler: false,
  },
};

export default nextConfig;
