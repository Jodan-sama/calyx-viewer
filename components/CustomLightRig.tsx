"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { RectAreaLightUniformsLib } from "three/examples/jsm/lights/RectAreaLightUniformsLib.js";
import type { BagMaterial } from "@/lib/bagMaterial";

/**
 * A <rectAreaLight> that aims itself at the world origin every time
 * its position prop changes. Mirror of the helper in BagViewer — kept
 * here so the Outreach playback viewers can render the same rig
 * without pulling in BagViewer's entire surface area.
 */
export function AimedRectAreaLight({
  position,
  color,
  intensity,
  width,
  height,
}: {
  position: [number, number, number];
  color: string;
  intensity: number;
  width: number;
  height: number;
}) {
  const lightRef = useRef<THREE.RectAreaLight>(null);
  useEffect(() => {
    if (lightRef.current) lightRef.current.lookAt(0, 0, 0);
  }, [position]);
  return (
    <rectAreaLight
      ref={lightRef}
      position={position}
      color={color}
      intensity={intensity}
      width={width}
      height={height}
    />
  );
}

const TONE_MAPPING_MAP: Record<string, THREE.ToneMapping> = {
  aces: THREE.ACESFilmicToneMapping,
  agx: THREE.AgXToneMapping,
  cineon: THREE.CineonToneMapping,
  reinhard: THREE.ReinhardToneMapping,
  linear: THREE.LinearToneMapping,
  none: THREE.NoToneMapping,
};

export function resolveToneMapping(
  curve: string | undefined
): THREE.ToneMapping {
  return TONE_MAPPING_MAP[curve ?? "aces"] ?? THREE.ACESFilmicToneMapping;
}

/** Sentinel for "this slot was saved with the full lighting rig". The
 *  rectCount field is emitted unconditionally by BagViewer from the
 *  moment full-rig persistence shipped, so its presence cleanly
 *  distinguishes post-rig saves from legacy material-only saves. */
export function hasCustomRig(mat: BagMaterial | null | undefined): boolean {
  return mat?.rectCount !== undefined;
}

/** Resolve the wrapper-div background CSS for a saved slot — mirrors
 *  BagViewer.wrapperBackground. "transparent" returns "" so the page
 *  background shows through; "gradient" produces a CSS linear-gradient
 *  with the saved angle + colors; "flat" (and default) returns a flat
 *  colour. Callers pass this straight to a wrapper `style.background`. */
export function resolveWrapperBackground(
  mat: BagMaterial | null | undefined
): string {
  const mode = mat?.backgroundMode ?? "flat";
  if (mode === "transparent") return "transparent";
  if (mode === "gradient") {
    return `linear-gradient(${mat?.backgroundAngle ?? 180}deg, ${
      mat?.backgroundColor1 ?? "#eef1f8"
    }, ${mat?.backgroundColor2 ?? "#c4cdd8"})`;
  }
  return mat?.backgroundColor1 ?? "#eef1f8";
}

/**
 * Renders the full directional / spotlight / point / rect-area light
 * rig saved into a slot's material JSON. Used by both Outreach playback
 * viewers so the live 3D preview matches the user's studio setup.
 *
 * Each light family is gated on its `<family>Count` slider — counts of
 * zero render nothing, avoiding the GPU cost of unused light uniforms.
 * Rect-area lights optionally get a mirror twin on the opposite Z so
 * the back of the bag catches the same illumination.
 *
 * NOTE: ambient light is rendered by the parent wrapper (not here)
 * because the Outreach viewers conditionally render their own ambient
 * for non-rave scenes; we avoid stacking two ambients.
 */
export function CustomLightRig({ mat }: { mat: BagMaterial }) {
  // RectAreaLight needs a one-time uniforms-library init before GPU
  // use. Safe to call repeatedly; three.js guards internally.
  useEffect(() => {
    RectAreaLightUniformsLib.init();
  }, []);

  const dirCount = mat.dirCount ?? 0;
  const spotCount = mat.spotCount ?? 0;
  const pointCount = mat.pointCount ?? 0;
  const rectCount = mat.rectCount ?? 0;
  const rectBothSides = mat.rectBothSides ?? true;

  return (
    <>
      {/* Directional */}
      {dirCount >= 1 && mat.dir1Pos && (
        <directionalLight
          position={[mat.dir1Pos.x, mat.dir1Pos.y, mat.dir1Pos.z]}
          intensity={mat.dir1Intensity ?? 2}
          color={mat.dir1Color ?? "#ffffff"}
        />
      )}
      {dirCount >= 2 && mat.dir2Pos && (
        <directionalLight
          position={[mat.dir2Pos.x, mat.dir2Pos.y, mat.dir2Pos.z]}
          intensity={mat.dir2Intensity ?? 1}
          color={mat.dir2Color ?? "#e8d8ff"}
        />
      )}

      {/* Spotlights */}
      {spotCount >= 1 && mat.spot1Pos && (
        <spotLight
          position={[mat.spot1Pos.x, mat.spot1Pos.y, mat.spot1Pos.z]}
          intensity={mat.spot1Intensity ?? 30}
          color={mat.spot1Color ?? "#ffffff"}
          angle={0.5}
          penumbra={0.8}
          distance={14}
          decay={2}
        />
      )}
      {spotCount >= 2 && mat.spot2Pos && (
        <spotLight
          position={[mat.spot2Pos.x, mat.spot2Pos.y, mat.spot2Pos.z]}
          intensity={mat.spot2Intensity ?? 30}
          color={mat.spot2Color ?? "#ffd7a8"}
          angle={0.5}
          penumbra={0.8}
          distance={14}
          decay={2}
        />
      )}
      {spotCount >= 3 && mat.spot3Pos && (
        <spotLight
          position={[mat.spot3Pos.x, mat.spot3Pos.y, mat.spot3Pos.z]}
          intensity={mat.spot3Intensity ?? 20}
          color={mat.spot3Color ?? "#a8c9ff"}
          angle={0.5}
          penumbra={0.8}
          distance={14}
          decay={2}
        />
      )}
      {spotCount >= 4 && mat.spot4Pos && (
        <spotLight
          position={[mat.spot4Pos.x, mat.spot4Pos.y, mat.spot4Pos.z]}
          intensity={mat.spot4Intensity ?? 20}
          color={mat.spot4Color ?? "#ffffff"}
          angle={0.5}
          penumbra={0.8}
          distance={14}
          decay={2}
        />
      )}

      {/* Point lights */}
      {pointCount >= 1 && mat.point1Pos && (
        <pointLight
          position={[mat.point1Pos.x, mat.point1Pos.y, mat.point1Pos.z]}
          intensity={mat.point1Intensity ?? 20}
          color={mat.point1Color ?? "#ffffff"}
          distance={14}
          decay={2}
        />
      )}
      {pointCount >= 2 && mat.point2Pos && (
        <pointLight
          position={[mat.point2Pos.x, mat.point2Pos.y, mat.point2Pos.z]}
          intensity={mat.point2Intensity ?? 20}
          color={mat.point2Color ?? "#ffaa88"}
          distance={14}
          decay={2}
        />
      )}
      {pointCount >= 3 && mat.point3Pos && (
        <pointLight
          position={[mat.point3Pos.x, mat.point3Pos.y, mat.point3Pos.z]}
          intensity={mat.point3Intensity ?? 20}
          color={mat.point3Color ?? "#88aaff"}
          distance={14}
          decay={2}
        />
      )}
      {pointCount >= 4 && mat.point4Pos && (
        <pointLight
          position={[mat.point4Pos.x, mat.point4Pos.y, mat.point4Pos.z]}
          intensity={mat.point4Intensity ?? 20}
          color={mat.point4Color ?? "#ffffff"}
          distance={14}
          decay={2}
        />
      )}

      {/* Rect-area lights — each optionally gets a mirror twin at -Z. */}
      {rectCount >= 1 && (
        <AimedRectAreaLight
          position={[mat.rect1X ?? -2, mat.rect1Y ?? 0, mat.rect1Z ?? 3]}
          color={mat.rect1Color ?? "#ffffff"}
          intensity={mat.rect1Intensity ?? 12}
          width={mat.rect1Width ?? 2}
          height={mat.rect1Height ?? 2}
        />
      )}
      {rectCount >= 2 && (
        <AimedRectAreaLight
          position={[mat.rect2X ?? 2, mat.rect2Y ?? 0, mat.rect2Z ?? 3]}
          color={mat.rect2Color ?? "#fff2d8"}
          intensity={mat.rect2Intensity ?? 10}
          width={mat.rect2Width ?? 2}
          height={mat.rect2Height ?? 2}
        />
      )}
      {rectCount >= 3 && (
        <AimedRectAreaLight
          position={[mat.rect3X ?? 0, mat.rect3Y ?? -3, mat.rect3Z ?? 2]}
          color={mat.rect3Color ?? "#d8e8ff"}
          intensity={mat.rect3Intensity ?? 8}
          width={mat.rect3Width ?? 2}
          height={mat.rect3Height ?? 2}
        />
      )}
      {rectCount >= 4 && (
        <AimedRectAreaLight
          position={[mat.rect4X ?? 0, mat.rect4Y ?? 3, mat.rect4Z ?? 4]}
          color={mat.rect4Color ?? "#ffffff"}
          intensity={mat.rect4Intensity ?? 6}
          width={mat.rect4Width ?? 2}
          height={mat.rect4Height ?? 2}
        />
      )}

      {/* Mirrored twins at z = -z so the back panel catches the same lighting. */}
      {rectBothSides && rectCount >= 1 && (
        <AimedRectAreaLight
          position={[mat.rect1X ?? -2, mat.rect1Y ?? 0, -(mat.rect1Z ?? 3)]}
          color={mat.rect1Color ?? "#ffffff"}
          intensity={mat.rect1Intensity ?? 12}
          width={mat.rect1Width ?? 2}
          height={mat.rect1Height ?? 2}
        />
      )}
      {rectBothSides && rectCount >= 2 && (
        <AimedRectAreaLight
          position={[mat.rect2X ?? 2, mat.rect2Y ?? 0, -(mat.rect2Z ?? 3)]}
          color={mat.rect2Color ?? "#fff2d8"}
          intensity={mat.rect2Intensity ?? 10}
          width={mat.rect2Width ?? 2}
          height={mat.rect2Height ?? 2}
        />
      )}
      {rectBothSides && rectCount >= 3 && (
        <AimedRectAreaLight
          position={[mat.rect3X ?? 0, mat.rect3Y ?? -3, -(mat.rect3Z ?? 2)]}
          color={mat.rect3Color ?? "#d8e8ff"}
          intensity={mat.rect3Intensity ?? 8}
          width={mat.rect3Width ?? 2}
          height={mat.rect3Height ?? 2}
        />
      )}
      {rectBothSides && rectCount >= 4 && (
        <AimedRectAreaLight
          position={[mat.rect4X ?? 0, mat.rect4Y ?? 3, -(mat.rect4Z ?? 4)]}
          color={mat.rect4Color ?? "#ffffff"}
          intensity={mat.rect4Intensity ?? 6}
          width={mat.rect4Width ?? 2}
          height={mat.rect4Height ?? 2}
        />
      )}
    </>
  );
}
