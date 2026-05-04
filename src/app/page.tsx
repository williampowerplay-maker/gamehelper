"use client";

import { useState, useRef, useEffect } from "react";
import Image from "next/image";
import ChatInput from "@/components/ChatInput";
import ChatMessage, { type Message } from "@/components/ChatMessage";
import SpoilerTierSelector from "@/components/SpoilerTierSelector";
import AuthButton from "@/components/AuthButton";
import AdBanner from "@/components/AdBanner";
import UpgradeCTA from "@/components/UpgradeCTA";
import SignInWall from "@/components/SignInWall";
import CoverageStats from "@/components/CoverageStats";
import { useAuth } from "@/lib/auth-context";
import { type SpoilerTier } from "@/lib/supabase";

const AD_SLOT_BANNER = process.env.NEXT_PUBLIC_AD_SLOT_BANNER || "";
const AD_SLOT_SIDEBAR = process.env.NEXT_PUBLIC_AD_SLOT_SIDEBAR || "";
const ANON_QUERY_LIMIT = 2;
const ANON_COUNT_KEY = "anonQueryCount";

export default function Home() {
  const { user, session, tier } = useAuth();
  const showAds = tier !== "premium" && !!AD_SLOT_BANNER;
  const [messages, setMessages] = useState<Message[]>([]);
  const [spoilerTier, setSpoilerTier] = useState<SpoilerTier>("nudge");
  const [isLoading, setIsLoading] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Clear anon counter once user signs in
  useEffect(() => {
    if (user) {
      localStorage.removeItem(ANON_COUNT_KEY);
    }
  }, [user]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    if (messages.length > 0) scrollToBottom();
  }, [messages]);

  const handleSend = async (question: string) => {
    // Anonymous query limit — check locally first to avoid a wasted API call
    if (!user) {
      const anonCount = parseInt(localStorage.getItem(ANON_COUNT_KEY) || "0", 10);
      if (anonCount >= ANON_QUERY_LIMIT) {
        const wallMessage: Message = {
          id: Date.now().toString(),
          role: "assistant",
          content: "",
          requiresAuth: true,
          requiresAuthReason: "query_limit",
        };
        setMessages((prev) => [
          ...prev,
          { id: (Date.now() - 1).toString(), role: "user", content: question },
          wallMessage,
        ]);
        return;
      }
    }

    const userMessage: Message = {
      id: Date.now().toString(),
      role: "user",
      content: question,
    };

    setMessages((prev) => [...prev, userMessage]);
    setIsLoading(true);

    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (session?.access_token) {
        headers["Authorization"] = `Bearer ${session.access_token}`;
      }

      const res = await fetch("/api/chat", {
        method: "POST",
        headers,
        body: JSON.stringify({ question, spoilerTier }),
      });

      const data = await res.json();

      // Requires sign-in (anon query limit or solution tier block)
      if (data.requiresAuth) {
        const wallMessage: Message = {
          id: (Date.now() + 1).toString(),
          role: "assistant",
          content: "",
          requiresAuth: true,
          requiresAuthReason: data.requiresAuthReason ?? "query_limit",
        };
        setMessages((prev) => [...prev, wallMessage]);
        return;
      }

      // Handle rate limiting (existing signed-in rate limits, still commented out but kept for future)
      if (data.rateLimited) {
        const rateLimitMessage: Message = {
          id: (Date.now() + 1).toString(),
          role: "assistant",
          content: data.error,
          showUpgradeCTA: !!data.showUpgradeCTA,
        };
        setMessages((prev) => [...prev, rateLimitMessage]);
        return;
      }

      const aiMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: data.answer || "Sorry, I couldn't find an answer to that.",
        spoilerTier: spoilerTier,
        sources: data.sources || [],
      };

      setMessages((prev) => [...prev, aiMessage]);

      // Increment anon counter for non-cached responses (cache hits don't count)
      if (!user && !data.cached) {
        const anonCount = parseInt(localStorage.getItem(ANON_COUNT_KEY) || "0", 10);
        localStorage.setItem(ANON_COUNT_KEY, String(anonCount + 1));
      }
    } catch {
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: "Something went wrong. Please try again.",
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex h-[100dvh] max-w-5xl mx-auto">
    {/* Main chat column */}
    <div className="flex flex-col flex-1 min-h-0 min-w-0 max-w-3xl mx-auto">
      {/* Header */}
      <header className="flex-shrink-0 border-b border-[#2a2a3a] px-3 sm:px-4 py-2 sm:py-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <Image
              src="/logo.webp"
              alt="Crimson Desert Guide"
              width={44}
              height={44}
              className="flex-shrink-0 w-9 h-9 sm:w-11 sm:h-11"
              priority
            />
            <div className="min-w-0">
              <h1 className="text-base sm:text-xl font-bold truncate">
                <span className="text-red-500">Crimson</span>{" "}
                <span className="text-gray-100">Desert Guide</span>
              </h1>
              <p className="text-xs text-gray-500 mt-0.5 hidden sm:block">
                AI-powered game companion
              </p>
            </div>
          </div>
          <AuthButton
            externalOpen={showAuthModal}
            onExternalClose={() => setShowAuthModal(false)}
          />
        </div>
      </header>

      {/* Spoiler tier selector */}
      <div className="flex-shrink-0 px-4 py-2 sm:py-3 border-b border-[#2a2a3a]">
        <div className="flex items-center justify-between">
          <span className="text-xs text-gray-500 mr-3">Spoiler level:</span>
          <SpoilerTierSelector
            selected={spoilerTier}
            onChange={setSpoilerTier}
            isPremium={tier === "premium"}
            isSignedIn={!!user}
            onSignInRequest={() => setShowAuthModal(true)}
          />
        </div>
      </div>

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto min-h-0 px-4 py-4">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center px-4">
            <h2 className="text-lg font-semibold text-gray-200 mb-2">
              Ask anything about Crimson Desert
            </h2>
            <p className="text-sm text-gray-500 max-w-md mb-6">
              Puzzles, boss fights, item locations, builds, mechanics — get
              instant answers with the spoiler level you choose.
            </p>
            <CoverageStats />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full max-w-md">
              {[
                "How do I solve the Azure Moon Labyrinth?",
                "Best strategy for Kailok the Hornsplitter?",
              ].map((q) => (
                <button
                  key={q}
                  onClick={() => handleSend(q)}
                  className="text-left text-xs text-gray-400 bg-[#1a1a24] border border-[#2a2a3a] rounded-lg px-3 py-2.5 hover:border-red-500/30 hover:text-gray-300 transition-all"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, i) => {
          // Count how many assistant messages have appeared up to this point
          const assistantCount = messages.slice(0, i + 1).filter(m => m.role === "assistant").length;
          const isAssistant = msg.role === "assistant";

          return (
            <div key={msg.id}>
              {msg.requiresAuth ? (
                <SignInWall
                  reason={msg.requiresAuthReason}
                  onSignInClick={() => setShowAuthModal(true)}
                />
              ) : (
                <>
                  <ChatMessage message={msg} />
                  {/* Show upgrade CTA when signed-in free user hits rate limit */}
                  {isAssistant && msg.showUpgradeCTA && (
                    <UpgradeCTA rateLimitHit />
                  )}
                  {/* Show upgrade CTA after every 5th assistant response (signed-in users only) */}
                  {showAds && !!user && isAssistant && assistantCount > 0 && assistantCount % 5 === 0 && !msg.showUpgradeCTA && (
                    <UpgradeCTA />
                  )}
                  {/* Anonymous: show ad after 2nd response, then every 2nd after that */}
                  {showAds && !user && isAssistant && assistantCount > 0 && assistantCount % 2 === 0 && (
                    <AdBanner slot={AD_SLOT_BANNER} format="horizontal" className="my-4" />
                  )}
                  {/* Signed-in free: show ad banner every 6th response */}
                  {showAds && !!user && isAssistant && assistantCount > 0 && assistantCount % 6 === 0 && assistantCount % 5 !== 0 && (
                    <AdBanner slot={AD_SLOT_BANNER} format="horizontal" className="my-4" />
                  )}
                </>
              )}
            </div>
          );
        })}

        {isLoading && (
          <div className="flex justify-start mb-4">
            <div className="bg-[#1a1a24] border border-[#2a2a3a] rounded-2xl px-4 py-3">
              <div className="flex gap-1">
                <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse-glow" />
                <div
                  className="w-2 h-2 bg-red-500 rounded-full animate-pulse-glow"
                  style={{ animationDelay: "0.3s" }}
                />
                <div
                  className="w-2 h-2 bg-red-500 rounded-full animate-pulse-glow"
                  style={{ animationDelay: "0.6s" }}
                />
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input area */}
      <div className="flex-shrink-0 border-t border-[#2a2a3a] px-4 py-3">
        <ChatInput onSend={handleSend} disabled={isLoading} />
      </div>

      {/* Footer */}
      <div className="flex-shrink-0 px-4 py-2 flex justify-center gap-4 text-xs text-gray-600">
        <a href="/privacy" className="hover:text-gray-400 transition-colors">Privacy Policy</a>
        <span>·</span>
        <a href="/terms" className="hover:text-gray-400 transition-colors">Terms of Service</a>
      </div>
    </div>

    {/* Desktop sidebar ad */}
    {showAds && AD_SLOT_SIDEBAR && (
      <aside className="hidden lg:flex flex-shrink-0 w-[300px] border-l border-[#2a2a3a] p-4 items-start justify-center pt-20">
        <div className="sticky top-4">
          <AdBanner slot={AD_SLOT_SIDEBAR} format="rectangle" />
        </div>
      </aside>
    )}
    </div>
  );
}
