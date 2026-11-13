import type { NextConfig } from "next";

const internalApi = process.env.SHIPPING_INTERNAL_API_URL ?? "http://127.0.0.1:8001";

const config: NextConfig = {
  poweredByHeader: false,
  async rewrites() {
    return [{ source: "/api/v1/:path*", destination: `${internalApi}/api/v1/:path*` }];
  },
  async headers() {
    return [{
      source: "/:path*",
      headers: [
        { key: "X-Frame-Options", value: "DENY" },
        { key: "Referrer-Policy", value: "same-origin" },
      ],
    }];
  },
};

export default config;
