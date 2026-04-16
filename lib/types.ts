/* DB record types (mirror Supabase schema) */

export type Brand = {
  id: string;
  name: string;
  slug: string;
  /** Page background for this brand's Outreach + /client/[slug]. Null = default. */
  primary_color: string | null;
  /** Accent color (buttons, outlines, links) for this brand. Null = Calyx blue. */
  secondary_color: string | null;
  /** Public URL of the brand logo shown on the client site header. Null until
   *  the admin uploads one in the Outreach panel. Stored as the natural-aspect
   *  PNG/SVG/JPEG the admin uploaded — the client site renders it constrained
   *  by height so it never stretches. */
  logo_url: string | null;
  created_at: string;
};

import type { BagMaterial } from "./bagMaterial";

export type ProductSetKind = "bag-3d" | "flat-image";
export type ProductSetSection = "hero" | "gallery";
export type SceneEnvironment = "default" | "smoke" | "dim";

export type ProductSet = {
  id: string;
  brand_id: string;
  section: ProductSetSection;
  slot: number; // 1-3 when section='hero', 1-8 when section='gallery'
  kind: ProductSetKind;
  title: string;
  product_type: "mylar-bag" | "supplement-jar";
  label_image_url: string;
  material: BagMaterial | null;
  /** Scene environment saved at preview time. Null / missing → "default". */
  environment: SceneEnvironment | null;
  created_at: string;
};

export const PRODUCT_TYPES: ProductSet["product_type"][] = [
  "mylar-bag",
  "supplement-jar",
];

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}
