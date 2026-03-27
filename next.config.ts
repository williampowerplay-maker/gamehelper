import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: [],
  env: {
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    VOYAGE_API_KEY: process.env.VOYAGE_API_KEY,
  },
};

export default nextConfig;
