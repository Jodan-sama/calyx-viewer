/**
 * Per-environment lighting preferences, persisted to localStorage.
 *
 * The Calyx Preview page exposes a full set of scene-lighting sliders
 * (ambient, HDRI intensity, and up to four user-configurable spotlights
 * each with colour / intensity / XYZ position). Those controls are
 * ephemeral until the user hits SAVE — the save writes the current
 * snapshot into `localStorage` under the *active environment* so each
 * of default / smoke / dim can carry its own lighting rig.
 *
 * A RESET action clears the stored values for the current env and
 * restores the hard-coded baseline below. Unsaved edits don't
 * survive env switches (switching envs always loads that env's
 * stored rig, or the baseline if nothing is stored) — this is
 * deliberate so users don't accidentally lose work by clicking a
 * dropdown.
 *
 * Keyed in localStorage as `calyx:lighting:<env>`. JSON-encoded.
 * Missing / malformed blobs silently fall back to defaults so a
 * future schema change can't brick the UI.
 */

import type { SceneEnvironment } from "./types";

type Vec3 = { x: number; y: number; z: number };

/** Every value the Leva `Lighting` folder controls. Position uses
 *  Leva's `{x, y, z}` vector shape so the stored blob is a direct
 *  image of the Leva `values` subset — we can drop it straight into
 *  `setLeva(stored)` without any field mapping.
 *
 *  The original SavedLighting only covered ambient + HDRI + spotlights
 *  (the controls the UI shipped with on day 1). Later additions — tone
 *  mapping, background, fog, shadows, directional / point / rect-area
 *  lights — are listed here with optional `?` markers so old stored
 *  blobs still parse cleanly; `loadLightingForEnv` merges them over
 *  `LIGHTING_DEFAULTS` so every field always has a value at use time. */
export type SavedLighting = {
  ambientIntensity: number;
  ambientColor?: string;
  envIntensity: number;

  /* HDRI preset + tone mapping */
  lighting?: string;
  toneMappingCurve?: string;
  toneMappingExposure?: number;

  /* Background */
  backgroundMode?: string;
  backgroundColor1?: string;
  backgroundColor2?: string;
  backgroundAngle?: number;

  /* Fog */
  fogEnabled?: boolean;
  fogColor?: string;
  fogNear?: number;
  fogFar?: number;

  /* Shadows */
  shadowsEnabled?: boolean;
  shadowGround?: boolean;
  shadowOpacity?: number;
  shadowMapSize?: number;
  shadowRadius?: number;

  /* Directional lights */
  dirCount?: number;
  dir1Color?: string; dir1Intensity?: number; dir1Pos?: Vec3;
  dir2Color?: string; dir2Intensity?: number; dir2Pos?: Vec3;

  /* Spotlights (original) */
  spotCount: number;
  spot1Color: string; spot1Intensity: number; spot1Pos: Vec3;
  spot2Color: string; spot2Intensity: number; spot2Pos: Vec3;
  spot3Color: string; spot3Intensity: number; spot3Pos: Vec3;
  spot4Color: string; spot4Intensity: number; spot4Pos: Vec3;

  /* Point lights */
  pointCount?: number;
  point1Color?: string; point1Intensity?: number; point1Pos?: Vec3;
  point2Color?: string; point2Intensity?: number; point2Pos?: Vec3;
  point3Color?: string; point3Intensity?: number; point3Pos?: Vec3;
  point4Color?: string; point4Intensity?: number; point4Pos?: Vec3;

  /* Rect area lights */
  rectCount?: number;
  rectBothSides?: boolean;
  rect1Color?: string; rect1Intensity?: number; rect1Width?: number; rect1Height?: number; rect1X?: number; rect1Y?: number; rect1Z?: number;
  rect2Color?: string; rect2Intensity?: number; rect2Width?: number; rect2Height?: number; rect2X?: number; rect2Y?: number; rect2Z?: number;
  rect3Color?: string; rect3Intensity?: number; rect3Width?: number; rect3Height?: number; rect3X?: number; rect3Y?: number; rect3Z?: number;
  rect4Color?: string; rect4Intensity?: number; rect4Width?: number; rect4Height?: number; rect4X?: number; rect4Y?: number; rect4Z?: number;
};

/** The baseline rig every Reset snaps back to, and the fallback used
 *  when no stored values exist for the active environment. These
 *  mirror the `value:` fields inside the Leva Lighting folder so the
 *  two are guaranteed to agree on fresh mount. */
export const LIGHTING_DEFAULTS: SavedLighting = {
  ambientIntensity: 0.45,
  envIntensity: 1.0,
  spotCount: 0,

  spot1Color: "#ffffff",
  spot1Intensity: 30,
  spot1Pos: { x: -2.5, y: 2.5, z: 3.0 },

  spot2Color: "#ffd7a8",
  spot2Intensity: 30,
  spot2Pos: { x: 2.5, y: 2.5, z: 3.0 },

  spot3Color: "#a8c9ff",
  spot3Intensity: 20,
  spot3Pos: { x: 0, y: 1.0, z: -3.0 },

  spot4Color: "#ffffff",
  spot4Intensity: 20,
  spot4Pos: { x: 0, y: 4.0, z: 0 },
};

const STORAGE_KEY = (env: SceneEnvironment) => `calyx:lighting:${env}`;

/** Load stored lighting for the given environment.
 *  Returns null when nothing is stored OR when the stored blob fails
 *  to parse. The caller should substitute LIGHTING_DEFAULTS in the
 *  null case rather than try to recover partial data. */
export function loadLightingForEnv(
  env: SceneEnvironment
): SavedLighting | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY(env));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SavedLighting>;
    // Merge over defaults so a future added field doesn't blow up old
    // stored blobs — missing fields just take the current baseline.
    return { ...LIGHTING_DEFAULTS, ...parsed };
  } catch {
    return null;
  }
}

/** Persist the current lighting rig for the given environment. */
export function saveLightingForEnv(
  env: SceneEnvironment,
  cfg: SavedLighting
): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY(env), JSON.stringify(cfg));
  } catch {
    // Storage quota exceeded, private-mode restrictions, etc. — not
    // worth throwing; the user's live Leva values are unaffected.
  }
}

/** Clear any stored lighting for the given environment so a subsequent
 *  load falls back to LIGHTING_DEFAULTS. Used by the RESET action. */
export function clearLightingForEnv(env: SceneEnvironment): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_KEY(env));
  } catch {
    // Same failure modes as save — safe to swallow.
  }
}
