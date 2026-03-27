"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { supabase } from "./supabase";
import type { User, Session } from "@supabase/supabase-js";

interface AuthState {
  user: User | null;
  session: Session | null;
  loading: boolean;
  tier: "free" | "premium";
  queriesToday: number;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signUp: (email: string, password: string) => Promise<{ error: string | null }>;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [tier, setTier] = useState<"free" | "premium">("free");
  const [queriesToday, setQueriesToday] = useState(0);

  useEffect(() => {
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
    const { error } = await supabase.auth.signUp({ email, password });
    if (!error) {
      // User profile will be created via trigger or on first sign-in
    }
    return { error: error?.message ?? null };
  }

  async function signInWithGoogle() {
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

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        loading,
        tier,
        queriesToday,
        signIn,
        signUp,
        signInWithGoogle,
        signOut,
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
