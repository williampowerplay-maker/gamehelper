"use client";

import { useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/lib/supabase";

export default function AuthButton() {
  const { user, tier, signIn, signUp, signInWithGoogle, signOut, loading, signupsClosed } =
    useAuth();
  const [showModal, setShowModal] = useState(false);
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [waitlistEmail, setWaitlistEmail] = useState("");
  const [waitlistStatus, setWaitlistStatus] = useState<"idle" | "submitting" | "success" | "error">("idle");

  if (loading) return null;

  if (user) {
    return (
      <div className="flex items-center gap-2">
        <span
          className={`text-xs px-2 py-0.5 rounded-full font-medium ${
            tier === "premium"
              ? "bg-amber-500/20 text-amber-400"
              : "bg-gray-700 text-gray-400"
          }`}
        >
          {tier === "premium" ? "Premium" : "Free"}
        </span>
        <button
          onClick={signOut}
          className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
        >
          Sign out
        </button>
      </div>
    );
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    const result = isSignUp
      ? await signUp(email, password)
      : await signIn(email, password);

    if (result.error) {
      setError(result.error);
    } else {
      setShowModal(false);
      setEmail("");
      setPassword("");
    }
    setSubmitting(false);
  };

  const handleWaitlist = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!waitlistEmail.trim()) return;
    setWaitlistStatus("submitting");

    const { error } = await supabase
      .from("waitlist")
      .upsert({ email: waitlistEmail.trim().toLowerCase() }, { onConflict: "email" });

    if (error) {
      console.error("Waitlist error:", error);
      setWaitlistStatus("error");
    } else {
      setWaitlistStatus("success");
    }
  };

  return (
    <>
      <button
        onClick={() => setShowModal(true)}
        className="text-sm text-red-400 hover:text-red-300 font-medium transition-colors"
      >
        Sign in
      </button>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-[#1a1a24] border border-[#2a2a3a] rounded-2xl p-6 w-full max-w-sm mx-4">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-bold text-gray-100">
                {isSignUp ? "Create account" : "Sign in"}
              </h2>
              <button
                onClick={() => setShowModal(false)}
                className="text-gray-500 hover:text-gray-300"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  className="w-5 h-5"
                >
                  <path
                    fillRule="evenodd"
                    d="M5.47 5.47a.75.75 0 011.06 0L12 10.94l5.47-5.47a.75.75 0 111.06 1.06L13.06 12l5.47 5.47a.75.75 0 11-1.06 1.06L12 13.06l-5.47 5.47a.75.75 0 01-1.06-1.06L10.94 12 5.47 6.53a.75.75 0 010-1.06z"
                    clipRule="evenodd"
                  />
                </svg>
              </button>
            </div>

            {/* Waitlist when signups are closed and user is trying to create account */}
            {isSignUp && signupsClosed ? (
              <div className="text-center py-4">
                <div className="text-3xl mb-3">🔒</div>
                <p className="text-sm text-gray-200 font-medium mb-2">
                  Early access is full
                </p>
                <p className="text-xs text-gray-400 mb-4">
                  We've hit our initial user limit while we dial in costs.
                  Join the waitlist and we'll let you know when spots open up!
                </p>

                {waitlistStatus === "success" ? (
                  <div className="bg-green-500/10 border border-green-500/30 rounded-xl px-4 py-3 mb-4">
                    <p className="text-sm text-green-400 font-medium">You're on the list!</p>
                    <p className="text-xs text-green-400/70 mt-1">We'll email you when spots open up.</p>
                  </div>
                ) : (
                  <form onSubmit={handleWaitlist} className="flex gap-2 mb-4">
                    <input
                      type="email"
                      placeholder="Enter your email"
                      value={waitlistEmail}
                      onChange={(e) => setWaitlistEmail(e.target.value)}
                      required
                      className="flex-1 bg-[#0f0f14] border border-[#2a2a3a] rounded-xl px-3 py-2.5 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-red-500/50"
                    />
                    <button
                      type="submit"
                      disabled={waitlistStatus === "submitting"}
                      className="bg-red-600 hover:bg-red-700 disabled:bg-gray-700 text-white rounded-xl px-4 py-2.5 text-sm font-medium transition-colors whitespace-nowrap"
                    >
                      {waitlistStatus === "submitting" ? "..." : "Join"}
                    </button>
                  </form>
                )}

                {waitlistStatus === "error" && (
                  <p className="text-xs text-red-400 mb-4">Something went wrong. Try again.</p>
                )}

                <p className="text-xs text-gray-500">
                  Already have an account?{" "}
                  <button
                    onClick={() => {
                      setIsSignUp(false);
                      setError(null);
                    }}
                    className="text-red-400 hover:text-red-300"
                  >
                    Sign in
                  </button>
                </p>
              </div>
            ) : (
              <>
                {/* Google OAuth */}
                <button
                  onClick={signInWithGoogle}
                  className="w-full flex items-center justify-center gap-2 bg-white text-gray-900 rounded-xl px-4 py-2.5 text-sm font-medium hover:bg-gray-100 transition-colors mb-4"
                >
                  <svg viewBox="0 0 24 24" className="w-4 h-4">
                    <path
                      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
                      fill="#4285F4"
                    />
                    <path
                      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                      fill="#34A853"
                    />
                    <path
                      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                      fill="#FBBC05"
                    />
                    <path
                      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                      fill="#EA4335"
                    />
                  </svg>
                  {isSignUp ? "Sign up with Google" : "Continue with Google"}
                </button>

                <div className="flex items-center gap-3 mb-4">
                  <div className="flex-1 h-px bg-[#2a2a3a]" />
                  <span className="text-xs text-gray-500">or</span>
                  <div className="flex-1 h-px bg-[#2a2a3a]" />
                </div>

                {/* Email/Password */}
                <form onSubmit={handleSubmit} className="space-y-3">
                  <input
                    type="email"
                    placeholder="Email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    className="w-full bg-[#0f0f14] border border-[#2a2a3a] rounded-xl px-3 py-2.5 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-red-500/50"
                  />
                  <input
                    type="password"
                    placeholder="Password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    minLength={6}
                    className="w-full bg-[#0f0f14] border border-[#2a2a3a] rounded-xl px-3 py-2.5 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-red-500/50"
                  />

                  {error && (
                    <p className="text-xs text-red-400">{error}</p>
                  )}

                  <button
                    type="submit"
                    disabled={submitting}
                    className="w-full bg-red-600 hover:bg-red-700 disabled:bg-gray-700 text-white rounded-xl px-4 py-2.5 text-sm font-medium transition-colors"
                  >
                    {submitting
                      ? "..."
                      : isSignUp
                        ? "Create account"
                        : "Sign in"}
                  </button>
                </form>

                <p className="text-xs text-gray-500 text-center mt-3">
                  {isSignUp ? "Already have an account?" : "No account?"}{" "}
                  <button
                    onClick={() => {
                      setIsSignUp(!isSignUp);
                      setError(null);
                    }}
                    className="text-red-400 hover:text-red-300"
                  >
                    {isSignUp ? "Sign in" : "Create one"}
                  </button>
                </p>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
