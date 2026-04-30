import type { Metadata } from "next";
import "./globals.css";
import { AuthProvider } from "@/lib/auth-context";
import ErrorBoundary from "@/components/ErrorBoundary";

const adsenseId = process.env.NEXT_PUBLIC_ADSENSE_ID || "ca-pub-5671407541170136";

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
        {/* Google AdSense — must be in <head> for site verification and ad serving */}
        <script
          async
          src={`https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${adsenseId}`}
          crossOrigin="anonymous"
        />
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
