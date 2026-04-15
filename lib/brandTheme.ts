/**
 * Brand-scoped theming helpers.
 *
 * Each brand stores a primary color (page background) and secondary color
 * (accent: buttons, outlines, links) on the `brands` table. Those values
 * are exposed as CSS variables on the outer page container so descendant
 * elements can opt in via `bg-[var(--brand-secondary)]`, inline styles,
 * etc., with sensible defaults for un-themed brands.
 */

import type { CSSProperties } from "react";
import type { Brand } from "./types";

export const DEFAULT_PRIMARY = "#ffffff";
export const DEFAULT_SECONDARY = "#0033A1";

export interface BrandColors {
  primary: string;
  secondary: string;
}

/** Resolve effective colors with fallbacks. Accepts partial/null brands. */
export function resolveBrandColors(
  b: Pick<Brand, "primary_color" | "secondary_color"> | null | undefined
): BrandColors {
  return {
    primary: b?.primary_color || DEFAULT_PRIMARY,
    secondary: b?.secondary_color || DEFAULT_SECONDARY,
  };
}

/** Build inline style that sets brand CSS vars on a container. */
export function brandThemeVars(colors: BrandColors): CSSProperties {
  return {
    // Cast via Record because React's CSSProperties doesn't know about
    // user-defined CSS custom properties.
    ["--brand-primary" as string]: colors.primary,
    ["--brand-secondary" as string]: colors.secondary,
  } as CSSProperties;
}
