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
  onUpgradeWaitlist: boolean;
  setOnUpgradeWaitlist: (v: boolean) => void;
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
  const [onUpgradeWaitlist, setOnUpgradeWaitlist] = useState(false);

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

    // Upgrade-waitlist membership. Folded into the same profile-fetch
    // round trip per the session 41 spec so the UI doesn't need a
    // separate request to render the correct button state on load.
    // RLS blocks anon SELECT on upgrade_waitlist (returns []), but
    // the authenticated user's JWT carries no special grant either —
    // policies block all roles. We go through /api/upgrade-waitlist
    // (service role) to do the actual check.
    try {
      const { data: { session: s } } = await supabase.auth.getSession();
      if (s?.access_token) {
        const res = await fetch("/api/upgrade-waitlist", {
          method: "GET",
          headers: { Authorization: `Bearer ${s.access_token}` },
        });
        if (res.ok) {
          const body = await res.json().catch(() => null);
          setOnUpgradeWaitlist(!!body?.onList);
        } else {
          // Don't poison state on transient failure — treat as unknown=false.
          setOnUpgradeWaitlist(false);
        }
      }
    } catch {
      setOnUpgradeWaitlist(false);
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
    // Propagate intent + returnTo through OAuth → /auth/callback so the
    // server-side handler can auto-join the waitlist and bounce back to
    // the original page. We read them from the current URL at click time
    // so callers don't have to plumb the params explicitly.
    const here = new URL(window.location.href);
    const intent = here.searchParams.get("intent");
    const returnTo = here.searchParams.get("returnTo");
    const callback = new URL("/auth/callback", window.location.origin);
    if (intent) callback.searchParams.set("intent", intent);
    if (returnTo) callback.searchParams.set("returnTo", returnTo);
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: callback.toString(),
      },
    });
  }

  async function signOut() {
    await supabase.auth.signOut();
    setTier("free");
    setQueriesToday(0);
    setOnUpgradeWaitlist(false);
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
        onUpgradeWaitlist,
        setOnUpgradeWaitlist,
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
