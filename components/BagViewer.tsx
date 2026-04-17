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
function ScreenshotCapture({
  onCapture,
  resetKey,
  captureRef,
}: {
  onCapture: (url: string) => void;
  resetKey: string;
  /** Imperative capture trigger. Returns the freshly-captured data URL
   *  so callers can grab the newest frame synchronously without waiting
   *  for the React `onCapture` state update to flush. */
  captureRef?: React.MutableRefObject<(() => string | null) | null>;
}) {
  const { gl } = useThree();
  const done = useRef(false);
  const frameCount = useRef(0);

  // Expose an imperative capture function. The return value lets the
  // caller read the data URL in the same tick that the click was
  // received — critical for the Save-to-Outreach flow where we pass
  // the URL into a state update on the very next line.
  useEffect(() => {
    if (captureRef) {
      captureRef.current = () => {
        const url = gl.domElement.toDataURL("image/png");
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
      const url = gl.domElement.toDataURL("image/png");
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
      metalness: {
        label: "Metalness", value: iMat?.metalness ?? 0.92, min: 0, max: 1, step: 0.01,
        render: (get) => get("Surface.finish") === "custom",
      },
      roughness: {
        label: "Roughness", value: iMat?.roughness ?? 0.08, min: 0, max: 1, step: 0.01,
        render: (get) => get("Surface.finish") === "custom",
      },
      bagColor: {
        label: "Bag Color", value: iMat?.bagColor ?? "#c4cdd8",
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
          !get("Layer 2.labelMaterial"),
      },
      labelRoughness: {
        label: "Roughness", value: iMat?.labelRoughness ?? 0.55, min: 0, max: 1, step: 0.01,
        render: (get) =>
          get("Model.model") === "bag" &&
          !get("Layer 2.labelVarnish") &&
          !get("Layer 2.labelMaterial"),
      },
      labelVarnish: {
        label: "Varnish", value: iMat?.labelVarnish ?? false,
        render: (get) =>
          get("Model.model") === "bag" &&
          !get("Layer 2.labelMaterial"),
      },
      labelMaterial: {
        label: "Material", value: iMat?.labelMaterial ?? false,
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
          Custom: "custom",
        },
        render: (get) =>
          get("Model.model") === "bag" &&
          get("Layer 2.labelMaterial"),
      },
      labelMatMetalness: {
        label: "Layer Metalness", value: iMat?.labelMatMetalness ?? 0.92, min: 0, max: 1, step: 0.01,
        render: (get) =>
          get("Model.model") === "bag" &&
          get("Layer 2.labelMaterial") &&
          get("Layer 2.labelMatFinish") === "custom",
      },
      labelMatRoughness: {
        label: "Layer Roughness", value: iMat?.labelMatRoughness ?? 0.08, min: 0, max: 1, step: 0.01,
        render: (get) =>
          get("Model.model") === "bag" &&
          get("Layer 2.labelMaterial") &&
          get("Layer 2.labelMatFinish") === "custom",
      },
      // Jar Layer 2 — artwork-mode metalness / roughness / varnish.
      layer2Metalness: {
        label: "Metalness", value: 0.1, min: 0, max: 1, step: 0.01,
        render: (get) =>
          get("Model.model") === "jar" &&
          !get("Layer 2.layer2Varnish") &&
          !get("Layer 2.layer2Material"),
      },
      layer2Roughness: {
        label: "Roughness", value: 0.5, min: 0, max: 1, step: 0.01,
        render: (get) =>
          get("Model.model") === "jar" &&
          !get("Layer 2.layer2Varnish") &&
          !get("Layer 2.layer2Material"),
      },
      layer2Varnish: {
        label: "Varnish", value: false,
        render: (get) =>
          get("Model.model") === "jar" &&
          !get("Layer 2.layer2Material"),
      },
      layer2Material: {
        label: "Material", value: false,
        render: (get) => get("Model.model") === "jar",
      },
      // Per-layer Material finish (jar Layer 2).
      layer2MatFinish: {
        label: "Layer Finish", value: "metallic",
        options: {
          Metallic: "metallic",
          Matte: "matte",
          Gloss: "gloss",
          Satin: "satin",
          "Holographic Foil": "foil",
          "Prismatic Foil": "prismatic",
          "Multi-Chrome": "multi-chrome",
          Custom: "custom",
        },
        render: (get) =>
          get("Model.model") === "jar" &&
          get("Layer 2.layer2Material"),
      },
      layer2MatMetalness: {
        label: "Layer Metalness", value: 0.92, min: 0, max: 1, step: 0.01,
        render: (get) =>
          get("Model.model") === "jar" &&
          get("Layer 2.layer2Material") &&
          get("Layer 2.layer2MatFinish") === "custom",
      },
      layer2MatRoughness: {
        label: "Layer Roughness", value: 0.08, min: 0, max: 1, step: 0.01,
        render: (get) =>
          get("Model.model") === "jar" &&
          get("Layer 2.layer2Material") &&
          get("Layer 2.layer2MatFinish") === "custom",
      },
    }, { collapsed: false }),

    "Layer 3": folder({
      // Layer 3 controls — shared between bag and jar. Always visible now
      // that the active-layer gating is gone; sub-controls still fold
      // away when they can't contribute (custom sliders only matter with
      // Finish=Custom, etc.).
      layer3Metalness: {
        label: "Metalness", value: 0.1, min: 0, max: 1, step: 0.01,
        render: (get) =>
          !get("Layer 3.layer3Varnish") &&
          !get("Layer 3.layer3Material"),
      },
      layer3Roughness: {
        label: "Roughness", value: 0.5, min: 0, max: 1, step: 0.01,
        render: (get) =>
          !get("Layer 3.layer3Varnish") &&
          !get("Layer 3.layer3Material"),
      },
      layer3Varnish: {
        label: "Varnish", value: false,
        render: (get) => !get("Layer 3.layer3Material"),
      },
      layer3Material: {
        label: "Material", value: false,
      },
      // Per-layer Material finish — revealed when the Material checkbox
      // is on. Shared between bag and jar since Layer 3's render path is
      // model-agnostic in this panel.
      layer3MatFinish: {
        label: "Layer Finish", value: "metallic",
        options: {
          Metallic: "metallic",
          Matte: "matte",
          Gloss: "gloss",
          Satin: "satin",
          "Holographic Foil": "foil",
          "Prismatic Foil": "prismatic",
          "Multi-Chrome": "multi-chrome",
          Custom: "custom",
        },
        render: (get) => get("Layer 3.layer3Material"),
      },
      layer3MatMetalness: {
        label: "Layer Metalness", value: 0.92, min: 0, max: 1, step: 0.01,
        render: (get) =>
          get("Layer 3.layer3Material") &&
          get("Layer 3.layer3MatFinish") === "custom",
      },
      layer3MatRoughness: {
        label: "Layer Roughness", value: 0.08, min: 0, max: 1, step: 0.01,
        render: (get) =>
          get("Layer 3.layer3Material") &&
          get("Layer 3.layer3MatFinish") === "custom",
      },
    }, { collapsed: false }),

    Scene: folder({
      // Auto Rotate stays in the Materials sidebar since it's a
      // camera/view concern rather than a lighting one. The HDRI
      // preset + intensity moved to the Lighting sidebar.
      autoRotate: { label: "Auto Rotate", value: false },
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
        label: "Preset", value: iMat?.lighting ?? "studio",
        options: {
          Studio: "studio",
          Warehouse: "warehouse",
          City: "city",
          Forest: "forest",
          Sunset: "sunset",
          Rave: "rave",
          "Kominka Studio (custom)": "kominka",
        },
      },
      envIntensity: {
        // Physical upper bound on a MeshPhysicalMaterial's
        // envMapIntensity is effectively infinity — anything beyond
        // the HDRI's brightest peak just looks clipped. Capping at
        // 10 lets users push well past "natural" for dramatic
        // mirror effects without giving them a slider that divides
        // by zero. Use Tone Mapping → Exposure to compensate.
        label: "HDRI Intensity", value: iLighting.envIntensity, min: 0, max: 10, step: 0.01,
      },
    }, { collapsed: false }),

    "Tone Mapping": folder({
      toneMappingCurve: {
        label: "Curve", value: "aces",
        options: {
          "ACES Filmic": "aces",
          AgX: "agx",
          Cineon: "cineon",
          Reinhard: "reinhard",
          Linear: "linear",
          None: "none",
        },
      },
      // Exposure is a linear pre-multiplier on all colour before
      // tone mapping — 1.0 is neutral, <1 dims, >1 boosts. 8 is
      // well past the point where ACES visibly clips highlights,
      // which is usually what you want for a "hot" studio look.
      toneMappingExposure: {
        label: "Exposure", value: 1.4, min: 0.1, max: 8, step: 0.01,
      },
    }, { collapsed: true }),

    Background: folder({
      backgroundMode: {
        label: "Mode", value: "flat",
        options: { Flat: "flat", Gradient: "gradient", Transparent: "transparent" },
      },
      backgroundColor1: {
        label: "Color 1", value: "#eef1f8",
        render: (get) => get("Background.backgroundMode") !== "transparent",
      },
      backgroundColor2: {
        label: "Color 2", value: "#c4cdd8",
        render: (get) => get("Background.backgroundMode") === "gradient",
      },
      backgroundAngle: {
        label: "Angle (deg)", value: 180, min: 0, max: 360, step: 1,
        render: (get) => get("Background.backgroundMode") === "gradient",
      },
    }, { collapsed: true }),

    Fog: folder({
      fogEnabled: { label: "Enabled", value: false },
      fogColor: {
        label: "Color", value: "#cccccc",
        render: (get) => get("Fog.fogEnabled"),
      },
      fogNear: {
        label: "Near", value: 2, min: 0, max: 20, step: 0.1,
        render: (get) => get("Fog.fogEnabled"),
      },
      fogFar: {
        label: "Far", value: 10, min: 0, max: 50, step: 0.1,
        render: (get) => get("Fog.fogEnabled"),
      },
    }, { collapsed: true }),

    Shadows: folder({
      shadowsEnabled: { label: "Enabled", value: false },
      // Real (direct-light) shadows need a surface to land on. The
      // mylar bag itself casts, but without a ground plane there's
      // nothing to receive — shadows just disappear into the sky.
      // This toggle mounts a large invisible plane at the bag's
      // base elevation (y = -1.265) with `receiveShadow` on; it
      // doesn't render otherwise so the background (flat /
      // gradient / transparent) keeps showing through. Kept visible
      // regardless of the Enabled toggle so users can find it and
      // understand what it does before flipping shadows on.
      shadowGround: {
        label: "Ground Plane",
        value: true,
      },
      shadowOpacity: {
        label: "Ground Opacity", value: 0.35, min: 0, max: 1, step: 0.01,
        render: (get) => get("Shadows.shadowGround"),
      },
      shadowMapSize: {
        label: "Map Size", value: 1024,
        options: { "Low (512)": 512, "Medium (1024)": 1024, "High (2048)": 2048, "Ultra (4096)": 4096 },
        render: (get) => get("Shadows.shadowsEnabled"),
      },
      shadowRadius: {
        label: "Softness", value: 4, min: 0, max: 16, step: 0.1,
        render: (get) => get("Shadows.shadowsEnabled"),
      },
    }, { collapsed: true }),

    Ambient: folder({
      ambientIntensity: {
        label: "Intensity", value: iLighting.ambientIntensity, min: 0, max: 3, step: 0.01,
      },
      ambientColor: { label: "Color", value: "#ffffff" },
    }, { collapsed: false }),

    "Directional Lights": folder({
      dirCount: { label: "Count", value: 0, min: 0, max: 2, step: 1 },
      dir1Color: {
        label: "D1 Color", value: "#ffffff",
        render: (get) => get("Directional Lights.dirCount") >= 1,
      },
      dir1Intensity: {
        label: "D1 Intensity", value: 2, min: 0, max: 10, step: 0.1,
        render: (get) => get("Directional Lights.dirCount") >= 1,
      },
      dir1Pos: {
        label: "D1 Position", value: { x: 3, y: 5, z: 3 }, step: 0.1,
        render: (get) => get("Directional Lights.dirCount") >= 1,
      },
      dir2Color: {
        label: "D2 Color", value: "#e8d8ff",
        render: (get) => get("Directional Lights.dirCount") >= 2,
      },
      dir2Intensity: {
        label: "D2 Intensity", value: 1, min: 0, max: 10, step: 0.1,
        render: (get) => get("Directional Lights.dirCount") >= 2,
      },
      dir2Pos: {
        label: "D2 Position", value: { x: -3, y: 5, z: -3 }, step: 0.1,
        render: (get) => get("Directional Lights.dirCount") >= 2,
      },
    }, { collapsed: true }),

    Spotlights: folder({
      spotCount: {
        label: "Count", value: iLighting.spotCount, min: 0, max: 4, step: 1,
      },
      spot1Color: {
        label: "S1 Color", value: iLighting.spot1Color,
        render: (get) => get("Spotlights.spotCount") >= 1,
      },
      spot1Intensity: {
        label: "S1 Intensity", value: iLighting.spot1Intensity, min: 0, max: 200, step: 1,
        render: (get) => get("Spotlights.spotCount") >= 1,
      },
      spot1Pos: {
        label: "S1 Position", value: iLighting.spot1Pos, step: 0.1,
        render: (get) => get("Spotlights.spotCount") >= 1,
      },
      spot2Color: {
        label: "S2 Color", value: iLighting.spot2Color,
        render: (get) => get("Spotlights.spotCount") >= 2,
      },
      spot2Intensity: {
        label: "S2 Intensity", value: iLighting.spot2Intensity, min: 0, max: 200, step: 1,
        render: (get) => get("Spotlights.spotCount") >= 2,
      },
      spot2Pos: {
        label: "S2 Position", value: iLighting.spot2Pos, step: 0.1,
        render: (get) => get("Spotlights.spotCount") >= 2,
      },
      spot3Color: {
        label: "S3 Color", value: iLighting.spot3Color,
        render: (get) => get("Spotlights.spotCount") >= 3,
      },
      spot3Intensity: {
        label: "S3 Intensity", value: iLighting.spot3Intensity, min: 0, max: 200, step: 1,
        render: (get) => get("Spotlights.spotCount") >= 3,
      },
      spot3Pos: {
        label: "S3 Position", value: iLighting.spot3Pos, step: 0.1,
        render: (get) => get("Spotlights.spotCount") >= 3,
      },
      spot4Color: {
        label: "S4 Color", value: iLighting.spot4Color,
        render: (get) => get("Spotlights.spotCount") >= 4,
      },
      spot4Intensity: {
        label: "S4 Intensity", value: iLighting.spot4Intensity, min: 0, max: 200, step: 1,
        render: (get) => get("Spotlights.spotCount") >= 4,
      },
      spot4Pos: {
        label: "S4 Position", value: iLighting.spot4Pos, step: 0.1,
        render: (get) => get("Spotlights.spotCount") >= 4,
      },
    }, { collapsed: false }),

    "Point Lights": folder({
      pointCount: { label: "Count", value: 0, min: 0, max: 4, step: 1 },
      point1Color: {
        label: "P1 Color", value: "#ffffff",
        render: (get) => get("Point Lights.pointCount") >= 1,
      },
      point1Intensity: {
        label: "P1 Intensity", value: 20, min: 0, max: 200, step: 1,
        render: (get) => get("Point Lights.pointCount") >= 1,
      },
      point1Pos: {
        label: "P1 Position", value: { x: 2, y: 2, z: 2 }, step: 0.1,
        render: (get) => get("Point Lights.pointCount") >= 1,
      },
      point2Color: {
        label: "P2 Color", value: "#ffaa88",
        render: (get) => get("Point Lights.pointCount") >= 2,
      },
      point2Intensity: {
        label: "P2 Intensity", value: 20, min: 0, max: 200, step: 1,
        render: (get) => get("Point Lights.pointCount") >= 2,
      },
      point2Pos: {
        label: "P2 Position", value: { x: -2, y: 2, z: 2 }, step: 0.1,
        render: (get) => get("Point Lights.pointCount") >= 2,
      },
      point3Color: {
        label: "P3 Color", value: "#88aaff",
        render: (get) => get("Point Lights.pointCount") >= 3,
      },
      point3Intensity: {
        label: "P3 Intensity", value: 20, min: 0, max: 200, step: 1,
        render: (get) => get("Point Lights.pointCount") >= 3,
      },
      point3Pos: {
        label: "P3 Position", value: { x: 0, y: 2, z: -3 }, step: 0.1,
        render: (get) => get("Point Lights.pointCount") >= 3,
      },
      point4Color: {
        label: "P4 Color", value: "#ffffff",
        render: (get) => get("Point Lights.pointCount") >= 4,
      },
      point4Intensity: {
        label: "P4 Intensity", value: 20, min: 0, max: 200, step: 1,
        render: (get) => get("Point Lights.pointCount") >= 4,
      },
      point4Pos: {
        label: "P4 Position", value: { x: 0, y: 3, z: 0 }, step: 0.1,
        render: (get) => get("Point Lights.pointCount") >= 4,
      },
    }, { collapsed: true }),

    "Rect Area Lights": folder({
      // Rect lights emit in a single direction (toward their target —
      // here, world origin). A light positioned in front of the bag
      // therefore illuminates only the front-facing artwork; the
      // back stays dark, which is physically correct but breaks the
      // "I want a product-photo preview where both sides read" UX.
      // When this toggle is on, every active rect light gets a mirror
      // twin at `z = -z` that also aims at origin — net effect: the
      // back panel's artwork picks up the same light(s) the front
      // does, no need to add matching rect lights by hand on both
      // sides. Turn off for physically-accurate single-side lighting.
      rectBothSides: {
        label: "Wrap Both Sides", value: true,
      },
      rectCount: { label: "Count", value: 0, min: 0, max: 4, step: 1 },
      // Rect 1
      rect1Color: {
        label: "R1 Color", value: "#ffffff",
        render: (get) => get("Rect Area Lights.rectCount") >= 1,
      },
      rect1Intensity: {
        label: "R1 Intensity", value: 12, min: 0, max: 100, step: 0.5,
        render: (get) => get("Rect Area Lights.rectCount") >= 1,
      },
      rect1Width: {
        label: "R1 Width", value: 2, min: 0.1, max: 10, step: 0.1,
        render: (get) => get("Rect Area Lights.rectCount") >= 1,
      },
      rect1Height: {
        label: "R1 Height", value: 2, min: 0.1, max: 10, step: 0.1,
        render: (get) => get("Rect Area Lights.rectCount") >= 1,
      },
      // XY are primarily driven by the top-down drag map below the
      // Leva panel, but we surface them as sliders too so the user
      // has a numeric fallback. Z is slider-only.
      rect1X: {
        label: "R1 X", value: -2, min: -6, max: 6, step: 0.05,
        render: (get) => get("Rect Area Lights.rectCount") >= 1,
      },
      rect1Y: {
        label: "R1 Y", value: 0, min: -6, max: 6, step: 0.05,
        render: (get) => get("Rect Area Lights.rectCount") >= 1,
      },
      rect1Z: {
        label: "R1 Z (height)", value: 3, min: -6, max: 6, step: 0.05,
        render: (get) => get("Rect Area Lights.rectCount") >= 1,
      },
      // Rect 2
      rect2Color: {
        label: "R2 Color", value: "#fff2d8",
        render: (get) => get("Rect Area Lights.rectCount") >= 2,
      },
      rect2Intensity: {
        label: "R2 Intensity", value: 10, min: 0, max: 100, step: 0.5,
        render: (get) => get("Rect Area Lights.rectCount") >= 2,
      },
      rect2Width: {
        label: "R2 Width", value: 2, min: 0.1, max: 10, step: 0.1,
        render: (get) => get("Rect Area Lights.rectCount") >= 2,
      },
      rect2Height: {
        label: "R2 Height", value: 2, min: 0.1, max: 10, step: 0.1,
        render: (get) => get("Rect Area Lights.rectCount") >= 2,
      },
      rect2X: {
        label: "R2 X", value: 2, min: -6, max: 6, step: 0.05,
        render: (get) => get("Rect Area Lights.rectCount") >= 2,
      },
      rect2Y: {
        label: "R2 Y", value: 0, min: -6, max: 6, step: 0.05,
        render: (get) => get("Rect Area Lights.rectCount") >= 2,
      },
      rect2Z: {
        label: "R2 Z (height)", value: 3, min: -6, max: 6, step: 0.05,
        render: (get) => get("Rect Area Lights.rectCount") >= 2,
      },
      // Rect 3
      rect3Color: {
        label: "R3 Color", value: "#d8e8ff",
        render: (get) => get("Rect Area Lights.rectCount") >= 3,
      },
      rect3Intensity: {
        label: "R3 Intensity", value: 8, min: 0, max: 100, step: 0.5,
        render: (get) => get("Rect Area Lights.rectCount") >= 3,
      },
      rect3Width: {
        label: "R3 Width", value: 2, min: 0.1, max: 10, step: 0.1,
        render: (get) => get("Rect Area Lights.rectCount") >= 3,
      },
      rect3Height: {
        label: "R3 Height", value: 2, min: 0.1, max: 10, step: 0.1,
        render: (get) => get("Rect Area Lights.rectCount") >= 3,
      },
      rect3X: {
        label: "R3 X", value: 0, min: -6, max: 6, step: 0.05,
        render: (get) => get("Rect Area Lights.rectCount") >= 3,
      },
      rect3Y: {
        label: "R3 Y", value: -3, min: -6, max: 6, step: 0.05,
        render: (get) => get("Rect Area Lights.rectCount") >= 3,
      },
      rect3Z: {
        label: "R3 Z (height)", value: 2, min: -6, max: 6, step: 0.05,
        render: (get) => get("Rect Area Lights.rectCount") >= 3,
      },
      // Rect 4
      rect4Color: {
        label: "R4 Color", value: "#ffffff",
        render: (get) => get("Rect Area Lights.rectCount") >= 4,
      },
      rect4Intensity: {
        label: "R4 Intensity", value: 6, min: 0, max: 100, step: 0.5,
        render: (get) => get("Rect Area Lights.rectCount") >= 4,
      },
      rect4Width: {
        label: "R4 Width", value: 2, min: 0.1, max: 10, step: 0.1,
        render: (get) => get("Rect Area Lights.rectCount") >= 4,
      },
      rect4Height: {
        label: "R4 Height", value: 2, min: 0.1, max: 10, step: 0.1,
        render: (get) => get("Rect Area Lights.rectCount") >= 4,
      },
      rect4X: {
        label: "R4 X", value: 0, min: -6, max: 6, step: 0.05,
        render: (get) => get("Rect Area Lights.rectCount") >= 4,
      },
      rect4Y: {
        label: "R4 Y", value: 3, min: -6, max: 6, step: 0.05,
        render: (get) => get("Rect Area Lights.rectCount") >= 4,
      },
      rect4Z: {
        label: "R4 Z (height)", value: 4, min: -6, max: 6, step: 0.05,
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
    labelMetalness, labelRoughness, labelVarnish, labelMaterial,
    labelMatFinish, labelMatMetalness, labelMatRoughness,
    layer2Metalness, layer2Roughness, layer2Varnish, layer2Material,
    layer2MatFinish, layer2MatMetalness, layer2MatRoughness,
    layer3Metalness, layer3Roughness, layer3Varnish, layer3Material,
    layer3MatFinish, layer3MatMetalness, layer3MatRoughness,
  } = values;

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
  const lightingValuesRef = useRef<SavedLighting>({
    ambientIntensity, envIntensity, spotCount,
    spot1Color, spot1Intensity, spot1Pos,
    spot2Color, spot2Intensity, spot2Pos,
    spot3Color, spot3Intensity, spot3Pos,
    spot4Color, spot4Intensity, spot4Pos,
  });
  lightingValuesRef.current = {
    ambientIntensity, envIntensity, spotCount,
    spot1Color, spot1Intensity, spot1Pos,
    spot2Color, spot2Intensity, spot2Pos,
    spot3Color, spot3Intensity, spot3Pos,
    spot4Color, spot4Intensity, spot4Pos,
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
  // (or fall back to LIGHTING_DEFAULTS). The first run on mount
  // sets the values the factory already seeded — harmless double-set.
  // Unsaved edits in the previous env are intentionally discarded;
  // users commit with SAVE before switching.
  useEffect(() => {
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

  const preset =
    finish === "custom"
      ? null
      : FINISH_PRESETS[finish as Exclude<BagFinish, "custom">] ?? FINISH_PRESETS.metallic;
  const bagProps = preset
    ? { metalness: preset.metalness, roughness: preset.roughness }
    : { metalness, roughness };

  const isRave = lighting === "rave";
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
      labelMaterial,
      labelMatFinish: labelMatFinish as BagFinish,
      labelMatMetalness,
      labelMatRoughness,
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
    labelMaterial,
    labelMatFinish,
    labelMatMetalness,
    labelMatRoughness,
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
    if (backgroundMode === "transparent") return "transparent";
    if (backgroundMode === "gradient") {
      return `linear-gradient(${backgroundAngle}deg, ${backgroundColor1}, ${backgroundColor2})`;
    }
    return backgroundColor1;
  }, [backgroundMode, backgroundColor1, backgroundColor2, backgroundAngle]);

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
      {/* Ambient is user-controllable now. Rave preset still overrides
          ambient to near-zero so the coloured point lights dominate; in
          every other mode the Lighting → Ambient slider sets the value,
          further scaled by Dim's 0.2 multiplier and coloured per the
          Ambient folder's colour picker. */}
      {!isRave && (
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
            layer3Material={layer3Material}
            layer3MatFinish={layer3MatFinish as BagFinish}
            layer3MatMetalness={layer3MatMetalness}
            layer3MatRoughness={layer3MatRoughness}
            iridescence={preset?.iridescence ?? 0}
            iridescenceIOR={preset?.iridescenceIOR ?? 1.5}
            iridescenceThicknessRange={preset?.iridescenceThicknessRange ?? [100, 800]}
            finish={finish}
            envIntensityScale={dimScale * envIntensity}
            floating={environment !== "smoke"}
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
            layer3Material={layer3Material}
            layer3MatFinish={layer3MatFinish as BagFinish}
            layer3MatMetalness={layer3MatMetalness}
            layer3MatRoughness={layer3MatRoughness}
            envIntensityScale={dimScale * envIntensity}
            floating={environment !== "smoke"}
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
