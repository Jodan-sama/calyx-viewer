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
    ["--brand-primary-gradient" as string]: brandPrimaryGradient(colors.primary),
  } as CSSProperties;
}

/* ─────────────────────────────────────────────────────────────────────────
   Gradient helpers
   The client site renders its page background as a soft diagonal gradient
   built from related tones of the brand's primary colour rather than a
   flat fill. Using HSL keeps every stop in the same colour family while
   nudging lightness and hue just enough to read as a gradient instead of
   a posterised step.
   ─────────────────────────────────────────────────────────────────────── */

/** Build a 3-stop diagonal gradient from a single hex colour. The two
 *  outer stops are nudged slightly lighter / slightly darker, and the hue
 *  is rotated by a few degrees to give the gradient subtle warmth without
 *  drifting outside the brand. Returns a `linear-gradient(...)` CSS string. */
export function brandPrimaryGradient(hex: string): string {
  const base = hexToHsl(hex);
  if (!base) return hex;
  const { h, s, l } = base;
  // Lightness clamps so even very light or very dark base colours still
  // produce a visible gradient instead of two identical stops.
  const top = { h: rotate(h, -8), s, l: clamp(l + 6, 4, 96) };
  const mid = { h, s, l };
  const bot = { h: rotate(h, +12), s, l: clamp(l - 7, 4, 96) };
  return `linear-gradient(135deg, ${hslToCss(top)} 0%, ${hslToCss(mid)} 50%, ${hslToCss(bot)} 100%)`;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}
function rotate(h: number, delta: number): number {
  return ((h + delta) % 360 + 360) % 360;
}

function hslToCss({ h, s, l }: { h: number; s: number; l: number }): string {
  return `hsl(${h.toFixed(1)}, ${s.toFixed(1)}%, ${l.toFixed(1)}%)`;
}

/** Convert a hex colour into an `rgba(r,g,b,a)` string. Falls back to the
 *  raw input if it doesn't look like hex — handy when the caller wants to
 *  pass a colour through to a canvas with a tunable alpha. */
export function hexToRgba(input: string, alpha: number): string {
  const m = input.trim().match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!m) return input;
  let hex = m[1];
  if (hex.length === 3) hex = hex.split("").map((c) => c + c).join("");
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function hexToHsl(input: string): { h: number; s: number; l: number } | null {
  const m = input.trim().match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!m) return null;
  let hex = m[1];
  if (hex.length === 3) hex = hex.split("").map((c) => c + c).join("");
  const r = parseInt(hex.slice(0, 2), 16) / 255;
  const g = parseInt(hex.slice(2, 4), 16) / 255;
  const b = parseInt(hex.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)); break;
      case g: h = ((b - r) / d + 2); break;
      default: h = ((r - g) / d + 4);
    }
    h /= 6;
  }
  return { h: h * 360, s: s * 100, l: l * 100 };
}
