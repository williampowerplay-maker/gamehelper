"use client";

import { useState, useRef, useEffect } from "react";
import Image from "next/image";
import ChatInput from "@/components/ChatInput";
import ChatMessage, { type Message } from "@/components/ChatMessage";
import SpoilerTierSelector from "@/components/SpoilerTierSelector";
import AuthButton from "@/components/AuthButton";
import AdBanner from "@/components/AdBanner";
import UpgradeCTA from "@/components/UpgradeCTA";
import { useAuth } from "@/lib/auth-context";
import { type SpoilerTier } from "@/lib/supabase";

const AD_SLOT_BANNER = process.env.NEXT_PUBLIC_AD_SLOT_BANNER || "";
const AD_SLOT_SIDEBAR = process.env.NEXT_PUBLIC_AD_SLOT_SIDEBAR || "";

export default function Home() {
  const { tier } = useAuth();
  const showAds = tier !== "premium" && !!AD_SLOT_BANNER;
  const [messages, setMessages] = useState<Message[]>([]);
  const [spoilerTier, setSpoilerTier] = useState<SpoilerTier>("nudge");
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSend = async (question: string) => {
    const userMessage: Message = {
      id: Date.now().toString(),
      role: "user",
      content: question,
    };

    setMessages((prev) => [...prev, userMessage]);
    setIsLoading(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, spoilerTier }),
      });

      const data = await res.json();

      // Handle rate limiting
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
    } catch {
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content:
          "Something went wrong. Please try again.",
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex h-[100dvh] max-w-5xl mx-auto">
    {/* Main chat column */}
    <div className="flex flex-col flex-1 min-w-0 max-w-3xl mx-auto">
      {/* Header */}
      <header className="flex-shrink-0 border-b border-[#2a2a3a] px-4 py-2 sm:py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Image
              src="/logo.webp"
              alt="Crimson Desert Guide"
              width={44}
              height={44}
              className="flex-shrink-0"
              priority
            />
            <div>
              <h1 className="text-xl font-bold">
                <span className="text-red-500">Crimson</span>{" "}
                <span className="text-gray-100">Desert Guide</span>
              </h1>
              <p className="text-xs text-gray-500 mt-0.5 hidden sm:block">
                AI-powered game companion
              </p>
            </div>
          </div>
          <AuthButton />
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
          />
        </div>
      </div>

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center px-4">
            <Image src="/logo.webp" alt="Crimson Desert Guide" width={96} height={96} className="mb-4 opacity-90" priority />
            <h2 className="text-lg font-semibold text-gray-200 mb-2">
              Ask anything about Crimson Desert
            </h2>
            <p className="text-sm text-gray-500 max-w-md mb-6">
              Puzzles, boss fights, item locations, builds, mechanics — get
              instant answers with the spoiler level you choose.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full max-w-md">
              {[
                "How do I solve the Azure Moon Labyrinth?",
                "Best strategy for Kailok the Hornsplitter?",
                "Where is the Saint's Necklace?",
                "How does the Abyss Artifact system work?",
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
              <ChatMessage message={msg} />
              {/* Show upgrade CTA when free user hits rate limit */}
              {isAssistant && msg.showUpgradeCTA && (
                <UpgradeCTA rateLimitHit />
              )}
              {/* Show upgrade CTA after every 5th assistant response */}
              {showAds && isAssistant && assistantCount > 0 && assistantCount % 5 === 0 && !msg.showUpgradeCTA && (
                <UpgradeCTA />
              )}
              {/* Show ad banner after every 3rd assistant response (skip if CTA just shown) */}
              {showAds && isAssistant && assistantCount > 0 && assistantCount % 6 === 0 && assistantCount % 5 !== 0 && (
                <AdBanner slot={AD_SLOT_BANNER} format="horizontal" className="my-4" />
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
