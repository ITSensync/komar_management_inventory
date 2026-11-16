import type { NextConfig } from "next";

const internalApiBaseUrl = (process.env.INTERNAL_API_BASE_URL || "http://localhost:3000").replace(/\/$/, "");

const nextConfig: NextConfig = {
  output: "standalone",
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${internalApiBaseUrl}/api/:path*` }];
  },
};
export default nextConfig;
