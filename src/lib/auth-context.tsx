"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { supabase } from "./supabase";
import type { User, Session } from "@supabase/supabase-js";

const MAX_USERS = Number(process.env.NEXT_PUBLIC_MAX_USERS) || 50;

interface AuthState {
  user: User | null;
  session: Session | null;
  loading: boolean;
  tier: "free" | "premium";
  queriesToday: number;
  signupsClosed: boolean;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signUp: (email: string, password: string) => Promise<{ error: string | null }>;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [tier, setTier] = useState<"free" | "premium">("free");
  const [queriesToday, setQueriesToday] = useState(0);
  const [signupsClosed, setSignupsClosed] = useState(false);

  // Check if signups are at capacity
  async function checkCapacity(): Promise<boolean> {
    const { count, error } = await supabase
      .from("users")
      .select("id", { count: "exact", head: true });
    if (error) {
      console.error("Capacity check error:", error);
      return false; // Allow signup if check fails
    }
    return (count ?? 0) >= MAX_USERS;
  }

  useEffect(() => {
    // Check capacity on mount (only matters for logged-out users)
    checkCapacity().then(setSignupsClosed);
    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) fetchUserProfile(session.user.id);
      setLoading(false);
    });

    // Listen for auth changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) fetchUserProfile(session.user.id);
    });

    return () => subscription.unsubscribe();
  }, []);

  async function fetchUserProfile(userId: string) {
    const { data } = await supabase
      .from("users")
      .select("tier, queries_today, queries_today_reset_at")
      .eq("id", userId)
      .single();

    if (data) {
      setTier(data.tier as "free" | "premium");

      // Reset daily counter if it's a new day
      const today = new Date().toISOString().split("T")[0];
      if (data.queries_today_reset_at !== today) {
        setQueriesToday(0);
        await supabase
          .from("users")
          .update({ queries_today: 0, queries_today_reset_at: today })
          .eq("id", userId);
      } else {
        setQueriesToday(data.queries_today);
      }
    }
  }

  async function signIn(email: string, password: string) {
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    return { error: error?.message ?? null };
  }

  async function signUp(email: string, password: string) {
    // Re-check capacity at signup time to prevent races
    const atCapacity = await checkCapacity();
    if (atCapacity) {
      setSignupsClosed(true);
      return { error: "Signups are currently closed — we've hit our early access limit. Check back soon!" };
    }
    const { error } = await supabase.auth.signUp({ email, password });
    if (!error) {
      // User profile will be created via trigger or on first sign-in
    }
    return { error: error?.message ?? null };
  }

  async function signInWithGoogle() {
    // Check capacity before initiating OAuth redirect
    const atCapacity = await checkCapacity();
    if (atCapacity) {
      setSignupsClosed(true);
      return;
    }
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    });
  }

  async function signOut() {
    await supabase.auth.signOut();
    setTier("free");
    setQueriesToday(0);
  }

  async function refreshProfile() {
    const { data: { session: currentSession } } = await supabase.auth.getSession();
    if (currentSession?.user) {
      await fetchUserProfile(currentSession.user.id);
    }
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        loading,
        tier,
        queriesToday,
        signupsClosed,
        signIn,
        signUp,
        signInWithGoogle,
        signOut,
        refreshProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
