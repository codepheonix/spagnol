import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@sm/core", "@sm/db", "@sm/integrations", "@sm/media", "@sm/security"],
  serverExternalPackages: ["@prisma/client", "pino", "@aws-sdk/client-s3", "@aws-sdk/s3-request-presigner", "@atproto/api", "image-size"],
  experimental: { serverActions: { bodySizeLimit: "320mb" } },
  poweredByHeader: false,
  headers: async () => [
    {
      source: "/(.*)",
      headers: [
        { key: "X-Frame-Options", value: "DENY" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      ],
    },
  ],
};

export default nextConfig;
