"use client";

import { Suspense, useRef, useEffect, useMemo } from "react";
import { Canvas, useThree, useFrame } from "@react-three/fiber";
import {
  OrbitControls,
  Environment,
  ContactShadows,
  Cloud,
  Clouds,
  MeshReflectorMaterial,
} from "@react-three/drei";
import { useControls, folder, button, useCreateStore } from "leva";
// Leva doesn't re-export its internal StoreType, so we reconstruct
// it from the return type of `useCreateStore` — the same shape the
// hook hands back to the page for each sidebar's store.
type LevaStore = ReturnType<typeof useCreateStore>;
import { RectAreaLightUniformsLib } from "three/examples/jsm/lights/RectAreaLightUniformsLib.js";
import * as THREE from "three";
import BagMesh from "./BagMesh";
import SupplementJarMesh from "./SupplementJarMesh";
import {
  DEFAULT_BACK_TEXTURE,
  DEFAULT_FRONT_TEXTURE,
  FINISH_PRESETS,
  resolveEnvironmentPreset,
  type BagFinish,
  type BagLighting,
  type BagMaterial,
} from "@/lib/bagMaterial";
import {
  loadLightingForEnv,
  saveLightingForEnv,
  clearLightingForEnv,
  LIGHTING_DEFAULTS,
  type SavedLighting,
} from "@/lib/lightingPrefs";
import type { SceneEnvironment } from "@/lib/types";

// ── Auto-aimed rect area light ──────────────────────────────────────────────
// A <rectAreaLight> that aims itself at the world origin (where the bag
// sits) every frame. RectAreaLight by default emits along its local +Y
// axis; without aiming it would point "up" and miss the bag entirely.
// We aim once on mount + again whenever the position prop changes so
// dragging the light around the top-down map updates the aim too.
function AimedRectAreaLight({
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
    if (lightRef.current) {
      lightRef.current.lookAt(0, 0, 0);
    }
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

// Map Leva's curve string to the actual three.js tone mapping constant.
// Kept outside the component so it isn't re-created on every render.
const TONE_MAPPING_MAP: Record<string, THREE.ToneMapping> = {
  aces: THREE.ACESFilmicToneMapping,
  agx: THREE.AgXToneMapping,
  cineon: THREE.CineonToneMapping,
  reinhard: THREE.ReinhardToneMapping,
  linear: THREE.LinearToneMapping,
  none: THREE.NoToneMapping,
};

// ── Screenshot helper — auto-captures on load + exposes manual trigger ────────
/**
 * Background kinds the capture knows how to paint. "transparent" is a
 * sentinel meaning "skip the background layer" so the page underneath
 * reads through alpha in the thumbnail, matching the wrapper-div
 * behaviour in the live viewer.
 */
interface CaptureBackground {
  mode: "flat" | "gradient" | "transparent";
  color1: string;
  color2: string;
  /** CSS gradient angle (0° = toward top), matched to Leva's 0–360 slider. */
  angle: number;
}

/** Composite the WebGL canvas onto a 2D canvas pre-painted with the
 *  same background the wrapper DIV would have shown, then emit a PNG
 *  data URL. The live viewer paints its gradient / flat colour on the
 *  DOM wrapper rather than in three.js, so `gl.domElement.toDataURL()`
 *  alone would produce a transparent-backed thumbnail — gradients and
 *  flat backgrounds would silently disappear from the saved preview.
 *
 *  Matches CSS `linear-gradient(Xdeg, c1, c2)` geometry: 0° puts c1 at
 *  bottom and c2 at top, 90° runs left→right, etc. The gradient line
 *  is scaled so both endpoint colours fully cover the nearest edges of
 *  the rectangle regardless of aspect ratio.
 */
function paintCapture(
  webgl: HTMLCanvasElement,
  bg: CaptureBackground
): string {
  const composite = document.createElement("canvas");
  composite.width = webgl.width;
  composite.height = webgl.height;
  const ctx = composite.getContext("2d");
  if (!ctx) return webgl.toDataURL("image/png");

  if (bg.mode === "flat") {
    ctx.fillStyle = bg.color1;
    ctx.fillRect(0, 0, composite.width, composite.height);
  } else if (bg.mode === "gradient") {
    // CSS 0deg = up, screen coords have y pointing down, so the
    // direction vector toward the target is (sin θ, -cos θ). Half-
    // extent along that axis equals |dx|*w/2 + |dy|*h/2, which keeps
    // the gradient line long enough to cover the rectangle's corners.
    const rad = (bg.angle * Math.PI) / 180;
    const dx = Math.sin(rad);
    const dy = -Math.cos(rad);
    const w = composite.width;
    const h = composite.height;
    const cx = w / 2;
    const cy = h / 2;
    const len = Math.abs(dx) * (w / 2) + Math.abs(dy) * (h / 2);
    const grad = ctx.createLinearGradient(
      cx - dx * len,
      cy - dy * len,
      cx + dx * len,
      cy + dy * len
    );
    grad.addColorStop(0, bg.color1);
    grad.addColorStop(1, bg.color2);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
  }
  // "transparent" → leave the composite's own transparent background.

  ctx.drawImage(webgl, 0, 0);
  return composite.toDataURL("image/png");
}

function ScreenshotCapture({
  onCapture,
  resetKey,
  captureRef,
  background,
}: {
  onCapture: (url: string) => void;
  resetKey: string;
  /** Imperative capture trigger. Returns the freshly-captured data URL
   *  so callers can grab the newest frame synchronously without waiting
   *  for the React `onCapture` state update to flush. */
  captureRef?: React.MutableRefObject<(() => string | null) | null>;
  /** Same background the wrapper DIV is currently painting. The capture
   *  composites this under the WebGL bytes so the saved thumbnail
   *  includes gradients / flat colours that would otherwise be lost to
   *  canvas alpha. */
  background: CaptureBackground;
}) {
  const { gl } = useThree();
  const done = useRef(false);
  const frameCount = useRef(0);

  // Ref mirror so the useFrame callback always reads the freshest
  // background without needing to be recreated every time a Leva
  // slider nudges. Writing through the ref keeps the RAF hot path free
  // of re-allocation while still picking up live updates.
  const bgRef = useRef(background);
  bgRef.current = background;

  // Expose an imperative capture function. The return value lets the
  // caller read the data URL in the same tick that the click was
  // received — critical for the Save-to-Outreach flow where we pass
  // the URL into a state update on the very next line.
  useEffect(() => {
    if (captureRef) {
      captureRef.current = () => {
        const url = paintCapture(gl.domElement, bgRef.current);
        onCapture(url);
        return url;
      };
    }
  }, [gl, captureRef, onCapture]);

  // Reset auto-capture counter when texture changes
  useEffect(() => {
    done.current = false;
    frameCount.current = 0;
  }, [resetKey]);

  useFrame(() => {
    if (done.current) return;
    frameCount.current++;
    if (frameCount.current >= 90) {
      done.current = true;
      const url = paintCapture(gl.domElement, bgRef.current);
      onCapture(url);
    }
  });

  return null;
}

// ── Rave lighting ─────────────────────────────────────────────────────────────
function RaveLights() {
  return (
    <>
      {/* Magenta key — very close, upper-left */}
      <pointLight position={[-1.5, 1.5, 2.5]} intensity={60} color="#ff00cc" distance={15} decay={2} />
      {/* Cyan fill — right side, close */}
      <pointLight position={[2, 0, 2.5]} intensity={45} color="#00ffee" distance={15} decay={2} />
      {/* Purple rim from behind */}
      <pointLight position={[0, 0.5, -2.5]} intensity={35} color="#aa00ff" distance={15} decay={2} />
      {/* Hot pink top */}
      <pointLight position={[0, 3, 1.5]} intensity={30} color="#ff44aa" distance={15} decay={2} />
      {/* Green from bottom-right — matches the cyan placement on the other side */}
      <pointLight position={[2, -1.4, 2]} intensity={42} color="#22ff66" distance={15} decay={2} />
      {/* Very dim ambient */}
      <ambientLight intensity={0.05} color="#ffffff" />
    </>
  );
}

// ── UV Blacklight rig ────────────────────────────────────────────────────────
// Two violet point lights flanking the bag from above — simulating tube-
// style blacklight fixtures in a club — plus a deep-purple ambient so
// non-fluorescent surfaces read as near-black rather than pure black.
// Fluorescent pigment response is rendered in the meshes' materials
// (emissive = UV_GLOW_COLOR) rather than via shader tricks, so the
// scene just needs to provide a convincing dark-purple environment.
function UVLights() {
  return (
    <>
      {/* Dim violet key lights — only present to give the bag silhouette
          enough subtle violet wash to read at all. Kept low so the
          fluorescent layers' emissive (UV_GLOW_COLOR) dominates
          every pixel that should glow, rather than competing with
          a well-lit diffuse base. */}
      <pointLight position={[-2, 2.5, 1.5]} intensity={8} color="#6a00ff" distance={12} decay={2} />
      <pointLight position={[2, 2.5, 1.5]} intensity={8} color="#6a00ff" distance={12} decay={2} />
      <pointLight position={[0, 1.8, -2.5]} intensity={5} color="#aa33ff" distance={10} decay={2} />
      <ambientLight intensity={0.02} color="#2a1155" />
    </>
  );
}

// ── Smoke + reflective floor scene ────────────────────────────────────────────
// Slowly-drifting white smoke clouds behind the bag, lit from behind so the
// volume reads against the light background, plus a light, mildly reflective
// floor. Swapped in when the user picks Environment → Smoke.
function SmokeBackground() {
  const cloudsRef = useRef<THREE.Group>(null);
  useFrame((_, delta) => {
    if (cloudsRef.current) {
      cloudsRef.current.rotation.y += delta * 0.03;
    }
  });
  return (
    <group ref={cloudsRef} position={[0, 0.2, -1.8]}>
      <Clouds limit={200} material={THREE.MeshBasicMaterial}>
        <Cloud
          segments={40}
          bounds={[5, 1.2, 2]}
          volume={3}
          color="#c8ccd6"
          opacity={0.6}
          fade={40}
          position={[-1.6, 0.2, 0]}
        />
        <Cloud
          segments={30}
          bounds={[4, 1.0, 2]}
          volume={2.4}
          color="#b4b8c4"
          opacity={0.55}
          fade={40}
          position={[1.8, 0.6, -0.4]}
        />
        <Cloud
          segments={28}
          bounds={[3, 0.9, 1.8]}
          volume={2.0}
          color="#9ea3b0"
          opacity={0.7}
          fade={40}
          position={[0, -0.6, 0.3]}
        />
        {/* Extra layer — further back and wider for added depth */}
        <Cloud
          segments={24}
          bounds={[6, 1.4, 2.5]}
          volume={2.6}
          color="#c0c4d0"
          opacity={0.35}
          fade={50}
          position={[0.4, 0.4, -1.8]}
        />
      </Clouds>
    </group>
  );
}

// Lighting for the smoke scene — backlights behind the clouds for volume +
// spotlights from the front/sides so the product catches strong highlights.
function SmokeLights() {
  return (
    <>
      {/* Backlights behind the smoke volume */}
      <pointLight position={[0, 0.8, -3.2]} intensity={28} color="#ffffff" distance={10} decay={2} />
      <pointLight position={[-1.6, 0.4, -2.6]} intensity={14} color="#e8ecf8" distance={8} decay={2} />
      <pointLight position={[1.6, 0.4, -2.6]} intensity={14} color="#f3ecf8" distance={8} decay={2} />

      {/* Front spotlights — illuminate the product and the near face of the smoke */}
      <spotLight position={[-2.5, 2.5, 3.5]} intensity={40} color="#ffffff" angle={0.5} penumbra={0.8} distance={14} decay={2} castShadow />
      <spotLight position={[2.5, 2.5, 3.5]} intensity={40} color="#ffffff" angle={0.5} penumbra={0.8} distance={14} decay={2} castShadow />

      {/* Top-down fill so the smoke doesn't go flat */}
      <spotLight position={[0, 4, 0]} intensity={20} color="#f0f2ff" angle={0.7} penumbra={1} distance={12} decay={2} />
    </>
  );
}

// ── Dim scene — dark moody environment with slowly-orbiting rainbow lights ──
// Six coloured point lights arranged in a ring around the product, grouped
// so the whole array rotates slowly. The base HDRI and ambient are pulled
// to 20% so the rainbow highlights are the dominant light source; the dark
// shell and floor complete the nightclub / display-case mood.
function RainbowLights() {
  const groupRef = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (groupRef.current) {
      groupRef.current.rotation.y = clock.elapsedTime * 0.15;
    }
  });
  return (
    <group ref={groupRef}>
      <pointLight position={[-2.5, 2.0, 1.5]} intensity={18} color="#ff2244" distance={12} decay={2} />
      <pointLight position={[2.5, 0.5, 2.0]} intensity={16} color="#ff8800" distance={12} decay={2} />
      <pointLight position={[0, 1.8, -2.5]} intensity={14} color="#ffdd00" distance={12} decay={2} />
      <pointLight position={[-2.0, 2.5, -1.5]} intensity={16} color="#22ff44" distance={12} decay={2} />
      <pointLight position={[2.0, -0.5, 1.0]} intensity={18} color="#2244ff" distance={12} decay={2} />
      <pointLight position={[1.5, 2.5, -2.0]} intensity={14} color="#aa22ff" distance={12} decay={2} />
    </group>
  );
}


// High-gloss mirror floor used in the Smoke scene. Tuned for a strong,
// clearly-readable cast reflection that picks up the object's colours and
// highlights rather than diffusing them into a soft haze: low roughness
// (0.05) for sharp specular, tight blur + low mixBlur so detail survives,
// and higher mixStrength to pull the reflection above the floor tint.
//
// Y position sits right at the bag's bottom so the package appears to stand on
// the plane — tight placement is what gives the base of the bag a clean cast
// reflection rather than a pool of reflection with a floating gap.
function ReflectiveFloor() {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -1.265, 0]} receiveShadow>
      <planeGeometry args={[40, 40]} />
      <MeshReflectorMaterial
        blur={[35, 12]}
        resolution={2048}
        mixBlur={0.25}
        mixStrength={12.0}
        roughness={0.05}
        depthScale={0.6}
        minDepthThreshold={0.2}
        maxDepthThreshold={1.4}
        color="#eef1f8"
        metalness={0.9}
        mirror={1}
      />
    </mesh>
  );
}

interface BagViewerProps {
  textureUrl: string | null;
  /** Back-panel artwork. Null → no back decal. */
  backTextureUrl?: string | null;
  /** Optional Layer 3 front artwork (bag mode). Null → no Layer 3 front. */
  layer3FrontTextureUrl?: string | null;
  /** Optional Layer 3 back artwork (bag mode). Null → no Layer 3 back. */
  layer3BackTextureUrl?: string | null;
  /** Source image for the Mosaic finish. Null → mosaic layers fall back
   *  to the mylar variant until the user uploads a source. */
  mosaicSourceUrl?: string | null;
  onScreenshot?: (url: string) => void;
  captureRef?: React.MutableRefObject<(() => string | null) | null>;
  onMaterialChange?: (material: BagMaterial) => void;
  /** Called when the user flips the Model dropdown between bag/jar so the
   *  parent page can re-label upload buttons etc. */
  onModelChange?: (model: "bag" | "jar") => void;
  /** Called when the user changes the Environment dropdown (default/smoke/dim)
   *  so the parent can include the current environment in saves. */
  onEnvironmentChange?: (env: "default" | "smoke" | "dim") => void;
  /** Optional Leva-defaults seed. Used when the page hydrates from a saved
   *  Outreach slot (Calyx Preview opened via `?open=<id>`) — the material,
   *  environment, and model fields pre-populate the Leva controls so the
   *  viewer boots in the same state the user saw at save time.
   *
   *  Leva only reads field `value` on first mount, so the parent must force
   *  a remount (via a `key` that changes once hydration completes) for
   *  these to take effect. Pass `undefined` to use the regular defaults. */
  initialMaterial?: BagMaterial;
  initialEnvironment?: "default" | "smoke" | "dim";
  initialModel?: "bag" | "jar";
  /** Leva stores created by the parent page — one per docked sidebar.
   *  Material + layer controls route to `matStore`; every scene /
   *  environment / lighting knob routes to `lightStore` so each
   *  sidebar can be collapsed independently. When omitted (e.g. the
   *  landing-page preview card) Leva falls back to its global store
   *  and the existing single-panel behaviour is preserved. */
  matStore?: LevaStore;
  lightStore?: LevaStore;
  /** Caller-owned ref populated on every render with save/reset
   *  handlers for the *active* environment. Used by the page to
   *  render the Save / Reset Lighting buttons outside the Leva panel
   *  (in the Lighting sidebar footer) — they couldn't live inside
   *  Leva because Leva's render order can't guarantee they sit
   *  beneath the last conditionally-visible rect-light slider. */
  lightingOpsRef?: React.MutableRefObject<{
    save: () => void;
    reset: () => void;
  } | null>;
}

export default function BagViewer({
  textureUrl,
  backTextureUrl = null,
  layer3FrontTextureUrl = null,
  layer3BackTextureUrl = null,
  mosaicSourceUrl = null,
  onScreenshot,
  captureRef,
  onMaterialChange,
  onModelChange,
  onEnvironmentChange,
  initialMaterial,
  initialEnvironment,
  initialModel,
  matStore,
  lightStore,
  lightingOpsRef: externalLightingOpsRef,
}: BagViewerProps) {
  // RectAreaLight support needs a one-time uniforms-library init. Safe to
  // call repeatedly; three.js guards against double-init internally.
  useEffect(() => {
    RectAreaLightUniformsLib.init();
  }, []);
  // Resolved initial values for the Leva schema below. Consulted once at
  // mount — if the page supplies an initialMaterial (e.g. opened from an
  // Outreach slot), these prefill the controls; otherwise the hard-coded
  // defaults take over. Parent forces a remount via a `key` prop when
  // hydration data arrives, so changing initial* mid-session works.
  const iMat = initialMaterial;
  const iEnv = initialEnvironment ?? "default";
  const iModel = initialModel ?? "bag";

  // Mosaic: the Leva "Re-randomize" button needs a stable callback
  // identity (Leva captures `onClick` at schema-build time). We route
  // through a ref that's refreshed every render so the button always
  // calls into the latest setLeva reference. Mirrors the pattern used
  // for Save/Reset Lighting.
  const mosaicOpsRef = useRef<{ reroll: () => void }>({ reroll: () => {} });

  // One-shot random seed for each per-layer crop. Consulted only when the
  // saved material doesn't already carry an offset, so reopening an
  // existing slot preserves the crop the user last saved. `Math.random()`
  // is safe here because BagViewer is SSR-disabled (dynamic import).
  const iMosaic = useMemo(() => {
    // Each reroll flips a coin for flipX/flipY (aspect-preserving variety)
    // and picks a random angle for mirror-mode rotation. Rotation only
    // affects mirror mode on the jar — the baked label-aspect canvas is
    // immune to aspect distortion, so rotation there is purely a crop-
    // angle dial (HP Hyper-Customisation style).
    const flip = () => Math.random() < 0.5;
    const angle = () => Math.random() * Math.PI * 2;
    return {
      mosaicZoom: iMat?.mosaicZoom ?? 0.5,
      mosaicMirror: iMat?.mosaicMirror ?? false,
      mosaicOffsetU: iMat?.mosaicOffsetU ?? Math.random(),
      mosaicOffsetV: iMat?.mosaicOffsetV ?? Math.random(),
      mosaicFlipX: iMat?.mosaicFlipX ?? flip(),
      mosaicFlipY: iMat?.mosaicFlipY ?? flip(),
      mosaicMirrorRotation: iMat?.mosaicMirrorRotation ?? angle(),
      labelMosaicOffsetU: iMat?.labelMosaicOffsetU ?? Math.random(),
      labelMosaicOffsetV: iMat?.labelMosaicOffsetV ?? Math.random(),
      labelMosaicFlipX: iMat?.labelMosaicFlipX ?? flip(),
      labelMosaicFlipY: iMat?.labelMosaicFlipY ?? flip(),
      labelMosaicMirrorRotation: iMat?.labelMosaicMirrorRotation ?? angle(),
      layer2MosaicOffsetU: iMat?.layer2MosaicOffsetU ?? Math.random(),
      layer2MosaicOffsetV: iMat?.layer2MosaicOffsetV ?? Math.random(),
      layer2MosaicFlipX: iMat?.layer2MosaicFlipX ?? flip(),
      layer2MosaicFlipY: iMat?.layer2MosaicFlipY ?? flip(),
      layer2MosaicMirrorRotation: iMat?.layer2MosaicMirrorRotation ?? angle(),
      layer3MosaicOffsetU: iMat?.layer3MosaicOffsetU ?? Math.random(),
      layer3MosaicOffsetV: iMat?.layer3MosaicOffsetV ?? Math.random(),
      layer3MosaicFlipX: iMat?.layer3MosaicFlipX ?? flip(),
      layer3MosaicFlipY: iMat?.layer3MosaicFlipY ?? flip(),
      layer3MosaicMirrorRotation: iMat?.layer3MosaicMirrorRotation ?? angle(),
    };
  }, [iMat]);

  // Seed the Lighting folder from whatever rig is stored for the
  // initial environment — each env (default/smoke/dim) can carry its
  // own saved rig. Falls back to LIGHTING_DEFAULTS when nothing is
  // stored. Computed once at mount; subsequent env switches update
  // the live Leva state imperatively via setLeva (see useEffect on
  // environment below).
  const iLighting = useMemo<SavedLighting>(
    () => loadLightingForEnv(iEnv) ?? LIGHTING_DEFAULTS,
    [iEnv]
  );

  // Resolve every scene/lighting Leva default with a three-tier fallback:
  // (1) the saved slot's material JSON wins when the field is present
  // (slot-persisted, travels across browsers), (2) the localStorage
  // per-env rig fills gaps (fields that existed before full-slot
  // persistence shipped), (3) hardcoded defaults seed first-time users.
  // All Leva `value:` entries in the Lighting schema below read from
  // this memo so the reopen flow hydrates the full rig without us
  // threading 80+ individual iMat?.X ?? fallback chains through each
  // control definition.
  const iL = useMemo(() => ({
    lighting: iMat?.lighting ?? "studio",
    envIntensity: iMat?.envIntensity ?? iLighting.envIntensity,
    toneMappingCurve: iMat?.toneMappingCurve ?? "aces",
    toneMappingExposure: iMat?.toneMappingExposure ?? 1.4,
    backgroundMode: iMat?.backgroundMode ?? "flat",
    backgroundColor1: iMat?.backgroundColor1 ?? "#eef1f8",
    backgroundColor2: iMat?.backgroundColor2 ?? "#c4cdd8",
    backgroundAngle: iMat?.backgroundAngle ?? 180,
    fogEnabled: iMat?.fogEnabled ?? false,
    fogColor: iMat?.fogColor ?? "#cccccc",
    fogNear: iMat?.fogNear ?? 2,
    fogFar: iMat?.fogFar ?? 10,
    shadowsEnabled: iMat?.shadowsEnabled ?? false,
    shadowGround: iMat?.shadowGround ?? true,
    shadowOpacity: iMat?.shadowOpacity ?? 0.35,
    shadowMapSize: iMat?.shadowMapSize ?? 1024,
    shadowRadius: iMat?.shadowRadius ?? 4,
    ambientIntensity: iMat?.ambientIntensity ?? iLighting.ambientIntensity,
    ambientColor: iMat?.ambientColor ?? "#ffffff",
    dirCount: iMat?.dirCount ?? 0,
    dir1Color: iMat?.dir1Color ?? "#ffffff",
    dir1Intensity: iMat?.dir1Intensity ?? 2,
    dir1Pos: iMat?.dir1Pos ?? { x: 3, y: 5, z: 3 },
    dir2Color: iMat?.dir2Color ?? "#e8d8ff",
    dir2Intensity: iMat?.dir2Intensity ?? 1,
    dir2Pos: iMat?.dir2Pos ?? { x: -3, y: 5, z: -3 },
    spotCount: iMat?.spotCount ?? iLighting.spotCount,
    spot1Color: iMat?.spot1Color ?? iLighting.spot1Color,
    spot1Intensity: iMat?.spot1Intensity ?? iLighting.spot1Intensity,
    spot1Pos: iMat?.spot1Pos ?? iLighting.spot1Pos,
    spot2Color: iMat?.spot2Color ?? iLighting.spot2Color,
    spot2Intensity: iMat?.spot2Intensity ?? iLighting.spot2Intensity,
    spot2Pos: iMat?.spot2Pos ?? iLighting.spot2Pos,
    spot3Color: iMat?.spot3Color ?? iLighting.spot3Color,
    spot3Intensity: iMat?.spot3Intensity ?? iLighting.spot3Intensity,
    spot3Pos: iMat?.spot3Pos ?? iLighting.spot3Pos,
    spot4Color: iMat?.spot4Color ?? iLighting.spot4Color,
    spot4Intensity: iMat?.spot4Intensity ?? iLighting.spot4Intensity,
    spot4Pos: iMat?.spot4Pos ?? iLighting.spot4Pos,
    pointCount: iMat?.pointCount ?? 0,
    point1Color: iMat?.point1Color ?? "#ffffff",
    point1Intensity: iMat?.point1Intensity ?? 20,
    point1Pos: iMat?.point1Pos ?? { x: 2, y: 2, z: 2 },
    point2Color: iMat?.point2Color ?? "#ffaa88",
    point2Intensity: iMat?.point2Intensity ?? 20,
    point2Pos: iMat?.point2Pos ?? { x: -2, y: 2, z: 2 },
    point3Color: iMat?.point3Color ?? "#88aaff",
    point3Intensity: iMat?.point3Intensity ?? 20,
    point3Pos: iMat?.point3Pos ?? { x: 0, y: 2, z: -3 },
    point4Color: iMat?.point4Color ?? "#ffffff",
    point4Intensity: iMat?.point4Intensity ?? 20,
    point4Pos: iMat?.point4Pos ?? { x: 0, y: 3, z: 0 },
    rectCount: iMat?.rectCount ?? 0,
    rectBothSides: iMat?.rectBothSides ?? true,
    rect1Color: iMat?.rect1Color ?? "#ffffff",
    rect1Intensity: iMat?.rect1Intensity ?? 12,
    rect1Width: iMat?.rect1Width ?? 2,
    rect1Height: iMat?.rect1Height ?? 2,
    rect1X: iMat?.rect1X ?? -2,
    rect1Y: iMat?.rect1Y ?? 0,
    rect1Z: iMat?.rect1Z ?? 3,
    rect2Color: iMat?.rect2Color ?? "#fff2d8",
    rect2Intensity: iMat?.rect2Intensity ?? 10,
    rect2Width: iMat?.rect2Width ?? 2,
    rect2Height: iMat?.rect2Height ?? 2,
    rect2X: iMat?.rect2X ?? 2,
    rect2Y: iMat?.rect2Y ?? 0,
    rect2Z: iMat?.rect2Z ?? 3,
    rect3Color: iMat?.rect3Color ?? "#d8e8ff",
    rect3Intensity: iMat?.rect3Intensity ?? 8,
    rect3Width: iMat?.rect3Width ?? 2,
    rect3Height: iMat?.rect3Height ?? 2,
    rect3X: iMat?.rect3X ?? 0,
    rect3Y: iMat?.rect3Y ?? -3,
    rect3Z: iMat?.rect3Z ?? 2,
    rect4Color: iMat?.rect4Color ?? "#ffffff",
    rect4Intensity: iMat?.rect4Intensity ?? 6,
    rect4Width: iMat?.rect4Width ?? 2,
    rect4Height: iMat?.rect4Height ?? 2,
    rect4X: iMat?.rect4X ?? 0,
    rect4Y: iMat?.rect4Y ?? 3,
    rect4Z: iMat?.rect4Z ?? 4,
    autoRotate: iMat?.autoRotate ?? false,
  }), [iMat, iLighting]);

  // Handlers the Lighting folder's SAVE / RESET controls call into.
  // These need to close over setLeva and the current `environment`
  // (so SAVE goes to the *active* env, not the initial one). Leva's
  // button() helper captures handlers by reference at schema-build
  // time, so we route through refs and resolve the live values
  // inside — see `lightingOpsRef` below.
  const lightingOpsRef = useRef<{
    save: () => void;
    reset: () => void;
  }>({ save: () => {}, reset: () => {} });

  // Factory-form useControls so we get a setter. The factory itself
  // runs once on mount (empty deps) — we use `setLeva` imperatively
  // below to load saved rigs on env change and snap values back on
  // RESET. Destructured into the same flat names the rest of the
  // component already uses.
  const [values, setLeva] = useControls(() => ({
    Model: folder({
      model: {
        label: "Model",
        value: iModel,
        options: {
          "Mylar Bag": "bag",
          "Supplement Jar": "jar",
        },
      },
      // Every layer's controls are always visible now — no "active layer"
      // switcher. Bag-only and jar-only folders still self-hide based on
      // the Model dropdown above so the panel only shows knobs that can
      // actually affect the active model.
    }, { collapsed: false }),

    Surface: folder({
      // Layer 1 (base material). Always visible; custom metalness /
      // roughness only appear when Finish is set to Custom.
      finish: {
        label: "Finish",
        value: iMat?.finish ?? "metallic",
        options: {
          Metallic: "metallic",
          Matte: "matte",
          Gloss: "gloss",
          Satin: "satin",
          "Holographic Foil": "foil",
          "Prismatic Foil": "prismatic",
          "Multi-Chrome": "multi-chrome",
          Mosaic: "mosaic",
          Custom: "custom",
          // Diagnostic mode — renders every bag fragment coloured by
          // its world-space normal vector so you can tell by eye
          // whether a panel's normals point where they should. Pure
          // blue ≈ +Z out-of-front, pure yellow ≈ -Z out-of-back.
          // Mixed / swapped colours on a panel explain why direct
          // lights land unevenly.
          "Debug Normals": "debug-normals",
        },
      },
      bagColor: {
        label: "Bag Color", value: iMat?.bagColor ?? "#c4cdd8",
      },
      // Metalness/Roughness stay visible for every finish. Only Custom
      // and Mosaic actually consume these values (bagProps below routes
      // the preset's locked numbers in for every other finish), but
      // keeping them rendered unconditionally dodges a Leva folder-height
      // cache bug: conditionally mounting rows mid-session leaves the
      // folder's container frozen at its first-mount height, which made
      // Surface's content overlap Layer 2's header when Mosaic was
      // picked. A tiny UX cost (sliders that do nothing on presets) for
      // a clean layout in every finish mode.
      metalness: {
        label: "Metalness", value: iMat?.metalness ?? 0.92, min: 0, max: 1, step: 0.01,
      },
      roughness: {
        label: "Roughness", value: iMat?.roughness ?? 0.08, min: 0, max: 1, step: 0.01,
      },
    }, { collapsed: false }),

    "Layer 2": folder({
      // Bag-only Layer 2 decal tuning (artwork-mode metalness / roughness).
      // Jar uses its own `layer2*` sliders below so each model's settings
      // persist independently across model switches. Model-specific
      // conditionals remain (so jar controls stay hidden while editing a
      // bag and vice versa), but there is no longer an "active layer"
      // gate — Layer 2 controls are always present in the panel.
      labelMetalness: {
        label: "Metalness", value: iMat?.labelMetalness ?? 0.1, min: 0, max: 1, step: 0.01,
        render: (get) =>
          get("Model.model") === "bag" &&
          !get("Layer 2.labelVarnish") &&
          !get("Layer 2.labelTactile") &&
          !get("Layer 2.labelMaterial"),
      },
      labelRoughness: {
        label: "Roughness", value: iMat?.labelRoughness ?? 0.55, min: 0, max: 1, step: 0.01,
        render: (get) =>
          get("Model.model") === "bag" &&
          !get("Layer 2.labelVarnish") &&
          !get("Layer 2.labelTactile") &&
          !get("Layer 2.labelMaterial"),
      },
      labelVarnish: {
        label: "Varnish", value: iMat?.labelVarnish ?? false,
        render: (get) =>
          get("Model.model") === "bag" &&
          !get("Layer 2.labelTactile") &&
          !get("Layer 2.labelMaterial"),
      },
      labelTactile: {
        label: "Tactile", value: iMat?.labelTactile ?? false,
        render: (get) =>
          get("Model.model") === "bag" &&
          !get("Layer 2.labelVarnish") &&
          !get("Layer 2.labelMaterial"),
      },
      labelMaterial: {
        label: "Material", value: iMat?.labelMaterial ?? false,
        render: (get) =>
          get("Model.model") === "bag" &&
          !get("Layer 2.labelTactile"),
      },
      labelUV: {
        label: "UV Glow", value: iMat?.labelUV ?? false,
        render: (get) => get("Model.model") === "bag",
      },
      // Per-layer Material finish (bag Layer 2). Shown only when the
      // Material checkbox above is on — picks what substance the artwork
      // mask paints with, independently of Layer 1's finish.
      labelMatFinish: {
        label: "Layer Finish", value: iMat?.labelMatFinish ?? "metallic",
        options: {
          Metallic: "metallic",
          Matte: "matte",
          Gloss: "gloss",
          Satin: "satin",
          "Holographic Foil": "foil",
          "Prismatic Foil": "prismatic",
          "Multi-Chrome": "multi-chrome",
          Mosaic: "mosaic",
          Custom: "custom",
        },
        render: (get) =>
          get("Model.model") === "bag" &&
          get("Layer 2.labelMaterial"),
      },
      labelMatMetalness: {
        label: "Layer Metalness", value: iMat?.labelMatMetalness ?? 0.92, min: 0, max: 1, step: 0.01,
        render: (get) => {
          const f = get("Layer 2.labelMatFinish");
          return get("Model.model") === "bag" &&
            get("Layer 2.labelMaterial") &&
            (f === "custom" || f === "mosaic");
        },
      },
      labelMatRoughness: {
        label: "Layer Roughness", value: iMat?.labelMatRoughness ?? 0.08, min: 0, max: 1, step: 0.01,
        render: (get) => {
          const f = get("Layer 2.labelMatFinish");
          return get("Model.model") === "bag" &&
            get("Layer 2.labelMaterial") &&
            (f === "custom" || f === "mosaic");
        },
      },
      // Jar Layer 2 — artwork-mode metalness / roughness / varnish.
      layer2Metalness: {
        label: "Metalness", value: iMat?.layer2Metalness ?? 0.1, min: 0, max: 1, step: 0.01,
        render: (get) =>
          get("Model.model") === "jar" &&
          !get("Layer 2.layer2Varnish") &&
          !get("Layer 2.layer2Tactile") &&
          !get("Layer 2.layer2Material"),
      },
      layer2Roughness: {
        label: "Roughness", value: iMat?.layer2Roughness ?? 0.5, min: 0, max: 1, step: 0.01,
        render: (get) =>
          get("Model.model") === "jar" &&
          !get("Layer 2.layer2Varnish") &&
          !get("Layer 2.layer2Tactile") &&
          !get("Layer 2.layer2Material"),
      },
      layer2Varnish: {
        label: "Varnish", value: iMat?.layer2Varnish ?? false,
        render: (get) =>
          get("Model.model") === "jar" &&
          !get("Layer 2.layer2Tactile") &&
          !get("Layer 2.layer2Material"),
      },
      layer2Tactile: {
        label: "Tactile", value: iMat?.layer2Tactile ?? false,
        render: (get) =>
          get("Model.model") === "jar" &&
          !get("Layer 2.layer2Varnish") &&
          !get("Layer 2.layer2Material"),
      },
      layer2Material: {
        label: "Material", value: iMat?.layer2Material ?? false,
        render: (get) =>
          get("Model.model") === "jar" &&
          !get("Layer 2.layer2Tactile"),
      },
      layer2UV: {
        label: "UV Glow", value: iMat?.layer2UV ?? false,
        render: (get) => get("Model.model") === "jar",
      },
      // Per-layer Material finish (jar Layer 2).
      layer2MatFinish: {
        label: "Layer Finish", value: iMat?.layer2MatFinish ?? "metallic",
        options: {
          Metallic: "metallic",
          Matte: "matte",
          Gloss: "gloss",
          Satin: "satin",
          "Holographic Foil": "foil",
          "Prismatic Foil": "prismatic",
          "Multi-Chrome": "multi-chrome",
          Mosaic: "mosaic",
          Custom: "custom",
        },
        render: (get) =>
          get("Model.model") === "jar" &&
          get("Layer 2.layer2Material"),
      },
      layer2MatMetalness: {
        label: "Layer Metalness", value: iMat?.layer2MatMetalness ?? 0.92, min: 0, max: 1, step: 0.01,
        render: (get) => {
          const f = get("Layer 2.layer2MatFinish");
          return get("Model.model") === "jar" &&
            get("Layer 2.layer2Material") &&
            (f === "custom" || f === "mosaic");
        },
      },
      layer2MatRoughness: {
        label: "Layer Roughness", value: iMat?.layer2MatRoughness ?? 0.08, min: 0, max: 1, step: 0.01,
        render: (get) => {
          const f = get("Layer 2.layer2MatFinish");
          return get("Model.model") === "jar" &&
            get("Layer 2.layer2Material") &&
            (f === "custom" || f === "mosaic");
        },
      },
    }, { collapsed: false }),

    "Layer 3": folder({
      // Layer 3 controls — shared between bag and jar. Always visible now
      // that the active-layer gating is gone; sub-controls still fold
      // away when they can't contribute (custom sliders only matter with
      // Finish=Custom, etc.).
      layer3Metalness: {
        label: "Metalness", value: iMat?.layer3Metalness ?? 0.1, min: 0, max: 1, step: 0.01,
        render: (get) =>
          !get("Layer 3.layer3Varnish") &&
          !get("Layer 3.layer3Tactile") &&
          !get("Layer 3.layer3Material"),
      },
      layer3Roughness: {
        label: "Roughness", value: iMat?.layer3Roughness ?? 0.5, min: 0, max: 1, step: 0.01,
        render: (get) =>
          !get("Layer 3.layer3Varnish") &&
          !get("Layer 3.layer3Tactile") &&
          !get("Layer 3.layer3Material"),
      },
      layer3Varnish: {
        label: "Varnish", value: iMat?.layer3Varnish ?? false,
        render: (get) =>
          !get("Layer 3.layer3Tactile") &&
          !get("Layer 3.layer3Material"),
      },
      layer3Tactile: {
        label: "Tactile", value: iMat?.layer3Tactile ?? false,
        render: (get) =>
          !get("Layer 3.layer3Varnish") &&
          !get("Layer 3.layer3Material"),
      },
      layer3Material: {
        label: "Material", value: iMat?.layer3Material ?? false,
        render: (get) => !get("Layer 3.layer3Tactile"),
      },
      layer3UV: {
        label: "UV Glow", value: iMat?.layer3UV ?? false,
      },
      // Per-layer Material finish — revealed when the Material checkbox
      // is on. Shared between bag and jar since Layer 3's render path is
      // model-agnostic in this panel.
      layer3MatFinish: {
        label: "Layer Finish", value: iMat?.layer3MatFinish ?? "metallic",
        options: {
          Metallic: "metallic",
          Matte: "matte",
          Gloss: "gloss",
          Satin: "satin",
          "Holographic Foil": "foil",
          "Prismatic Foil": "prismatic",
          "Multi-Chrome": "multi-chrome",
          Mosaic: "mosaic",
          Custom: "custom",
        },
        render: (get) => get("Layer 3.layer3Material"),
      },
      layer3MatMetalness: {
        label: "Layer Metalness", value: iMat?.layer3MatMetalness ?? 0.92, min: 0, max: 1, step: 0.01,
        render: (get) => {
          const f = get("Layer 3.layer3MatFinish");
          return get("Layer 3.layer3Material") &&
            (f === "custom" || f === "mosaic");
        },
      },
      layer3MatRoughness: {
        label: "Layer Roughness", value: iMat?.layer3MatRoughness ?? 0.08, min: 0, max: 1, step: 0.01,
        render: (get) => {
          const f = get("Layer 3.layer3MatFinish");
          return get("Layer 3.layer3Material") &&
            (f === "custom" || f === "mosaic");
        },
      },
    }, { collapsed: false }),

    Mosaic: folder({
      // Shared crop zoom: 1 = full-fit aspect-correct crop of the source,
      // values > 1 tile the source across the surface for a zoomed-out
      // look (the only way past full-fit on a bounded 1×1 source), values
      // < 1 zoom in to finer detail so the random offsets actually
      // surface different content per layer.
      mosaicZoom: {
        label: "Zoom", value: iMosaic.mosaicZoom, min: 0.05, max: 3, step: 0.01,
      },
      // "Mirror" swaps the mosaic source for a centre-symmetric version
      // of itself before any layer crops it. Off → source is used raw.
      // On → left half stays; right half is replaced with the left half
      // flipped horizontally. Useful on the jar (cylindrical wrap has
      // no natural mirror seam) and as a way to disable the bag's
      // natural front/back mirror when the user wants continuous art.
      mosaicMirror: {
        label: "Mirror", value: iMosaic.mosaicMirror,
      },
      // "Re-randomize" picks new 0–1 offset seeds and coin-flips the
      // per-layer mirror toggles (flipX/flipY) for every layer. Mirrors
      // preserve aspect — unlike a free rotation which axis-swaps and
      // distorts non-square targets like cylindrical jar labels.
      // Leva renders the Mosaic folder's button with its field key as the
      // label ("mosaicReroll"). Rename the key itself so the user-facing
      // text reads naturally — Leva's ButtonSettings has no `label` prop.
      "Re-randomize crops": button(() => mosaicOpsRef.current.reroll()),
      // Hidden offset + flip fields — persisted on the material but
      // never rendered as sliders. `render: () => false` keeps them out of
      // the sidebar while still letting `setLeva` read/write through the
      // same store.
      mosaicOffsetU: { value: iMosaic.mosaicOffsetU, render: () => false },
      mosaicOffsetV: { value: iMosaic.mosaicOffsetV, render: () => false },
      mosaicFlipX: { value: iMosaic.mosaicFlipX, render: () => false },
      mosaicFlipY: { value: iMosaic.mosaicFlipY, render: () => false },
      mosaicMirrorRotation: { value: iMosaic.mosaicMirrorRotation, render: () => false },
      labelMosaicOffsetU: { value: iMosaic.labelMosaicOffsetU, render: () => false },
      labelMosaicOffsetV: { value: iMosaic.labelMosaicOffsetV, render: () => false },
      labelMosaicFlipX: { value: iMosaic.labelMosaicFlipX, render: () => false },
      labelMosaicFlipY: { value: iMosaic.labelMosaicFlipY, render: () => false },
      labelMosaicMirrorRotation: { value: iMosaic.labelMosaicMirrorRotation, render: () => false },
      layer2MosaicOffsetU: { value: iMosaic.layer2MosaicOffsetU, render: () => false },
      layer2MosaicOffsetV: { value: iMosaic.layer2MosaicOffsetV, render: () => false },
      layer2MosaicFlipX: { value: iMosaic.layer2MosaicFlipX, render: () => false },
      layer2MosaicFlipY: { value: iMosaic.layer2MosaicFlipY, render: () => false },
      layer2MosaicMirrorRotation: { value: iMosaic.layer2MosaicMirrorRotation, render: () => false },
      layer3MosaicOffsetU: { value: iMosaic.layer3MosaicOffsetU, render: () => false },
      layer3MosaicOffsetV: { value: iMosaic.layer3MosaicOffsetV, render: () => false },
      layer3MosaicFlipX: { value: iMosaic.layer3MosaicFlipX, render: () => false },
      layer3MosaicFlipY: { value: iMosaic.layer3MosaicFlipY, render: () => false },
      layer3MosaicMirrorRotation: { value: iMosaic.layer3MosaicMirrorRotation, render: () => false },
    }, { collapsed: true }),

    Scene: folder({
      // Auto Rotate stays in the Materials sidebar since it's a
      // camera/view concern rather than a lighting one. The HDRI
      // preset + intensity moved to the Lighting sidebar.
      autoRotate: { label: "Auto Rotate", value: iL.autoRotate },
    }, { collapsed: false }),
    // NOTE: when useControls is given a factory, the hook settings
    // (including `store`) go in the SECOND arg and deps in the
    // third — swap the order and Leva silently falls back to the
    // global store because `parseArgs` only parses settings-in-slot-2.
  }), { store: matStore }, []);

  // ── Lighting store ─────────────────────────────────────────────────────────
  // Second useControls call, bound to the Lighting sidebar's Leva store. All
  // scene/environment/lighting knobs live here so the Lighting sidebar can
  // be collapsed independently of the Materials one. New controls added on
  // top of the existing set: tone mapping, background, fog, shadows, plus
  // directional / point / rect-area light families.
  const [lightValues, setLightLeva] = useControls(() => ({
    Environment: folder({
      environment: {
        label: "Scene",
        value: iEnv,
        options: { Default: "default", Smoke: "smoke", Dim: "dim" },
      },
    }, { collapsed: false }),

    HDRI: folder({
      lighting: {
        label: "Preset", value: iL.lighting,
        options: {
          Studio: "studio",
          Warehouse: "warehouse",
          City: "city",
          Forest: "forest",
          Sunset: "sunset",
          Rave: "rave",
          "UV Blacklight": "uv",
          "Kominka Studio (custom)": "kominka",
        },
      },
      envIntensity: {
        label: "HDRI Intensity", value: iL.envIntensity, min: 0, max: 10, step: 0.01,
      },
    }, { collapsed: false }),

    "Tone Mapping": folder({
      toneMappingCurve: {
        label: "Curve", value: iL.toneMappingCurve,
        options: {
          "ACES Filmic": "aces",
          AgX: "agx",
          Cineon: "cineon",
          Reinhard: "reinhard",
          Linear: "linear",
          None: "none",
        },
      },
      toneMappingExposure: {
        label: "Exposure", value: iL.toneMappingExposure, min: 0.1, max: 8, step: 0.01,
      },
    }, { collapsed: true }),

    Background: folder({
      backgroundMode: {
        label: "Mode", value: iL.backgroundMode,
        options: { Flat: "flat", Gradient: "gradient", Transparent: "transparent" },
      },
      backgroundColor1: {
        label: "Color 1", value: iL.backgroundColor1,
        render: (get) => get("Background.backgroundMode") !== "transparent",
      },
      backgroundColor2: {
        label: "Color 2", value: iL.backgroundColor2,
        render: (get) => get("Background.backgroundMode") === "gradient",
      },
      backgroundAngle: {
        label: "Angle (deg)", value: iL.backgroundAngle, min: 0, max: 360, step: 1,
        render: (get) => get("Background.backgroundMode") === "gradient",
      },
    }, { collapsed: true }),

    Fog: folder({
      fogEnabled: { label: "Enabled", value: iL.fogEnabled },
      fogColor: {
        label: "Color", value: iL.fogColor,
        render: (get) => get("Fog.fogEnabled"),
      },
      fogNear: {
        label: "Near", value: iL.fogNear, min: 0, max: 20, step: 0.1,
        render: (get) => get("Fog.fogEnabled"),
      },
      fogFar: {
        label: "Far", value: iL.fogFar, min: 0, max: 50, step: 0.1,
        render: (get) => get("Fog.fogEnabled"),
      },
    }, { collapsed: true }),

    Shadows: folder({
      shadowsEnabled: { label: "Enabled", value: iL.shadowsEnabled },
      shadowGround: {
        label: "Ground Plane",
        value: iL.shadowGround,
      },
      shadowOpacity: {
        label: "Ground Opacity", value: iL.shadowOpacity, min: 0, max: 1, step: 0.01,
        render: (get) => get("Shadows.shadowGround"),
      },
      shadowMapSize: {
        label: "Map Size", value: iL.shadowMapSize,
        options: { "Low (512)": 512, "Medium (1024)": 1024, "High (2048)": 2048, "Ultra (4096)": 4096 },
        render: (get) => get("Shadows.shadowsEnabled"),
      },
      shadowRadius: {
        label: "Softness", value: iL.shadowRadius, min: 0, max: 16, step: 0.1,
        render: (get) => get("Shadows.shadowsEnabled"),
      },
    }, { collapsed: true }),

    Ambient: folder({
      ambientIntensity: {
        label: "Intensity", value: iL.ambientIntensity, min: 0, max: 3, step: 0.01,
      },
      ambientColor: { label: "Color", value: iL.ambientColor },
    }, { collapsed: false }),

    "Directional Lights": folder({
      dirCount: { label: "Count", value: iL.dirCount, min: 0, max: 2, step: 1 },
      dir1Color: {
        label: "D1 Color", value: iL.dir1Color,
        render: (get) => get("Directional Lights.dirCount") >= 1,
      },
      dir1Intensity: {
        label: "D1 Intensity", value: iL.dir1Intensity, min: 0, max: 10, step: 0.1,
        render: (get) => get("Directional Lights.dirCount") >= 1,
      },
      dir1Pos: {
        label: "D1 Position", value: iL.dir1Pos, step: 0.1,
        render: (get) => get("Directional Lights.dirCount") >= 1,
      },
      dir2Color: {
        label: "D2 Color", value: iL.dir2Color,
        render: (get) => get("Directional Lights.dirCount") >= 2,
      },
      dir2Intensity: {
        label: "D2 Intensity", value: iL.dir2Intensity, min: 0, max: 10, step: 0.1,
        render: (get) => get("Directional Lights.dirCount") >= 2,
      },
      dir2Pos: {
        label: "D2 Position", value: iL.dir2Pos, step: 0.1,
        render: (get) => get("Directional Lights.dirCount") >= 2,
      },
    }, { collapsed: true }),

    Spotlights: folder({
      spotCount: {
        label: "Count", value: iL.spotCount, min: 0, max: 4, step: 1,
      },
      spot1Color: {
        label: "S1 Color", value: iL.spot1Color,
        render: (get) => get("Spotlights.spotCount") >= 1,
      },
      spot1Intensity: {
        label: "S1 Intensity", value: iL.spot1Intensity, min: 0, max: 200, step: 1,
        render: (get) => get("Spotlights.spotCount") >= 1,
      },
      spot1Pos: {
        label: "S1 Position", value: iL.spot1Pos, step: 0.1,
        render: (get) => get("Spotlights.spotCount") >= 1,
      },
      spot2Color: {
        label: "S2 Color", value: iL.spot2Color,
        render: (get) => get("Spotlights.spotCount") >= 2,
      },
      spot2Intensity: {
        label: "S2 Intensity", value: iL.spot2Intensity, min: 0, max: 200, step: 1,
        render: (get) => get("Spotlights.spotCount") >= 2,
      },
      spot2Pos: {
        label: "S2 Position", value: iL.spot2Pos, step: 0.1,
        render: (get) => get("Spotlights.spotCount") >= 2,
      },
      spot3Color: {
        label: "S3 Color", value: iL.spot3Color,
        render: (get) => get("Spotlights.spotCount") >= 3,
      },
      spot3Intensity: {
        label: "S3 Intensity", value: iL.spot3Intensity, min: 0, max: 200, step: 1,
        render: (get) => get("Spotlights.spotCount") >= 3,
      },
      spot3Pos: {
        label: "S3 Position", value: iL.spot3Pos, step: 0.1,
        render: (get) => get("Spotlights.spotCount") >= 3,
      },
      spot4Color: {
        label: "S4 Color", value: iL.spot4Color,
        render: (get) => get("Spotlights.spotCount") >= 4,
      },
      spot4Intensity: {
        label: "S4 Intensity", value: iL.spot4Intensity, min: 0, max: 200, step: 1,
        render: (get) => get("Spotlights.spotCount") >= 4,
      },
      spot4Pos: {
        label: "S4 Position", value: iL.spot4Pos, step: 0.1,
        render: (get) => get("Spotlights.spotCount") >= 4,
      },
    }, { collapsed: false }),

    "Point Lights": folder({
      pointCount: { label: "Count", value: iL.pointCount, min: 0, max: 4, step: 1 },
      point1Color: {
        label: "P1 Color", value: iL.point1Color,
        render: (get) => get("Point Lights.pointCount") >= 1,
      },
      point1Intensity: {
        label: "P1 Intensity", value: iL.point1Intensity, min: 0, max: 200, step: 1,
        render: (get) => get("Point Lights.pointCount") >= 1,
      },
      point1Pos: {
        label: "P1 Position", value: iL.point1Pos, step: 0.1,
        render: (get) => get("Point Lights.pointCount") >= 1,
      },
      point2Color: {
        label: "P2 Color", value: iL.point2Color,
        render: (get) => get("Point Lights.pointCount") >= 2,
      },
      point2Intensity: {
        label: "P2 Intensity", value: iL.point2Intensity, min: 0, max: 200, step: 1,
        render: (get) => get("Point Lights.pointCount") >= 2,
      },
      point2Pos: {
        label: "P2 Position", value: iL.point2Pos, step: 0.1,
        render: (get) => get("Point Lights.pointCount") >= 2,
      },
      point3Color: {
        label: "P3 Color", value: iL.point3Color,
        render: (get) => get("Point Lights.pointCount") >= 3,
      },
      point3Intensity: {
        label: "P3 Intensity", value: iL.point3Intensity, min: 0, max: 200, step: 1,
        render: (get) => get("Point Lights.pointCount") >= 3,
      },
      point3Pos: {
        label: "P3 Position", value: iL.point3Pos, step: 0.1,
        render: (get) => get("Point Lights.pointCount") >= 3,
      },
      point4Color: {
        label: "P4 Color", value: iL.point4Color,
        render: (get) => get("Point Lights.pointCount") >= 4,
      },
      point4Intensity: {
        label: "P4 Intensity", value: iL.point4Intensity, min: 0, max: 200, step: 1,
        render: (get) => get("Point Lights.pointCount") >= 4,
      },
      point4Pos: {
        label: "P4 Position", value: iL.point4Pos, step: 0.1,
        render: (get) => get("Point Lights.pointCount") >= 4,
      },
    }, { collapsed: true }),

    "Rect Area Lights": folder({
      rectBothSides: {
        label: "Wrap Both Sides", value: iL.rectBothSides,
      },
      rectCount: { label: "Count", value: iL.rectCount, min: 0, max: 4, step: 1 },
      // Rect 1
      rect1Color: {
        label: "R1 Color", value: iL.rect1Color,
        render: (get) => get("Rect Area Lights.rectCount") >= 1,
      },
      rect1Intensity: {
        label: "R1 Intensity", value: iL.rect1Intensity, min: 0, max: 100, step: 0.5,
        render: (get) => get("Rect Area Lights.rectCount") >= 1,
      },
      rect1Width: {
        label: "R1 Width", value: iL.rect1Width, min: 0.1, max: 10, step: 0.1,
        render: (get) => get("Rect Area Lights.rectCount") >= 1,
      },
      rect1Height: {
        label: "R1 Height", value: iL.rect1Height, min: 0.1, max: 10, step: 0.1,
        render: (get) => get("Rect Area Lights.rectCount") >= 1,
      },
      rect1X: {
        label: "R1 X", value: iL.rect1X, min: -6, max: 6, step: 0.05,
        render: (get) => get("Rect Area Lights.rectCount") >= 1,
      },
      rect1Y: {
        label: "R1 Y", value: iL.rect1Y, min: -6, max: 6, step: 0.05,
        render: (get) => get("Rect Area Lights.rectCount") >= 1,
      },
      rect1Z: {
        label: "R1 Z (height)", value: iL.rect1Z, min: -6, max: 6, step: 0.05,
        render: (get) => get("Rect Area Lights.rectCount") >= 1,
      },
      // Rect 2
      rect2Color: {
        label: "R2 Color", value: iL.rect2Color,
        render: (get) => get("Rect Area Lights.rectCount") >= 2,
      },
      rect2Intensity: {
        label: "R2 Intensity", value: iL.rect2Intensity, min: 0, max: 100, step: 0.5,
        render: (get) => get("Rect Area Lights.rectCount") >= 2,
      },
      rect2Width: {
        label: "R2 Width", value: iL.rect2Width, min: 0.1, max: 10, step: 0.1,
        render: (get) => get("Rect Area Lights.rectCount") >= 2,
      },
      rect2Height: {
        label: "R2 Height", value: iL.rect2Height, min: 0.1, max: 10, step: 0.1,
        render: (get) => get("Rect Area Lights.rectCount") >= 2,
      },
      rect2X: {
        label: "R2 X", value: iL.rect2X, min: -6, max: 6, step: 0.05,
        render: (get) => get("Rect Area Lights.rectCount") >= 2,
      },
      rect2Y: {
        label: "R2 Y", value: iL.rect2Y, min: -6, max: 6, step: 0.05,
        render: (get) => get("Rect Area Lights.rectCount") >= 2,
      },
      rect2Z: {
        label: "R2 Z (height)", value: iL.rect2Z, min: -6, max: 6, step: 0.05,
        render: (get) => get("Rect Area Lights.rectCount") >= 2,
      },
      // Rect 3
      rect3Color: {
        label: "R3 Color", value: iL.rect3Color,
        render: (get) => get("Rect Area Lights.rectCount") >= 3,
      },
      rect3Intensity: {
        label: "R3 Intensity", value: iL.rect3Intensity, min: 0, max: 100, step: 0.5,
        render: (get) => get("Rect Area Lights.rectCount") >= 3,
      },
      rect3Width: {
        label: "R3 Width", value: iL.rect3Width, min: 0.1, max: 10, step: 0.1,
        render: (get) => get("Rect Area Lights.rectCount") >= 3,
      },
      rect3Height: {
        label: "R3 Height", value: iL.rect3Height, min: 0.1, max: 10, step: 0.1,
        render: (get) => get("Rect Area Lights.rectCount") >= 3,
      },
      rect3X: {
        label: "R3 X", value: iL.rect3X, min: -6, max: 6, step: 0.05,
        render: (get) => get("Rect Area Lights.rectCount") >= 3,
      },
      rect3Y: {
        label: "R3 Y", value: iL.rect3Y, min: -6, max: 6, step: 0.05,
        render: (get) => get("Rect Area Lights.rectCount") >= 3,
      },
      rect3Z: {
        label: "R3 Z (height)", value: iL.rect3Z, min: -6, max: 6, step: 0.05,
        render: (get) => get("Rect Area Lights.rectCount") >= 3,
      },
      // Rect 4
      rect4Color: {
        label: "R4 Color", value: iL.rect4Color,
        render: (get) => get("Rect Area Lights.rectCount") >= 4,
      },
      rect4Intensity: {
        label: "R4 Intensity", value: iL.rect4Intensity, min: 0, max: 100, step: 0.5,
        render: (get) => get("Rect Area Lights.rectCount") >= 4,
      },
      rect4Width: {
        label: "R4 Width", value: iL.rect4Width, min: 0.1, max: 10, step: 0.1,
        render: (get) => get("Rect Area Lights.rectCount") >= 4,
      },
      rect4Height: {
        label: "R4 Height", value: iL.rect4Height, min: 0.1, max: 10, step: 0.1,
        render: (get) => get("Rect Area Lights.rectCount") >= 4,
      },
      rect4X: {
        label: "R4 X", value: iL.rect4X, min: -6, max: 6, step: 0.05,
        render: (get) => get("Rect Area Lights.rectCount") >= 4,
      },
      rect4Y: {
        label: "R4 Y", value: iL.rect4Y, min: -6, max: 6, step: 0.05,
        render: (get) => get("Rect Area Lights.rectCount") >= 4,
      },
      rect4Z: {
        label: "R4 Z (height)", value: iL.rect4Z, min: -6, max: 6, step: 0.05,
        render: (get) => get("Rect Area Lights.rectCount") >= 4,
      },
    }, { collapsed: false }),

    // NOTE: Save Lighting / Reset Lighting buttons used to live
    // here as Leva button() entries, but Leva renders
    // conditionally-visible folder children (rect1*, rect2*, etc.)
    // AFTER their declaration order — which meant the buttons kept
    // overlapping R1 Color and R1 Intensity no matter where we put
    // them in the schema. Moved out of Leva entirely and rendered
    // as plain DOM buttons in the sidebar footer (below the
    // RectLightMap). Handler still routes through lightingOpsRef
    // so the save/reset actions read the latest values.
    // See matStore note above — settings slot is arg2, not arg3.
  }), { store: lightStore }, []);

  // Destructure the flat values objects — Materials fields from
  // `values`, Lighting/Scene fields from `lightValues`. Naming is
  // preserved so the rest of the component keeps consuming each
  // knob by the same variable it always did.
  const {
    model,
    finish, metalness, roughness, bagColor,
    autoRotate,
    labelMetalness, labelRoughness, labelVarnish, labelTactile, labelMaterial, labelUV,
    labelMatFinish, labelMatMetalness, labelMatRoughness,
    layer2Metalness, layer2Roughness, layer2Varnish, layer2Tactile, layer2Material, layer2UV,
    layer2MatFinish, layer2MatMetalness, layer2MatRoughness,
    layer3Metalness, layer3Roughness, layer3Varnish, layer3Tactile, layer3Material, layer3UV,
    layer3MatFinish, layer3MatMetalness, layer3MatRoughness,
    mosaicZoom, mosaicMirror,
    mosaicOffsetU, mosaicOffsetV, mosaicFlipX, mosaicFlipY, mosaicMirrorRotation,
    labelMosaicOffsetU, labelMosaicOffsetV, labelMosaicFlipX, labelMosaicFlipY, labelMosaicMirrorRotation,
    layer2MosaicOffsetU, layer2MosaicOffsetV, layer2MosaicFlipX, layer2MosaicFlipY, layer2MosaicMirrorRotation,
    layer3MosaicOffsetU, layer3MosaicOffsetV, layer3MosaicFlipX, layer3MosaicFlipY, layer3MosaicMirrorRotation,
  } = values;

  // Re-roll every per-layer crop seed + coin-flip the mirror toggles.
  // Invoked by the Mosaic folder's Re-randomize button via `mosaicOpsRef`.
  // Using `setLeva` routes the new values through the same store the
  // sync effects read, so the 3D view updates on the next render.
  // Flips preserve aspect (no axis-swap), so unlike a free rotation they
  // never distort when the target isn't 1:1 (cylindrical jar labels,
  // rectangular bag panels).
  mosaicOpsRef.current.reroll = () => {
    const flip = () => Math.random() < 0.5;
    const angle = () => Math.random() * Math.PI * 2;
    setLeva({
      mosaicOffsetU: Math.random(),
      mosaicOffsetV: Math.random(),
      mosaicFlipX: flip(),
      mosaicFlipY: flip(),
      mosaicMirrorRotation: angle(),
      labelMosaicOffsetU: Math.random(),
      labelMosaicOffsetV: Math.random(),
      labelMosaicFlipX: flip(),
      labelMosaicFlipY: flip(),
      labelMosaicMirrorRotation: angle(),
      layer2MosaicOffsetU: Math.random(),
      layer2MosaicOffsetV: Math.random(),
      layer2MosaicFlipX: flip(),
      layer2MosaicFlipY: flip(),
      layer2MosaicMirrorRotation: angle(),
      layer3MosaicOffsetU: Math.random(),
      layer3MosaicOffsetV: Math.random(),
      layer3MosaicFlipX: flip(),
      layer3MosaicFlipY: flip(),
      layer3MosaicMirrorRotation: angle(),
    });
  };

  const {
    lighting,
    environment,
    // Tone mapping
    toneMappingCurve, toneMappingExposure,
    // Background
    backgroundMode, backgroundColor1, backgroundColor2, backgroundAngle,
    // Fog
    fogEnabled, fogColor, fogNear, fogFar,
    // Shadows
    shadowsEnabled, shadowMapSize, shadowRadius,
    shadowGround, shadowOpacity,
    // Ambient
    ambientIntensity, ambientColor,
    // Directional
    dirCount,
    dir1Color, dir1Intensity, dir1Pos,
    dir2Color, dir2Intensity, dir2Pos,
    // HDRI
    envIntensity,
    // Spotlights (count kept in lighting store now)
    spotCount,
    spot1Color, spot1Intensity, spot1Pos,
    spot2Color, spot2Intensity, spot2Pos,
    spot3Color, spot3Intensity, spot3Pos,
    spot4Color, spot4Intensity, spot4Pos,
    // Point lights
    pointCount,
    point1Color, point1Intensity, point1Pos,
    point2Color, point2Intensity, point2Pos,
    point3Color, point3Intensity, point3Pos,
    point4Color, point4Intensity, point4Pos,
    // Rect area lights
    rectCount, rectBothSides,
    rect1Color, rect1Intensity, rect1Width, rect1Height, rect1X, rect1Y, rect1Z,
    rect2Color, rect2Intensity, rect2Width, rect2Height, rect2X, rect2Y, rect2Z,
    rect3Color, rect3Intensity, rect3Width, rect3Height, rect3X, rect3Y, rect3Z,
    rect4Color, rect4Intensity, rect4Width, rect4Height, rect4X, rect4Y, rect4Z,
  } = lightValues;

  // ── Lighting persistence wiring ────────────────────────────────────────────
  // Keep a snapshot of the current Leva lighting values in a ref so
  // the SAVE/RESET handlers always see the latest. Leva's `button()`
  // captures its callback by reference at schema-build time (once per
  // mount), so we can't close over `values` directly — each render
  // refreshes this ref instead and the handlers read from it.
  // Full rig snapshot — mirrors every Lighting-sidebar Leva control so
  // the "Save Lighting for Environment" button writes the complete
  // per-env rig to localStorage (not just the ambient+spot subset the
  // first version supported). Extending SavedLighting with optional
  // fields keeps old localStorage blobs forward-compatible.
  const lightingValuesRef = useRef<SavedLighting>({
    ambientIntensity, ambientColor, envIntensity,
    lighting,
    toneMappingCurve, toneMappingExposure,
    backgroundMode, backgroundColor1, backgroundColor2, backgroundAngle,
    fogEnabled, fogColor, fogNear, fogFar,
    shadowsEnabled, shadowGround, shadowOpacity, shadowMapSize: shadowMapSize as number, shadowRadius,
    dirCount, dir1Color, dir1Intensity, dir1Pos, dir2Color, dir2Intensity, dir2Pos,
    spotCount,
    spot1Color, spot1Intensity, spot1Pos,
    spot2Color, spot2Intensity, spot2Pos,
    spot3Color, spot3Intensity, spot3Pos,
    spot4Color, spot4Intensity, spot4Pos,
    pointCount,
    point1Color, point1Intensity, point1Pos,
    point2Color, point2Intensity, point2Pos,
    point3Color, point3Intensity, point3Pos,
    point4Color, point4Intensity, point4Pos,
    rectCount, rectBothSides,
    rect1Color, rect1Intensity, rect1Width, rect1Height, rect1X, rect1Y, rect1Z,
    rect2Color, rect2Intensity, rect2Width, rect2Height, rect2X, rect2Y, rect2Z,
    rect3Color, rect3Intensity, rect3Width, rect3Height, rect3X, rect3Y, rect3Z,
    rect4Color, rect4Intensity, rect4Width, rect4Height, rect4X, rect4Y, rect4Z,
  });
  lightingValuesRef.current = {
    ambientIntensity, ambientColor, envIntensity,
    lighting,
    toneMappingCurve, toneMappingExposure,
    backgroundMode, backgroundColor1, backgroundColor2, backgroundAngle,
    fogEnabled, fogColor, fogNear, fogFar,
    shadowsEnabled, shadowGround, shadowOpacity, shadowMapSize: shadowMapSize as number, shadowRadius,
    dirCount, dir1Color, dir1Intensity, dir1Pos, dir2Color, dir2Intensity, dir2Pos,
    spotCount,
    spot1Color, spot1Intensity, spot1Pos,
    spot2Color, spot2Intensity, spot2Pos,
    spot3Color, spot3Intensity, spot3Pos,
    spot4Color, spot4Intensity, spot4Pos,
    pointCount,
    point1Color, point1Intensity, point1Pos,
    point2Color, point2Intensity, point2Pos,
    point3Color, point3Intensity, point3Pos,
    point4Color, point4Intensity, point4Pos,
    rectCount, rectBothSides,
    rect1Color, rect1Intensity, rect1Width, rect1Height, rect1X, rect1Y, rect1Z,
    rect2Color, rect2Intensity, rect2Width, rect2Height, rect2X, rect2Y, rect2Z,
    rect3Color, rect3Intensity, rect3Width, rect3Height, rect3X, rect3Y, rect3Z,
    rect4Color, rect4Intensity, rect4Width, rect4Height, rect4X, rect4Y, rect4Z,
  };

  // Same trick for the current environment — the SAVE handler needs
  // to write to whichever env is selected *at click time*, not the
  // one that was active when the schema was first built.
  const envRef = useRef<SceneEnvironment>(environment as SceneEnvironment);
  envRef.current = environment as SceneEnvironment;

  // Bind the actual SAVE/RESET logic to the ref the button closure
  // reads from. Updated on every render so the handlers always see
  // the newest values + env.
  lightingOpsRef.current = {
    save: () => {
      const env = envRef.current;
      saveLightingForEnv(env, lightingValuesRef.current);
    },
    reset: () => {
      const env = envRef.current;
      clearLightingForEnv(env);
      setLightLeva(LIGHTING_DEFAULTS as unknown as Record<string, unknown>);
    },
  };
  // Mirror the same handlers into the caller-supplied ref so the
  // parent page can render Save / Reset buttons outside the Leva
  // panel. Kept in sync every render so the handlers always see
  // the latest environment + values snapshot.
  if (externalLightingOpsRef) {
    externalLightingOpsRef.current = lightingOpsRef.current;
  }

  // When the user switches environments, load that env's stored rig
  // (or fall back to LIGHTING_DEFAULTS). Skip the first run so the
  // factory-form useControls' iL-seeded values (which already prefer
  // iMat over localStorage) don't get clobbered on mount of a reopened
  // slot — otherwise a saved slot's custom rig would be overwritten
  // by whichever env the user's browser last saved to localStorage.
  // Unsaved edits in the previous env are intentionally discarded;
  // users commit with SAVE before switching.
  const didMountLightingEffectRef = useRef(false);
  useEffect(() => {
    if (!didMountLightingEffectRef.current) {
      didMountLightingEffectRef.current = true;
      return;
    }
    const env = environment as SceneEnvironment;
    const stored = loadLightingForEnv(env);
    setLightLeva((stored ?? LIGHTING_DEFAULTS) as unknown as Record<string, unknown>);
    // Purposefully exclude setLightLeva from deps — it's stable across
    // renders by Leva contract, and including it would confuse eslint.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [environment]);

  // Emit current model so the page can adapt its upload buttons.
  useEffect(() => {
    onModelChange?.(model as "bag" | "jar");
  }, [model, onModelChange]);

  // Emit current environment so the page can include it in saves.
  useEffect(() => {
    onEnvironmentChange?.(environment as "default" | "smoke" | "dim");
  }, [environment, onEnvironmentChange]);

  // Custom and Mosaic both drop to the live metalness/roughness sliders
  // so the user can tune gloss while staying in the finish. Other presets
  // lock to FINISH_PRESETS for predictable rendering.
  const preset =
    finish === "custom" || finish === "mosaic"
      ? null
      : FINISH_PRESETS[finish as Exclude<BagFinish, "custom">] ?? FINISH_PRESETS.metallic;
  const bagProps = preset
    ? { metalness: preset.metalness, roughness: preset.roughness }
    : { metalness, roughness };

  const isRave = lighting === "rave";
  const isUV = lighting === "uv";
  const isSmoke = environment === "smoke";
  const isDim = environment === "dim";

  // Dim mode pulls every light source — ambient, HDRI-driven scene lighting,
  // and the bag material's env-map reflections — down to 20% so the animated
  // rainbow lights are the dominant illumination. Rave already has its own
  // explicit intensity for the HDRI, so we don't stack dimming on top of it.
  const dimScale = isDim ? 0.2 : 1;

  // Keep the studio-light background regardless of environment. The smoke
  // scene relies on a backlight behind the clouds to create contrast rather
  // than a dark sky.
  const backgroundColor = useMemo(() => "#eef1f8", []);

  // Emit the current material snapshot whenever any Leva control changes
  useEffect(() => {
    if (!onMaterialChange) return;
    onMaterialChange({
      finish: finish as BagFinish,
      metalness,
      roughness,
      bagColor,
      labelMetalness,
      labelRoughness,
      lighting: lighting as BagLighting,
      labelVarnish,
      labelTactile,
      labelMaterial,
      labelMatFinish: labelMatFinish as BagFinish,
      labelMatMetalness,
      labelMatRoughness,
      layer2Metalness,
      layer2Roughness,
      layer2Varnish,
      layer2Tactile,
      layer2Material,
      layer2MatFinish: layer2MatFinish as BagFinish,
      layer2MatMetalness,
      layer2MatRoughness,
      layer3Metalness,
      layer3Roughness,
      layer3Varnish,
      layer3Tactile,
      layer3Material,
      layer3MatFinish: layer3MatFinish as BagFinish,
      layer3MatMetalness,
      layer3MatRoughness,
      // UV Blacklight per-layer glow toggles — only visually active
      // when the HDRI preset is "uv" but persisted on the slot either
      // way so the edit-roundtrip preserves the artwork tag.
      labelUV,
      layer2UV,
      layer3UV,
      // Scene + full lighting rig — so reopening a saved slot restores
      // every background/fog/shadow/light setting, not just materials.
      autoRotate,
      toneMappingCurve,
      toneMappingExposure,
      backgroundMode,
      backgroundColor1,
      backgroundColor2,
      backgroundAngle,
      fogEnabled,
      fogColor,
      fogNear,
      fogFar,
      shadowsEnabled,
      shadowMapSize,
      shadowRadius,
      shadowGround,
      shadowOpacity,
      ambientIntensity,
      ambientColor,
      envIntensity,
      dirCount,
      dir1Color, dir1Intensity, dir1Pos,
      dir2Color, dir2Intensity, dir2Pos,
      spotCount,
      spot1Color, spot1Intensity, spot1Pos,
      spot2Color, spot2Intensity, spot2Pos,
      spot3Color, spot3Intensity, spot3Pos,
      spot4Color, spot4Intensity, spot4Pos,
      pointCount,
      point1Color, point1Intensity, point1Pos,
      point2Color, point2Intensity, point2Pos,
      point3Color, point3Intensity, point3Pos,
      point4Color, point4Intensity, point4Pos,
      rectCount, rectBothSides,
      rect1Color, rect1Intensity, rect1Width, rect1Height, rect1X, rect1Y, rect1Z,
      rect2Color, rect2Intensity, rect2Width, rect2Height, rect2X, rect2Y, rect2Z,
      rect3Color, rect3Intensity, rect3Width, rect3Height, rect3X, rect3Y, rect3Z,
      rect4Color, rect4Intensity, rect4Width, rect4Height, rect4X, rect4Y, rect4Z,
      // Mosaic — shared zoom + per-layer crop seeds. The source-image URL
      // lives on the page (page-owned upload state) and gets merged into
      // the material at save time, so we persist seeds here without
      // overwriting `mosaicSourceImageUrl` on every emit.
      mosaicZoom, mosaicMirror,
      mosaicOffsetU, mosaicOffsetV, mosaicFlipX, mosaicFlipY, mosaicMirrorRotation,
      labelMosaicOffsetU, labelMosaicOffsetV, labelMosaicFlipX, labelMosaicFlipY, labelMosaicMirrorRotation,
      layer2MosaicOffsetU, layer2MosaicOffsetV, layer2MosaicFlipX, layer2MosaicFlipY, layer2MosaicMirrorRotation,
      layer3MosaicOffsetU, layer3MosaicOffsetV, layer3MosaicFlipX, layer3MosaicFlipY, layer3MosaicMirrorRotation,
    });
  }, [
    finish,
    metalness,
    roughness,
    bagColor,
    labelMetalness,
    labelRoughness,
    lighting,
    labelVarnish,
    labelTactile,
    labelMaterial,
    labelMatFinish,
    labelMatMetalness,
    labelMatRoughness,
    layer2Metalness,
    layer2Roughness,
    layer2Varnish,
    layer2Tactile,
    layer2Material,
    layer2MatFinish,
    layer2MatMetalness,
    layer2MatRoughness,
    layer3Metalness,
    layer3Roughness,
    layer3Varnish,
    layer3Tactile,
    layer3Material,
    layer3MatFinish,
    layer3MatMetalness,
    layer3MatRoughness,
    labelUV,
    layer2UV,
    layer3UV,
    autoRotate,
    toneMappingCurve,
    toneMappingExposure,
    backgroundMode,
    backgroundColor1,
    backgroundColor2,
    backgroundAngle,
    fogEnabled,
    fogColor,
    fogNear,
    fogFar,
    shadowsEnabled,
    shadowMapSize,
    shadowRadius,
    shadowGround,
    shadowOpacity,
    ambientIntensity,
    ambientColor,
    envIntensity,
    dirCount,
    dir1Color, dir1Intensity, dir1Pos,
    dir2Color, dir2Intensity, dir2Pos,
    spotCount,
    spot1Color, spot1Intensity, spot1Pos,
    spot2Color, spot2Intensity, spot2Pos,
    spot3Color, spot3Intensity, spot3Pos,
    spot4Color, spot4Intensity, spot4Pos,
    pointCount,
    point1Color, point1Intensity, point1Pos,
    point2Color, point2Intensity, point2Pos,
    point3Color, point3Intensity, point3Pos,
    point4Color, point4Intensity, point4Pos,
    rectCount, rectBothSides,
    rect1Color, rect1Intensity, rect1Width, rect1Height, rect1X, rect1Y, rect1Z,
    rect2Color, rect2Intensity, rect2Width, rect2Height, rect2X, rect2Y, rect2Z,
    rect3Color, rect3Intensity, rect3Width, rect3Height, rect3X, rect3Y, rect3Z,
    rect4Color, rect4Intensity, rect4Width, rect4Height, rect4X, rect4Y, rect4Z,
    mosaicZoom, mosaicMirror,
    mosaicOffsetU, mosaicOffsetV, mosaicFlipX, mosaicFlipY, mosaicMirrorRotation,
    labelMosaicOffsetU, labelMosaicOffsetV, labelMosaicFlipX, labelMosaicFlipY, labelMosaicMirrorRotation,
    layer2MosaicOffsetU, layer2MosaicOffsetV, layer2MosaicFlipX, layer2MosaicFlipY, layer2MosaicMirrorRotation,
    layer3MosaicOffsetU, layer3MosaicOffsetV, layer3MosaicFlipX, layer3MosaicFlipY, layer3MosaicMirrorRotation,
    onMaterialChange,
  ]);

  // Background CSS for the Canvas wrapper — honours the Background
  // folder's mode + color(s) + gradient angle. When mode is
  // "transparent" we emit an empty string so the page's own bg shows
  // through; Canvas itself always renders with its alpha-capable gl
  // context (scene.background is intentionally NOT set, so the
  // wrapper CSS wins). Gradient angle is in CSS convention (0° = to
  // top), so the Leva 0-360 slider maps 1:1.
  const wrapperBackground = useMemo(() => {
    // UV blacklight overrides whatever Background mode the user had
    // configured. A light / gradient bg ruins the effect since the
    // fluorescent layers need to read against near-black for the
    // glow to pop. Force a deep-violet tint regardless.
    if (isUV) return "#07021a";
    if (backgroundMode === "transparent") return "transparent";
    if (backgroundMode === "gradient") {
      return `linear-gradient(${backgroundAngle}deg, ${backgroundColor1}, ${backgroundColor2})`;
    }
    return backgroundColor1;
  }, [isUV, backgroundMode, backgroundColor1, backgroundColor2, backgroundAngle]);

  // Resolve the HDRI preset. "kominka" is our custom EXR dropped into
  // public/hdri at load time; every other value is one of drei's
  // bundled preset names and goes through the `preset` prop.
  const hdriIsCustom = lighting === "kominka";
  const hdriPreset = resolveEnvironmentPreset(
    hdriIsCustom ? "studio" : (lighting as BagLighting)
  );

  // Three.js tone mapping curve — dropdown value is a short string
  // matched against a lookup table. Fall back to ACES if Leva ever
  // feeds something unexpected.
  const toneMapping =
    TONE_MAPPING_MAP[toneMappingCurve as string] ?? THREE.ACESFilmicToneMapping;

  return (
    <>
      <div
        // Wrapper that owns the CSS background so we can do gradients
        // without forcing the Canvas to rebuild. Canvas itself keeps
        // its default alpha-capable gl context; scene.background is
        // NOT set (we drop the `<color attach="background">` below)
        // so whatever the wrapper shows through reads as the scene's
        // sky. Takes 100% of the parent's box so nothing changes in
        // the page layout.
        style={{
          width: "100%",
          height: "100%",
          background: wrapperBackground,
        }}
      >
    <Canvas
      camera={{ position: [0, -0.3, 4.5], fov: 42 }}
      gl={{
        antialias: true,
        toneMapping,
        toneMappingExposure,
        preserveDrawingBuffer: true,
        alpha: true,
      }}
      shadows={shadowsEnabled}
      dpr={[1, 2]}
      style={{ width: "100%", height: "100%" }}
    >
      {/* Fog — optional, additive to the scene. Linear near/far style
          (not exponential) so the Leva sliders map 1:1 to world units. */}
      {fogEnabled && <fog attach="fog" args={[fogColor as string, fogNear as number, fogFar as number]} />}
      {/* Ambient is user-controllable now. Rave and UV presets override
          ambient — Rave wants coloured point lights to dominate, UV
          wants a dark-purple wash so non-fluorescent surfaces recede.
          In every other mode the Lighting → Ambient slider sets the
          value, further scaled by Dim's 0.2 multiplier and coloured
          per the Ambient folder's colour picker. */}
      {!isRave && !isUV && (
        <ambientLight
          intensity={ambientIntensity * dimScale}
          color={ambientColor as string}
        />
      )}

      <Suspense fallback={null}>
        {isRave ? (
          <>
            <RaveLights />
            {/* Turned way down — keeps colored lights dominant on reflections */}
            <Environment preset="studio" background={false} environmentIntensity={0.22 * envIntensity} />
          </>
        ) : isUV ? (
          // No Environment at all — every foil/chrome/prismatic shader
          // self-illuminates bright colours regardless of HDRI
          // intensity, so the only way to truly kill white reflections
          // is to drop the IBL entirely. BagMesh swaps the Layer 1
          // material to a plain dark diffuse under UV lighting so the
          // body absorbs everything except the violet point lights.
          <UVLights />
        ) : hdriIsCustom ? (
          <Environment
            files="/hdri/studio_kominka_01_1k.hdr"
            environmentIntensity={dimScale * envIntensity}
          />
        ) : (
          <Environment
            preset={hdriPreset}
            environmentIntensity={dimScale * envIntensity}
          />
        )}

        {isSmoke && (
          <>
            <SmokeLights />
            <SmokeBackground />
          </>
        )}

        {isDim && <RainbowLights />}

        {/* User-configured spotlights — additive on top of whatever the
            HDRI + scene preset contribute. Rendered conditionally on the
            spotCount slider so unused lights never hit the GPU. Each
            spot uses fixed angle/penumbra/distance/decay so the user
            doesn't have to tune those by hand; position, colour, and
            intensity are the expressive knobs. */}
        {spotCount >= 1 && (
          <spotLight
            position={[spot1Pos.x, spot1Pos.y, spot1Pos.z]}
            intensity={spot1Intensity}
            color={spot1Color}
            angle={0.5}
            penumbra={0.8}
            distance={14}
            decay={2}
            castShadow={shadowsEnabled}
            shadow-mapSize-width={shadowMapSize as number}
            shadow-mapSize-height={shadowMapSize as number}
            shadow-radius={shadowRadius as number}
          />
        )}
        {spotCount >= 2 && (
          <spotLight
            position={[spot2Pos.x, spot2Pos.y, spot2Pos.z]}
            intensity={spot2Intensity}
            color={spot2Color}
            angle={0.5}
            penumbra={0.8}
            distance={14}
            decay={2}
            castShadow={shadowsEnabled}
            shadow-mapSize-width={shadowMapSize as number}
            shadow-mapSize-height={shadowMapSize as number}
            shadow-radius={shadowRadius as number}
          />
        )}
        {spotCount >= 3 && (
          <spotLight
            position={[spot3Pos.x, spot3Pos.y, spot3Pos.z]}
            intensity={spot3Intensity}
            color={spot3Color}
            angle={0.5}
            penumbra={0.8}
            distance={14}
            decay={2}
            castShadow={shadowsEnabled}
            shadow-mapSize-width={shadowMapSize as number}
            shadow-mapSize-height={shadowMapSize as number}
            shadow-radius={shadowRadius as number}
          />
        )}
        {spotCount >= 4 && (
          <spotLight
            position={[spot4Pos.x, spot4Pos.y, spot4Pos.z]}
            intensity={spot4Intensity}
            color={spot4Color}
            angle={0.5}
            penumbra={0.8}
            distance={14}
            decay={2}
            castShadow={shadowsEnabled}
            shadow-mapSize-width={shadowMapSize as number}
            shadow-mapSize-height={shadowMapSize as number}
            shadow-radius={shadowRadius as number}
          />
        )}

        {/* Directional lights — sun/strong key-light style. Parallel
            rays, distance-independent. Auto-aimed at origin via default
            target position (three.js convention). */}
        {dirCount >= 1 && (
          <directionalLight
            position={[dir1Pos.x, dir1Pos.y, dir1Pos.z]}
            intensity={dir1Intensity}
            color={dir1Color}
            castShadow={shadowsEnabled}
            shadow-mapSize-width={shadowMapSize as number}
            shadow-mapSize-height={shadowMapSize as number}
            shadow-radius={shadowRadius as number}
            // Expand the orthographic shadow camera so a single
            // directional light can cover the whole scene — default
            // is a 4-unit box around origin which clips shadows for
            // anything more than ~2 units away.
            shadow-camera-left={-6}
            shadow-camera-right={6}
            shadow-camera-top={6}
            shadow-camera-bottom={-6}
          />
        )}
        {dirCount >= 2 && (
          <directionalLight
            position={[dir2Pos.x, dir2Pos.y, dir2Pos.z]}
            intensity={dir2Intensity}
            color={dir2Color}
            castShadow={shadowsEnabled}
            shadow-mapSize-width={shadowMapSize as number}
            shadow-mapSize-height={shadowMapSize as number}
            shadow-radius={shadowRadius as number}
            shadow-camera-left={-6}
            shadow-camera-right={6}
            shadow-camera-top={6}
            shadow-camera-bottom={-6}
          />
        )}

        {/* Point lights — omnidirectional, distance falloff. Useful as
            practical / accent lights around the scene. No shadows (too
            expensive with multiple point lights; enable manually via
            DevTools if needed). */}
        {pointCount >= 1 && (
          <pointLight
            position={[point1Pos.x, point1Pos.y, point1Pos.z]}
            intensity={point1Intensity}
            color={point1Color}
            distance={14}
            decay={2}
          />
        )}
        {pointCount >= 2 && (
          <pointLight
            position={[point2Pos.x, point2Pos.y, point2Pos.z]}
            intensity={point2Intensity}
            color={point2Color}
            distance={14}
            decay={2}
          />
        )}
        {pointCount >= 3 && (
          <pointLight
            position={[point3Pos.x, point3Pos.y, point3Pos.z]}
            intensity={point3Intensity}
            color={point3Color}
            distance={14}
            decay={2}
          />
        )}
        {pointCount >= 4 && (
          <pointLight
            position={[point4Pos.x, point4Pos.y, point4Pos.z]}
            intensity={point4Intensity}
            color={point4Color}
            distance={14}
            decay={2}
          />
        )}

        {/* Rect-area lights — flat "softbox" emitters. Width/height
            scale the emissive surface; XY position is set via the
            top-down drag map in the Lighting sidebar, Z is a slider.
            Each one auto-aims at world origin so the whole bag is
            always in frame. No shadows (WebGL limitation on area
            lights). */}
        {rectCount >= 1 && (
          <AimedRectAreaLight
            position={[rect1X, rect1Y, rect1Z]}
            color={rect1Color}
            intensity={rect1Intensity}
            width={rect1Width}
            height={rect1Height}
          />
        )}
        {rectCount >= 2 && (
          <AimedRectAreaLight
            position={[rect2X, rect2Y, rect2Z]}
            color={rect2Color}
            intensity={rect2Intensity}
            width={rect2Width}
            height={rect2Height}
          />
        )}
        {rectCount >= 3 && (
          <AimedRectAreaLight
            position={[rect3X, rect3Y, rect3Z]}
            color={rect3Color}
            intensity={rect3Intensity}
            width={rect3Width}
            height={rect3Height}
          />
        )}
        {rectCount >= 4 && (
          <AimedRectAreaLight
            position={[rect4X, rect4Y, rect4Z]}
            color={rect4Color}
            intensity={rect4Intensity}
            width={rect4Width}
            height={rect4Height}
          />
        )}

        {/* Mirrored twins — one per active rect light, positioned at
            the opposite Z so the back panel's artwork receives the
            same illumination as the front. Each still looks at origin
            (via AimedRectAreaLight's lookAt), so the emitter points
            at the bag from behind. Intensity is matched, not halved,
            since rect lights only hit surfaces whose normals face
            them; the front rect lights only light the front normals
            and the back rect lights only light the back normals, so
            there's no double-counting on either panel. */}
        {rectBothSides && rectCount >= 1 && (
          <AimedRectAreaLight
            position={[rect1X, rect1Y, -rect1Z]}
            color={rect1Color}
            intensity={rect1Intensity}
            width={rect1Width}
            height={rect1Height}
          />
        )}
        {rectBothSides && rectCount >= 2 && (
          <AimedRectAreaLight
            position={[rect2X, rect2Y, -rect2Z]}
            color={rect2Color}
            intensity={rect2Intensity}
            width={rect2Width}
            height={rect2Height}
          />
        )}
        {rectBothSides && rectCount >= 3 && (
          <AimedRectAreaLight
            position={[rect3X, rect3Y, -rect3Z]}
            color={rect3Color}
            intensity={rect3Intensity}
            width={rect3Width}
            height={rect3Height}
          />
        )}
        {rectBothSides && rectCount >= 4 && (
          <AimedRectAreaLight
            position={[rect4X, rect4Y, -rect4Z]}
            color={rect4Color}
            intensity={rect4Intensity}
            width={rect4Width}
            height={rect4Height}
          />
        )}

        {model === "bag" ? (
          <BagMesh
            textureUrl={textureUrl}
            backTextureUrl={backTextureUrl}
            metalness={bagProps.metalness}
            roughness={bagProps.roughness}
            color={bagColor}
            labelMetalness={labelMetalness}
            labelRoughness={labelRoughness}
            labelVarnish={labelVarnish}
            labelTactile={labelTactile}
            labelMaterial={labelMaterial}
            // Per-layer Material finish — only read when labelMaterial is on.
            // When the user picks e.g. "Multi-Chrome" here, Layer 2's artwork
            // alpha becomes a multi-chrome cutout regardless of Layer 1's
            // finish. Defaults are ignored when the checkbox is off.
            labelMatFinish={labelMatFinish as BagFinish}
            labelMatMetalness={labelMatMetalness}
            labelMatRoughness={labelMatRoughness}
            // Layer 3 — second artwork layer stacked on top of Layer 2.
            // Parented to the same front/back panels so uploaded art reads
            // on both sides of the bag, one polygon-offset step deeper than
            // Layer 2 so the two never z-fight.
            layer3FrontTextureUrl={layer3FrontTextureUrl}
            layer3BackTextureUrl={layer3BackTextureUrl}
            layer3Metalness={layer3Metalness}
            layer3Roughness={layer3Roughness}
            layer3Varnish={layer3Varnish}
            layer3Tactile={layer3Tactile}
            layer3Material={layer3Material}
            layer3MatFinish={layer3MatFinish as BagFinish}
            layer3MatMetalness={layer3MatMetalness}
            layer3MatRoughness={layer3MatRoughness}
            iridescence={preset?.iridescence ?? 0}
            iridescenceIOR={preset?.iridescenceIOR ?? 1.5}
            iridescenceThicknessRange={preset?.iridescenceThicknessRange ?? [100, 800]}
            finish={finish}
            lighting={lighting as BagLighting}
            labelUV={labelUV}
            layer3UV={layer3UV}
            envIntensityScale={dimScale * envIntensity}
            floating={environment !== "smoke"}
            mosaicSourceUrl={mosaicSourceUrl}
            mosaicMirror={mosaicMirror as boolean}
            mosaicZoom={mosaicZoom as number}
            mosaicOffsetU={mosaicOffsetU as number}
            mosaicOffsetV={mosaicOffsetV as number}
            mosaicFlipX={mosaicFlipX as boolean}
            mosaicFlipY={mosaicFlipY as boolean}
            labelMosaicOffsetU={labelMosaicOffsetU as number}
            labelMosaicOffsetV={labelMosaicOffsetV as number}
            labelMosaicFlipX={labelMosaicFlipX as boolean}
            labelMosaicFlipY={labelMosaicFlipY as boolean}
            layer3MosaicOffsetU={layer3MosaicOffsetU as number}
            layer3MosaicOffsetV={layer3MosaicOffsetV as number}
            layer3MosaicFlipX={layer3MosaicFlipX as boolean}
            layer3MosaicFlipY={layer3MosaicFlipY as boolean}
          />
        ) : (
          <SupplementJarMesh
            // Layer 1 — base label material. Identical to bag's Surface.
            // Uses the preset-resolved values (bagProps) so matte/gloss/satin
            // read correctly — the raw Leva metalness/roughness only apply
            // when finish === "custom".
            finish={finish as BagFinish}
            labelColor={bagColor}
            metalness={bagProps.metalness}
            roughness={bagProps.roughness}
            iridescence={preset?.iridescence ?? 0}
            iridescenceIOR={preset?.iridescenceIOR ?? 1.5}
            iridescenceThicknessRange={preset?.iridescenceThicknessRange ?? [100, 800]}
            // Layer 2 / Layer 3 — transparent artwork decals. The bag's
            // default front/back textures are the pre-baked mylar artwork,
            // which looks wrong scrunched around a cylinder, so we
            // explicitly zero them out in jar mode — the decals stay clear
            // until the user uploads something jar-appropriate.
            layer2TextureUrl={
              textureUrl === DEFAULT_FRONT_TEXTURE ? null : textureUrl
            }
            layer2Metalness={layer2Metalness}
            layer2Roughness={layer2Roughness}
            layer2Varnish={layer2Varnish}
            layer2Tactile={layer2Tactile}
            layer2Material={layer2Material}
            layer2MatFinish={layer2MatFinish as BagFinish}
            layer2MatMetalness={layer2MatMetalness}
            layer2MatRoughness={layer2MatRoughness}
            layer3TextureUrl={
              backTextureUrl === DEFAULT_BACK_TEXTURE ? null : backTextureUrl ?? null
            }
            layer3Metalness={layer3Metalness}
            layer3Roughness={layer3Roughness}
            layer3Varnish={layer3Varnish}
            layer3Tactile={layer3Tactile}
            layer3Material={layer3Material}
            layer3MatFinish={layer3MatFinish as BagFinish}
            layer3MatMetalness={layer3MatMetalness}
            layer3MatRoughness={layer3MatRoughness}
            lighting={lighting as BagLighting}
            layer2UV={layer2UV}
            layer3UV={layer3UV}
            envIntensityScale={dimScale * envIntensity}
            floating={environment !== "smoke"}
            mosaicSourceUrl={mosaicSourceUrl}
            mosaicMirror={mosaicMirror as boolean}
            mosaicZoom={mosaicZoom as number}
            mosaicOffsetU={mosaicOffsetU as number}
            mosaicOffsetV={mosaicOffsetV as number}
            mosaicFlipX={mosaicFlipX as boolean}
            mosaicFlipY={mosaicFlipY as boolean}
            mosaicMirrorRotation={mosaicMirrorRotation as number}
            layer2MosaicOffsetU={layer2MosaicOffsetU as number}
            layer2MosaicOffsetV={layer2MosaicOffsetV as number}
            layer2MosaicFlipX={layer2MosaicFlipX as boolean}
            layer2MosaicFlipY={layer2MosaicFlipY as boolean}
            layer2MosaicMirrorRotation={layer2MosaicMirrorRotation as number}
            layer3MosaicOffsetU={layer3MosaicOffsetU as number}
            layer3MosaicOffsetV={layer3MosaicOffsetV as number}
            layer3MosaicFlipX={layer3MosaicFlipX as boolean}
            layer3MosaicFlipY={layer3MosaicFlipY as boolean}
            layer3MosaicMirrorRotation={layer3MosaicMirrorRotation as number}
          />
        )}

        {isSmoke ? (
          <ReflectiveFloor />
        ) : (
          <ContactShadows
            position={[0, -1.28, 0]}
            opacity={isRave ? 0.8 : 0.5}
            scale={5}
            blur={2.5}
            far={2}
          />
        )}

        {/* Optional real-shadow receiver plane. The fake ContactShadows
            above (or the ReflectiveFloor in Smoke) don't respond to
            direct lights at all — they're view-angle screen-space
            effects. When the user wants true spotlight / directional
            shadows we need an actual geometry with receiveShadow on.
            Using ShadowMaterial so the plane itself is invisible and
            only the projected shadow shows, at user-tuned opacity. */}
        {shadowsEnabled && shadowGround && (
          <mesh
            rotation={[-Math.PI / 2, 0, 0]}
            position={[0, -1.265, 0]}
            receiveShadow
          >
            <planeGeometry args={[40, 40]} />
            <shadowMaterial transparent opacity={shadowOpacity} />
          </mesh>
        )}

        {onScreenshot && (
          <ScreenshotCapture
            onCapture={onScreenshot}
            resetKey={`${textureUrl ?? "default"}|${backTextureUrl ?? "default"}|${environment}`}
            captureRef={captureRef}
            // Mirror the wrapper DIV's background into the capture so
            // gradients + flat fills survive the screenshot. UV forces
            // its deep-violet override the same way the wrapper does,
            // so the thumbnail matches what the user sees on screen.
            background={{
              mode: isUV
                ? "flat"
                : (backgroundMode as "flat" | "gradient" | "transparent"),
              color1: isUV ? "#07021a" : (backgroundColor1 as string),
              color2: backgroundColor2 as string,
              angle: backgroundAngle as number,
            }}
          />
        )}
      </Suspense>

      <OrbitControls
        target={[0, -0.3, 0]}
        autoRotate={autoRotate}
        autoRotateSpeed={1.6}
        enablePan
        enableDamping
        dampingFactor={0.05}
        minDistance={1.8}
        maxDistance={10}
        maxPolarAngle={Math.PI * 0.85}
      />
    </Canvas>
      </div>
    </>
  );
}
