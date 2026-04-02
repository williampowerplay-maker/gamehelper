import type { Metadata } from "next";
import Script from "next/script";
import "./globals.css";
import { AuthProvider } from "@/lib/auth-context";

const adsenseId = process.env.NEXT_PUBLIC_ADSENSE_ID;

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
      <body className="antialiased min-h-screen">
        {adsenseId && (
          <Script
            async
            src={`https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${adsenseId}`}
            crossOrigin="anonymous"
            strategy="lazyOnload"
          />
        )}
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
