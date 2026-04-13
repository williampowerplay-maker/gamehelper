import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: [],

  // SECURITY: Never put server-only secrets (ANTHROPIC_API_KEY, VOYAGE_API_KEY,
  // ADMIN_SECRET) in the `env` block — it statically inlines them into the
  // client-side JS bundle. Server API routes access them via process.env directly
  // (Vercel injects them at runtime) or via loadEnv() in local dev.

  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // Prevent clickjacking — page cannot be embedded in iframes
          { key: "X-Frame-Options", value: "DENY" },
          // Prevent MIME-type sniffing attacks
          { key: "X-Content-Type-Options", value: "nosniff" },
          // Control how much referrer info is sent on navigation
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // Force HTTPS for 2 years (preload-ready)
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
          // Restrict browser APIs — camera/geolocation not needed
          { key: "Permissions-Policy", value: "camera=(), geolocation=(), microphone=(self)" },
          // Allow DNS prefetch for performance (benign)
          { key: "X-DNS-Prefetch-Control", value: "on" },
        ],
      },
    ];
  },
};

export default nextConfig;
