import { getSupabase } from "./supabase";
import {
  slugify,
  type Brand,
  type ProductSet,
  type ProductSetKind,
  type ProductSetSection,
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

/** Upsert a set into a specific (brand, section, slot) cell. Replaces any existing row. */
export async function saveSet(input: {
  brand_id: string;
  section: ProductSetSection;
  slot: number;
  kind: ProductSetKind;
  title: string;
  product_type: ProductSet["product_type"];
  label_image_url: string;
  material?: BagMaterial | null;
}): Promise<ProductSet> {
  const supabase = getSupabase();

  // delete any existing set in this (brand, section, slot) so the unique index stays clean
  await supabase
    .from("product_sets")
    .delete()
    .eq("brand_id", input.brand_id)
    .eq("section", input.section)
    .eq("slot", input.slot);

  const row = {
    brand_id: input.brand_id,
    section: input.section,
    slot: input.slot,
    kind: input.kind,
    title: input.title,
    product_type: input.product_type,
    label_image_url: input.label_image_url,
    material: input.material ?? null,
  };

  const { data, error } = await supabase
    .from("product_sets")
    .insert(row)
    .select()
    .single();
  if (error) throw error;
  return data as ProductSet;
}
