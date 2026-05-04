import type { Metadata } from "next";
import "./globals.css";
import { AuthProvider } from "@/lib/auth-context";
import ErrorBoundary from "@/components/ErrorBoundary";

// AdSense temporarily disabled — see <head> below. To re-enable, uncomment this
// const and the <script> block in <head>.
// const adsenseId = process.env.NEXT_PUBLIC_ADSENSE_ID || "ca-pub-5671407541170136";

export const metadata: Metadata = {
  title: "Crimson Desert Guide | AI Game Companion",
  description:
    "Get instant, spoiler-free help for Crimson Desert. Ask any question about quests, bosses, items, and more.",
  keywords: [
    "Crimson Desert",
    "game guide",
    "walkthrough",
    "boss strategy",
    "puzzle solution",
  ],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        {/* Google AdSense — DISABLED 2026-05-04 pending account approval / setup.
            Suspected source of mobile interaction freeze on the 6th-message AdBanner.
            To re-enable: uncomment the script tag below AND restore the showAds
            calculation in src/app/page.tsx (currently forced to false).
        <script
          async
          src={`https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${adsenseId}`}
          crossOrigin="anonymous"
        />
        */}
      </head>
      <body className="antialiased">
        <AuthProvider>
          <ErrorBoundary componentName="RootLayout">
            {children}
          </ErrorBoundary>
        </AuthProvider>
      </body>
    </html>
  );
}
