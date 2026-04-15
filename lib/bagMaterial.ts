/**
 * Shared bag material definitions.
 * Consumed by both BagViewer (source of truth — Leva controls)
 * and OutreachBagViewer (playback — reads stored config).
 */

export type BagFinish =
  | "metallic"
  | "matte"
  | "gloss"
  | "satin"
  | "foil"
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
}

export const DEFAULT_MATERIAL: BagMaterial = {
  finish: "metallic",
  metalness: 0.92,
  roughness: 0.08,
  bagColor: "#c4cdd8",
  labelMetalness: 0.1,
  labelRoughness: 0.55,
  lighting: "studio",
};

/** Resolve the effective surface numbers for a material. */
export function resolveSurface(m: BagMaterial): FinishPreset {
  if (m.finish === "custom") {
    return { metalness: m.metalness, roughness: m.roughness };
  }
  return FINISH_PRESETS[m.finish] ?? FINISH_PRESETS.metallic;
}
