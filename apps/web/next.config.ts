import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Turborepo-aware output
  output: process.env.NEXT_OUTPUT === "standalone" ? "standalone" : undefined,

  // Proxy API calls to the gateway in dev
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000"}/api/:path*`,
      },
      {
        source: "/graphql",
        destination: `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000"}/graphql`,
      },
    ];
  },

  experimental: {
    // Optimise server component rendering
    reactCompiler: false,
  },
};

export default nextConfig;
