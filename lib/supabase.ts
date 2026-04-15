import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Singleton Supabase browser client.
 *
 * Env vars required in .env.local:
 *   NEXT_PUBLIC_SUPABASE_URL
 *   NEXT_PUBLIC_SUPABASE_ANON_KEY
 *
 * NEXT_PUBLIC_* vars are embedded at build time and are safe in the browser
 * as long as Row Level Security is enabled on every table.
 */

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

let _client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (_client) return _client;
  if (!url || !anonKey) {
    throw new Error(
      "Missing Supabase env vars. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to .env.local"
    );
  }
  _client = createClient(url, anonKey, {
    auth: { persistSession: false },
  });
  return _client;
}

export const supabaseConfigured = Boolean(url && anonKey);

/* ───────────────────────────────────────────────────────────────
   Storage helpers
   ─────────────────────────────────────────────────────────────── */
export const LABEL_BUCKET = "labels";

/** Upload a label image. Returns the public URL. */
export async function uploadLabel(
  file: Blob,
  brandSlug: string,
  filename: string
): Promise<string> {
  const supabase = getSupabase();
  const path = `${brandSlug}/${Date.now()}-${filename}`;
  const { error } = await supabase.storage
    .from(LABEL_BUCKET)
    .upload(path, file, {
      cacheControl: "3600",
      upsert: false,
      contentType: file.type || "image/png",
    });
  if (error) throw error;
  const { data } = supabase.storage.from(LABEL_BUCKET).getPublicUrl(path);
  return data.publicUrl;
}
