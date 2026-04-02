import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Types matching our Supabase schema
export type SpoilerTier = "nudge" | "guide" | "full";
export type ContentType =
  | "puzzle"
  | "boss"
  | "item"
  | "mechanic"
  | "recipe"
  | "exploration"
  | "quest"
  | "character";

export interface KnowledgeChunk {
  id: string;
  content: string;
  embedding: number[];
  source_url: string | null;
  source_type: string;
  chapter: string | null;
  region: string | null;
  quest_name: string | null;
  content_type: ContentType;
  character: string | null;
  spoiler_level: number;
  created_at: string;
}

export interface QueryRecord {
  id: string;
  user_id: string | null;
  question: string;
  response: string;
  spoiler_tier: SpoilerTier;
  chunk_ids_used: string[];
  tokens_used: number;
  created_at: string;
}

export interface WaitlistEntry {
  id: string;
  email: string;
  created_at: string;
}
