/**
 * Shared bag material definitions.
 * Consumed by both BagViewer (source of truth — Leva controls)
 * and OutreachBagViewer (playback — reads stored config).
 */

/** Default artwork rendered on the bag when no user upload is provided.
 *  Both URLs are public static assets, safe to use server- or client-side.
 *
 *  These ship as lossless WebP — pixel-identical to the original PNGs
 *  but 77–80% smaller (700KB → 180KB for the pair). All modern browsers
 *  decode WebP, and three.js' TextureLoader routes them through the
 *  same canvas pipeline as PNG so the alpha channel is preserved. */
export const DEFAULT_FRONT_TEXTURE = "/images/calyx-bag-front.webp";
export const DEFAULT_BACK_TEXTURE = "/images/calyx-bag-back.webp";

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
  | "rave"
  | "uv";

/** Yellow-green glow applied to UV-tagged layers when lighting === "uv".
 *  Approximates the visible re-emission fluorescent pigments give off
 *  under real blacklight. Kept as a constant so the studio, the
 *  bag/jar meshes, and the outreach viewers agree on the same hue. */
export const UV_GLOW_COLOR = "#b6ff00";

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
   *  pixels paint with the per-layer Material finish (see `labelMatFinish`
   *  below) instead of the artwork's RGB values. Optional for backwards-
   *  compatibility with existing saves. */
  labelMaterial?: boolean;
  /** Per-layer Material finish for Layer 2 (the label artwork). Used only
   *  when `labelMaterial` is true. Omitted → layer falls back to Layer 1's
   *  finish, which matches the pre-per-layer behaviour for older saves. */
  labelMatFinish?: BagFinish;
  /** Custom metalness when `labelMatFinish === "custom"`. */
  labelMatMetalness?: number;
  /** Custom roughness when `labelMatFinish === "custom"`. */
  labelMatRoughness?: number;

  /* Jar Layer 2 — separate from bag's `label*` above so model-switch state
   * stays independent. All optional for back-compat with older saves. */
  layer2Metalness?: number;
  layer2Roughness?: number;
  layer2Varnish?: boolean;
  layer2Material?: boolean;
  layer2MatFinish?: BagFinish;
  layer2MatMetalness?: number;
  layer2MatRoughness?: number;

  /* Layer 3 — shared between bag (stacked decal) and jar (second label). */
  layer3Metalness?: number;
  layer3Roughness?: number;
  layer3Varnish?: boolean;
  layer3Material?: boolean;
  layer3MatFinish?: BagFinish;
  layer3MatMetalness?: number;
  layer3MatRoughness?: number;

  /* UV Blacklight glow — per-layer opt-in. Only takes effect when the
   * scene's lighting preset is "uv". Tags the layer's artwork as
   * fluorescent so it emits UV_GLOW_COLOR through the artwork's alpha,
   * while other finishes stay dark under the violet ambient. */
  labelUV?: boolean;
  layer2UV?: boolean;
  layer3UV?: boolean;

  /* Saved artwork URLs for every layer past the primary front. The front
   * image lives in the slot's `label_image_url` column; these cover the
   * back (bag Layer 2 back / jar Layer 3) and bag Layer 3 front/back.
   * Undefined → playback uses the default or skips that decal. */
  backImageUrl?: string;
  layer3FrontImageUrl?: string;
  layer3BackImageUrl?: string;

  /* Scene + full lighting rig — saved per-slot so the look travels with
   * the configuration, not just the user's browser localStorage. Every
   * field is optional so older saves and fresh slots fall back to
   * hardcoded defaults without blowing up. */
  autoRotate?: boolean;
  toneMappingCurve?: string;
  toneMappingExposure?: number;
  backgroundMode?: string;
  backgroundColor1?: string;
  backgroundColor2?: string;
  backgroundAngle?: number;
  fogEnabled?: boolean;
  fogColor?: string;
  fogNear?: number;
  fogFar?: number;
  shadowsEnabled?: boolean;
  shadowMapSize?: number;
  shadowRadius?: number;
  shadowGround?: boolean;
  shadowOpacity?: number;
  ambientIntensity?: number;
  ambientColor?: string;
  envIntensity?: number;
  dirCount?: number;
  dir1Color?: string; dir1Intensity?: number; dir1Pos?: { x: number; y: number; z: number };
  dir2Color?: string; dir2Intensity?: number; dir2Pos?: { x: number; y: number; z: number };
  spotCount?: number;
  spot1Color?: string; spot1Intensity?: number; spot1Pos?: { x: number; y: number; z: number };
  spot2Color?: string; spot2Intensity?: number; spot2Pos?: { x: number; y: number; z: number };
  spot3Color?: string; spot3Intensity?: number; spot3Pos?: { x: number; y: number; z: number };
  spot4Color?: string; spot4Intensity?: number; spot4Pos?: { x: number; y: number; z: number };
  pointCount?: number;
  point1Color?: string; point1Intensity?: number; point1Pos?: { x: number; y: number; z: number };
  point2Color?: string; point2Intensity?: number; point2Pos?: { x: number; y: number; z: number };
  point3Color?: string; point3Intensity?: number; point3Pos?: { x: number; y: number; z: number };
  point4Color?: string; point4Intensity?: number; point4Pos?: { x: number; y: number; z: number };
  rectCount?: number;
  rectBothSides?: boolean;
  rect1Color?: string; rect1Intensity?: number; rect1Width?: number; rect1Height?: number; rect1X?: number; rect1Y?: number; rect1Z?: number;
  rect2Color?: string; rect2Intensity?: number; rect2Width?: number; rect2Height?: number; rect2X?: number; rect2Y?: number; rect2Z?: number;
  rect3Color?: string; rect3Intensity?: number; rect3Width?: number; rect3Height?: number; rect3X?: number; rect3Y?: number; rect3Z?: number;
  rect4Color?: string; rect4Intensity?: number; rect4Width?: number; rect4Height?: number; rect4X?: number; rect4Y?: number; rect4Z?: number;
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
