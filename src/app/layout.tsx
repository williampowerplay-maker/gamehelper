import type { Metadata } from "next";
import "./globals.css";
import { AuthProvider } from "@/lib/auth-context";

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
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
