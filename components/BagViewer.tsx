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
import { useControls, folder } from "leva";
import * as THREE from "three";
import BagMesh from "./BagMesh";
import SupplementJarMesh from "./SupplementJarMesh";
import {
  DEFAULT_BACK_TEXTURE,
  DEFAULT_FRONT_TEXTURE,
  FINISH_PRESETS,
  type BagFinish,
  type BagLighting,
  type BagMaterial,
} from "@/lib/bagMaterial";

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
}: BagViewerProps) {
  // Resolved initial values for the Leva schema below. Consulted once at
  // mount — if the page supplies an initialMaterial (e.g. opened from an
  // Outreach slot), these prefill the controls; otherwise the hard-coded
  // defaults take over. Parent forces a remount via a `key` prop when
  // hydration data arrives, so changing initial* mid-session works.
  const iMat = initialMaterial;
  const iEnv = initialEnvironment ?? "default";
  const iModel = initialModel ?? "bag";
  const {
    model,
    finish, metalness, roughness, bagColor,
    autoRotate, lighting, environment,
    ambientIntensity, envIntensity, spotCount,
    spot1Color, spot1Intensity, spot1Pos,
    spot2Color, spot2Intensity, spot2Pos,
    spot3Color, spot3Intensity, spot3Pos,
    spot4Color, spot4Intensity, spot4Pos,
    labelMetalness, labelRoughness, labelVarnish, labelMaterial,
    labelMatFinish, labelMatMetalness, labelMatRoughness,
    layer2Metalness, layer2Roughness, layer2Varnish, layer2Material,
    layer2MatFinish, layer2MatMetalness, layer2MatRoughness,
    layer3Metalness, layer3Roughness, layer3Varnish, layer3Material,
    layer3MatFinish, layer3MatMetalness, layer3MatRoughness,
  } = useControls({
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
      autoRotate: { label: "Auto Rotate", value: false },
      lighting: {
        label: "Lighting", value: iMat?.lighting ?? "studio",
        options: { Studio: "studio", Warehouse: "warehouse", City: "city", Forest: "forest", Sunset: "sunset", Rave: "rave" },
      },
    }, { collapsed: false }),

    // ── Custom lighting ────────────────────────────────────────────────
    // A tuning layer on top of the HDRI preset above. Ambient intensity
    // overrides the hard-coded 0.45 fill; env intensity multiplies the
    // HDRI contribution (0 = disable HDRI entirely). Below that, up to 4
    // user-configured spotlights can be added — each with its own color,
    // intensity, and XYZ position. Spotlights are additive, so they
    // stack on top of whatever the HDRI + environment scene already
    // contributes (Smoke's backlights, Dim's rainbow ring, etc.).
    Lighting: folder({
      ambientIntensity: {
        label: "Ambient", value: 0.45, min: 0, max: 3, step: 0.01,
      },
      envIntensity: {
        label: "HDRI Intensity", value: 1.0, min: 0, max: 3, step: 0.01,
      },
      spotCount: {
        label: "Spotlights", value: 0, min: 0, max: 4, step: 1,
      },
      // Spotlight 1
      spot1Color: {
        label: "S1 Color", value: "#ffffff",
        render: (get) => get("Lighting.spotCount") >= 1,
      },
      spot1Intensity: {
        label: "S1 Intensity", value: 30, min: 0, max: 200, step: 1,
        render: (get) => get("Lighting.spotCount") >= 1,
      },
      spot1Pos: {
        label: "S1 Position", value: { x: -2.5, y: 2.5, z: 3.0 },
        step: 0.1,
        render: (get) => get("Lighting.spotCount") >= 1,
      },
      // Spotlight 2
      spot2Color: {
        label: "S2 Color", value: "#ffd7a8",
        render: (get) => get("Lighting.spotCount") >= 2,
      },
      spot2Intensity: {
        label: "S2 Intensity", value: 30, min: 0, max: 200, step: 1,
        render: (get) => get("Lighting.spotCount") >= 2,
      },
      spot2Pos: {
        label: "S2 Position", value: { x: 2.5, y: 2.5, z: 3.0 },
        step: 0.1,
        render: (get) => get("Lighting.spotCount") >= 2,
      },
      // Spotlight 3
      spot3Color: {
        label: "S3 Color", value: "#a8c9ff",
        render: (get) => get("Lighting.spotCount") >= 3,
      },
      spot3Intensity: {
        label: "S3 Intensity", value: 20, min: 0, max: 200, step: 1,
        render: (get) => get("Lighting.spotCount") >= 3,
      },
      spot3Pos: {
        label: "S3 Position", value: { x: 0, y: 1.0, z: -3.0 },
        step: 0.1,
        render: (get) => get("Lighting.spotCount") >= 3,
      },
      // Spotlight 4
      spot4Color: {
        label: "S4 Color", value: "#ffffff",
        render: (get) => get("Lighting.spotCount") >= 4,
      },
      spot4Intensity: {
        label: "S4 Intensity", value: 20, min: 0, max: 200, step: 1,
        render: (get) => get("Lighting.spotCount") >= 4,
      },
      spot4Pos: {
        label: "S4 Position", value: { x: 0, y: 4.0, z: 0 },
        step: 0.1,
        render: (get) => get("Lighting.spotCount") >= 4,
      },
    }, { collapsed: false }),

    Environment: folder({
      environment: {
        label: "Scene",
        value: iEnv,
        options: { Default: "default", Smoke: "smoke", Dim: "dim" },
      },
    }, { collapsed: false }),
  });

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

  return (
    <Canvas
      camera={{ position: [0, -0.3, 4.5], fov: 42 }}
      gl={{
        antialias: true,
        toneMapping: THREE.ACESFilmicToneMapping,
        toneMappingExposure: isRave ? 1.1 : 1.4,
        preserveDrawingBuffer: true,
      }}
      shadows
      dpr={[1, 2]}
      style={{ width: "100%", height: "100%" }}
    >
      <color attach="background" args={[backgroundColor]} />
      {/* Ambient is user-controllable now. Rave preset still overrides
          ambient to near-zero so the coloured point lights dominate; in
          every other mode the Lighting → Ambient slider sets the value,
          further scaled by Dim's 0.2 multiplier. */}
      {!isRave && <ambientLight intensity={ambientIntensity * dimScale} />}

      <Suspense fallback={null}>
        {isRave ? (
          <>
            <RaveLights />
            {/* Turned way down — keeps colored lights dominant on reflections */}
            <Environment preset="studio" background={false} environmentIntensity={0.22 * envIntensity} />
          </>
        ) : (
          <Environment
            preset={lighting as "studio"}
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
            envIntensityScale={dimScale}
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
            envIntensityScale={dimScale}
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
  );
}
