import { getSupabase } from "./supabase";
import {
  slugify,
  type Brand,
  type ProductSet,
  type ProductSetKind,
  type ProductSetSection,
  type SceneEnvironment,
} from "./types";
import type { BagMaterial } from "./bagMaterial";

/* ───────── Brands ───────── */

export async function getBrandBySlug(slug: string): Promise<Brand | null> {
  const { data, error } = await getSupabase()
    .from("brands")
    .select("*")
    .eq("slug", slug)
    .maybeSingle();
  if (error) throw error;
  return (data as Brand) ?? null;
}

export async function listBrands(): Promise<Brand[]> {
  const { data, error } = await getSupabase()
    .from("brands")
    .select("*")
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

/** Patch brand theme colors. Either field may be null to clear it. */
export async function updateBrandColors(
  brandId: string,
  patch: { primary_color?: string | null; secondary_color?: string | null }
): Promise<Brand> {
  const { data, error } = await getSupabase()
    .from("brands")
    .update(patch)
    .eq("id", brandId)
    .select()
    .single();
  if (error) throw error;
  return data as Brand;
}

/** Patch the brand's logo URL. Pass `null` to clear it. */
export async function updateBrandLogo(
  brandId: string,
  logoUrl: string | null
): Promise<Brand> {
  const { data, error } = await getSupabase()
    .from("brands")
    .update({ logo_url: logoUrl })
    .eq("id", brandId)
    .select()
    .single();
  if (error) throw error;
  return data as Brand;
}

export async function getOrCreateBrand(name: string): Promise<Brand> {
  const slug = slugify(name);
  const supabase = getSupabase();

  const { data: existing, error: selErr } = await supabase
    .from("brands")
    .select("*")
    .eq("slug", slug)
    .maybeSingle();
  if (selErr) throw selErr;
  if (existing) return existing as Brand;

  const { data, error } = await supabase
    .from("brands")
    .insert({ name, slug })
    .select()
    .single();
  if (error) throw error;
  return data as Brand;
}

/* ───────── Product sets ───────── */

export async function listSetsForBrand(
  brandId: string
): Promise<ProductSet[]> {
  const { data, error } = await getSupabase()
    .from("product_sets")
    .select("*")
    .eq("brand_id", brandId)
    .order("section", { ascending: true })
    .order("slot", { ascending: true });
  if (error) throw error;
  return (data ?? []) as ProductSet[];
}

/** Fetch a single product set by id. Used when the Calyx Preview page is
 *  opened via `?open=<id>` so it can rehydrate the viewer with the exact
 *  material/environment/textures captured at save time. */
export async function getSetById(id: string): Promise<ProductSet | null> {
  const { data, error } = await getSupabase()
    .from("product_sets")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return (data as ProductSet) ?? null;
}

/** Patch a set's title in place. Used by the Outreach slot's inline title
 *  editor — only admin chrome calls this. */
export async function updateSetTitle(
  setId: string,
  title: string
): Promise<ProductSet> {
  const { data, error } = await getSupabase()
    .from("product_sets")
    .update({ title })
    .eq("id", setId)
    .select()
    .single();
  if (error) throw error;
  return data as ProductSet;
}

/** Upsert a set into a specific (brand, section, slot) cell. Replaces any existing row.
 *
 *  `preview_image_url` requires a one-time DB migration:
 *      ALTER TABLE product_sets ADD COLUMN preview_image_url TEXT;
 *
 *  To stay backwards-compatible with DBs that haven't run the migration
 *  yet, we detect the "column does not exist" error (PostgREST code
 *  PGRST204 / 42703) and retry the insert with the field stripped, so
 *  the feature gracefully degrades rather than blocking saves. */
export async function saveSet(input: {
  brand_id: string;
  section: ProductSetSection;
  slot: number;
  kind: ProductSetKind;
  title: string;
  product_type: ProductSet["product_type"];
  label_image_url: string;
  material?: BagMaterial | null;
  environment?: SceneEnvironment | null;
  preview_image_url?: string | null;
}): Promise<ProductSet> {
  const supabase = getSupabase();

  // delete any existing set in this (brand, section, slot) so the unique index stays clean
  await supabase
    .from("product_sets")
    .delete()
    .eq("brand_id", input.brand_id)
    .eq("section", input.section)
    .eq("slot", input.slot);

  const baseRow = {
    brand_id: input.brand_id,
    section: input.section,
    slot: input.slot,
    kind: input.kind,
    title: input.title,
    product_type: input.product_type,
    label_image_url: input.label_image_url,
    material: input.material ?? null,
    environment: input.environment ?? "default",
  };
  const row =
    input.preview_image_url !== undefined
      ? { ...baseRow, preview_image_url: input.preview_image_url }
      : baseRow;

  const { data, error } = await supabase
    .from("product_sets")
    .insert(row)
    .select()
    .single();
  if (!error) return data as ProductSet;

  // Fallback: column doesn't exist yet → retry without the field.
  // PostgREST surfaces unknown-column errors with message "column
  // \"preview_image_url\" … does not exist" and code PGRST204 / 42703.
  const msg = (error.message ?? "").toLowerCase();
  const missingCol =
    msg.includes("preview_image_url") &&
    (msg.includes("does not exist") || msg.includes("could not find"));
  if (missingCol && "preview_image_url" in row) {
    const { data: fbData, error: fbErr } = await supabase
      .from("product_sets")
      .insert(baseRow)
      .select()
      .single();
    if (fbErr) throw fbErr;
    // eslint-disable-next-line no-console
    console.warn(
      "[calyx] saveSet: preview_image_url column missing on product_sets — " +
        "run `ALTER TABLE product_sets ADD COLUMN preview_image_url TEXT;` " +
        "to enable render-state slot thumbnails."
    );
    return fbData as ProductSet;
  }
  throw error;
}
