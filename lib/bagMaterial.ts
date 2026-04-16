/**
 * Shared bag material definitions.
 * Consumed by both BagViewer (source of truth — Leva controls)
 * and OutreachBagViewer (playback — reads stored config).
 */

/** Default artwork rendered on the bag when no user upload is provided.
 *  Both URLs are public static assets, safe to use server- or client-side. */
export const DEFAULT_FRONT_TEXTURE = "/images/calyx-bag-front.png";
export const DEFAULT_BACK_TEXTURE = "/images/calyx-bag-back.png";

export type BagFinish =
  | "metallic"
  | "matte"
  | "gloss"
  | "satin"
  | "foil"
  | "prismatic"
  | "multi-chrome"
  | "custom";

export type BagLighting =
  | "studio"
  | "warehouse"
  | "city"
  | "forest"
  | "sunset"
  | "rave";

export interface FinishPreset {
  metalness: number;
  roughness: number;
  iridescence?: number;
  iridescenceIOR?: number;
  iridescenceThicknessRange?: [number, number];
}

export const FINISH_PRESETS: Record<Exclude<BagFinish, "custom">, FinishPreset> = {
  metallic:      { metalness: 0.92, roughness: 0.08 },
  matte:         { metalness: 0.0,  roughness: 0.88 },
  gloss:         { metalness: 0.15, roughness: 0.04 },
  satin:         { metalness: 0.35, roughness: 0.42 },
  foil:          { metalness: 1.0,  roughness: 0.0  },
  // "Prismatic Foil" — mirror-polished chrome base driven by the custom
  // diffraction-grating shader in BagMesh/SupplementJarMesh. Renders as
  // fine rainbow streaks that shift hue with view angle.
  prismatic:     { metalness: 1.0,  roughness: 0.0  },
  "multi-chrome": {
    metalness: 1.0,
    roughness: 0.0,
    iridescence: 1.0,
    iridescenceIOR: 2.5,
    iridescenceThicknessRange: [0, 1200],
  },
};

export interface BagMaterial {
  finish: BagFinish;
  /** only used when finish === "custom" */
  metalness: number;
  /** only used when finish === "custom" */
  roughness: number;
  bagColor: string;
  labelMetalness: number;
  labelRoughness: number;
  lighting: BagLighting;
  /** When true, the label artwork gets a clear-gloss varnish with a subtle
   *  alpha-derived bump so the artwork reads as a raised, high-shine
   *  overprint. Optional for backwards-compatibility with existing saves. */
  labelVarnish?: boolean;
  /** When true, the label artwork's alpha is used as a mask and the opaque
   *  pixels paint with the current base-surface finish (Multi-Chrome /
   *  Prismatic / Foil / matte / …) instead of the artwork's RGB values.
   *  Optional for backwards-compatibility with existing saves. */
  labelMaterial?: boolean;
}

export const DEFAULT_MATERIAL: BagMaterial = {
  finish: "metallic",
  metalness: 0.92,
  roughness: 0.08,
  bagColor: "#c4cdd8",
  labelMetalness: 0.1,
  labelRoughness: 0.55,
  lighting: "studio",
  labelVarnish: false,
  labelMaterial: false,
};

/** Resolve the effective surface numbers for a material. */
export function resolveSurface(m: BagMaterial): FinishPreset {
  if (m.finish === "custom") {
    return { metalness: m.metalness, roughness: m.roughness };
  }
  return FINISH_PRESETS[m.finish] ?? FINISH_PRESETS.metallic;
}

/** drei's <Environment preset> accepts a fixed set of HDRI names. BagLighting
 *  includes one extra, "rave", that we fake with coloured point lights in the
 *  viewers — it is NOT valid for drei and WILL throw at runtime if passed
 *  through. This helper normalises any BagLighting (or legacy/unknown value
 *  from an older saved slot) to a drei-safe preset string.
 *
 *  Callers that want a Rave scene should check `lighting === "rave"` up-front
 *  and mount their own coloured lights, then pass the fallback preset
 *  ("studio") to drei for ambient HDRI contribution. */
export type DreiEnvironmentPreset =
  | "studio"
  | "warehouse"
  | "city"
  | "forest"
  | "sunset";

export function resolveEnvironmentPreset(
  lighting: BagLighting | string | null | undefined
): DreiEnvironmentPreset {
  switch (lighting) {
    case "warehouse":
    case "city":
    case "forest":
    case "sunset":
    case "studio":
      return lighting;
    default:
      // "rave" and anything else unrecognized (including legacy values from
      // older saves) fall back to studio.
      return "studio";
  }
}
