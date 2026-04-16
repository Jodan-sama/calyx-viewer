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

/** Upload a small 3D-render preview image — the thumbnail shown in the
 *  save dialog's slot picker so the user can see at a glance what the
 *  *final rendered packaging* looks like for each slot, not just the
 *  raw artwork. Lives in the same `labels` bucket under `previews/<slug>/`
 *  to avoid collisions. Previews are typically ~400px JPEGs (<50KB) so
 *  storage stays cheap even at many slots × many brands. Returns the
 *  public URL. */
export async function uploadPreview(
  file: Blob,
  brandSlug: string,
  filename: string
): Promise<string> {
  const supabase = getSupabase();
  const path = `previews/${brandSlug}/${Date.now()}-${filename}`;
  const { error } = await supabase.storage
    .from(LABEL_BUCKET)
    .upload(path, file, {
      cacheControl: "3600",
      upsert: false,
      contentType: file.type || "image/jpeg",
    });
  if (error) throw error;
  const { data } = supabase.storage.from(LABEL_BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

/** Upload a brand logo. Lives in the same `labels` bucket but under a
 *  `logos/<slug>/` prefix so it doesn't collide with product label uploads.
 *  Returns the public URL. */
export async function uploadBrandLogo(
  file: Blob,
  brandSlug: string,
  filename: string
): Promise<string> {
  const supabase = getSupabase();
  const path = `logos/${brandSlug}/${Date.now()}-${filename}`;
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
