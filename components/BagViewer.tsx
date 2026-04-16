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
  captureRef?: React.MutableRefObject<(() => void) | null>;
}) {
  const { gl } = useThree();
  const done = useRef(false);
  const frameCount = useRef(0);

  // Expose an imperative capture function for the "Update" button
  useEffect(() => {
    if (captureRef) {
      captureRef.current = () => {
        const url = gl.domElement.toDataURL("image/png");
        onCapture(url);
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
      </Clouds>
    </group>
  );
}

// Backlight for the smoke scene — a soft white light placed behind the smoke
// volume so the white clouds catch highlights and read as form instead of
// flat fog against the light background.
function SmokeBackLight() {
  return (
    <>
      <pointLight
        position={[0, 0.8, -3.2]}
        intensity={28}
        color="#ffffff"
        distance={10}
        decay={2}
      />
      <pointLight
        position={[-1.6, 0.4, -2.6]}
        intensity={14}
        color="#e8ecf8"
        distance={8}
        decay={2}
      />
      <pointLight
        position={[1.6, 0.4, -2.6]}
        intensity={14}
        color="#f3ecf8"
        distance={8}
        decay={2}
      />
    </>
  );
}

// ── Dim scene lighting + shell ───────────────────────────────────────────────
// Eight warm cream point lights wrapped around the bag — four primary rim
// lights on the cardinal axes plus four softer corner fills — so the dim
// environment still has plenty of shape-defining highlights even after the
// HDRI and ambient are scaled down to 50%. Intensities stay modest; the goal
// is a moody candle-lit read, not a studio bounce.
function DimRimLights() {
  return (
    <>
      {/* Cardinal rims — top, bottom, left, right */}
      <pointLight position={[0, 1.6, 0.8]} intensity={14} color="#fff0d4" distance={8} decay={2} />
      <pointLight position={[0, -1.4, 0.8]} intensity={10} color="#fde9c4" distance={8} decay={2} />
      <pointLight position={[-1.9, 0, 0.8]} intensity={12} color="#fff3d8" distance={8} decay={2} />
      <pointLight position={[1.9, 0, 0.8]} intensity={12} color="#fcebc0" distance={8} decay={2} />

      {/* Corner fills — softer, slightly farther out so the rims dominate */}
      <pointLight position={[-1.4, 1.2, 1.4]} intensity={9} color="#fff5dc" distance={8} decay={2} />
      <pointLight position={[1.4, 1.2, 1.4]} intensity={9} color="#fdeec8" distance={8} decay={2} />
      <pointLight position={[-1.4, -1.0, 1.4]} intensity={8} color="#ffeed0" distance={8} decay={2} />
      <pointLight position={[1.4, -1.0, 1.4]} intensity={8} color="#ffe7c0" distance={8} decay={2} />

      {/* Back fills — warm cream coming from behind the bag, gives the
          aluminum shell something to bounce so silhouettes don't go dead. */}
      <pointLight position={[-1.2, 0.4, -2.2]} intensity={10} color="#ffe9c4" distance={9} decay={2} />
      <pointLight position={[1.2, 0.4, -2.2]} intensity={10} color="#fff0d4" distance={9} decay={2} />
    </>
  );
}

// Soft cream ground plane for the Dim scene. Sits at the same y as the
// contact-shadow plane so the bag/jar look like they're floating just above
// it, matching the Default scene's grounding. Roughness is high so the plane
// reads as a soft surface rather than a polished floor — the Smoke scene is
// where the mirror floor lives.
function DimFloor() {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -1.28, 0]} receiveShadow>
      <planeGeometry args={[40, 40]} />
      <meshStandardMaterial
        color="#f6ecd6"
        metalness={0.05}
        roughness={0.9}
      />
    </mesh>
  );
}

// Large aluminum sphere rendered on the inside (THREE.BackSide) so the camera
// sits inside a soft metal shell. Radius is well outside OrbitControls'
// maxDistance (10) so the user can orbit without clipping through. The
// brushed-aluminum finish (metalness 0.9, roughness 0.35) provides subtle
// grey surroundings that catch the dim cream lights and give the bag's
// reflections something besides the flat background to land on.
function AluminumShell() {
  return (
    <mesh>
      <sphereGeometry args={[14, 48, 32]} />
      <meshStandardMaterial
        color="#b8bcc3"
        metalness={0.7}
        roughness={0.1}
        side={THREE.BackSide}
      />
    </mesh>
  );
}

// Softly-polished floor used in the Smoke scene. Roughness 0.2 + metalness
// 0.7 with mirror=1 and a moderate blur gives a strong but diffused cast
// reflection of the bag — polished concrete / brushed chrome rather than
// wet glass. mixStrength stays high so the reflection still reads against
// the light floor tint.
//
// Y position sits right at the bag's bottom so the package appears to stand on
// the plane — tight placement is what gives the base of the bag a clean cast
// reflection rather than a pool of reflection with a floating gap.
function ReflectiveFloor() {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -1.265, 0]} receiveShadow>
      <planeGeometry args={[40, 40]} />
      <MeshReflectorMaterial
        blur={[90, 30]}
        resolution={2048}
        mixBlur={0.8}
        mixStrength={7.0}
        roughness={0.2}
        depthScale={0.8}
        minDepthThreshold={0.2}
        maxDepthThreshold={1.4}
        color="#eef1f8"
        metalness={0.7}
        mirror={1}
      />
    </mesh>
  );
}

interface BagViewerProps {
  textureUrl: string | null;
  /** Back-panel artwork. Null → no back decal. */
  backTextureUrl?: string | null;
  onScreenshot?: (url: string) => void;
  captureRef?: React.MutableRefObject<(() => void) | null>;
  onMaterialChange?: (material: BagMaterial) => void;
  /** Called when the user flips the Model dropdown between bag/jar so the
   *  parent page can re-label upload buttons etc. */
  onModelChange?: (model: "bag" | "jar") => void;
  /** Called when the user changes the Environment dropdown (default/smoke/dim)
   *  so the parent can include the current environment in saves. */
  onEnvironmentChange?: (env: "default" | "smoke" | "dim") => void;
}

export default function BagViewer({
  textureUrl,
  backTextureUrl = null,
  onScreenshot,
  captureRef,
  onMaterialChange,
  onModelChange,
  onEnvironmentChange,
}: BagViewerProps) {
  const {
    model,
    activeLayer,
    finish, metalness, roughness, bagColor,
    autoRotate, lighting, environment,
    labelMetalness, labelRoughness,
    layer2Mode, layer2Metalness, layer2Roughness,
    layer3Mode, layer3Metalness, layer3Roughness,
  } = useControls({
    Model: folder({
      model: {
        label: "Model",
        value: "bag",
        options: {
          "Mylar Bag": "bag",
          "Supplement Jar": "jar",
        },
      },
      // Jar ships with three layers: Layer 1 drives the label's base
      // material (Finish / Color / Metalness / Roughness), Layers 2 & 3 are
      // transparent artwork/foil decals. The dropdown routes the Material
      // Controls panel to whichever layer is being edited.
      activeLayer: {
        label: "Active Layer",
        value: "layer1",
        options: {
          "Layer 1 — Material": "layer1",
          "Layer 2": "layer2",
          "Layer 3": "layer3",
        },
        render: (get) => get("Model.model") === "jar",
      },
    }, { collapsed: false }),

    Surface: folder({
      // For the bag these controls are always visible. For the jar they
      // apply to Layer 1 (the label's base material) and are hidden when
      // the user is editing Layer 2 or Layer 3.
      finish: {
        label: "Finish",
        value: "metallic",
        options: {
          Metallic: "metallic",
          Matte: "matte",
          Gloss: "gloss",
          Satin: "satin",
          "Holographic Foil": "foil",
          "Multi-Chrome": "multi-chrome",
          Custom: "custom",
        },
        render: (get) =>
          get("Model.model") === "bag" ||
          get("Model.activeLayer") === "layer1",
      },
      metalness: {
        label: "Metalness", value: 0.92, min: 0, max: 1, step: 0.01,
        render: (get) =>
          (get("Model.model") === "bag" ||
            get("Model.activeLayer") === "layer1") &&
          get("Surface.finish") === "custom",
      },
      roughness: {
        label: "Roughness", value: 0.08, min: 0, max: 1, step: 0.01,
        render: (get) =>
          (get("Model.model") === "bag" ||
            get("Model.activeLayer") === "layer1") &&
          get("Surface.finish") === "custom",
      },
      bagColor: {
        label: "Bag Color", value: "#c4cdd8",
        render: (get) =>
          get("Model.model") === "bag" ||
          get("Model.activeLayer") === "layer1",
      },
    }, { collapsed: false }),

    Label: folder({
      // Bag-only: label decal metalness/roughness. The jar's layer decals
      // have their own metalness/roughness inside the Layer folders.
      labelMetalness: {
        label: "Metalness", value: 0.1, min: 0, max: 1, step: 0.01,
        render: (get) => get("Model.model") === "bag",
      },
      labelRoughness: {
        label: "Roughness", value: 0.55, min: 0, max: 1, step: 0.01,
        render: (get) => get("Model.model") === "bag",
      },
    }, { collapsed: false }),

    "Layer 2": folder({
      layer2Mode: {
        label: "Mode", value: "artwork",
        options: { Artwork: "artwork", Foil: "foil" },
        render: (get) =>
          get("Model.model") === "jar" &&
          get("Model.activeLayer") === "layer2",
      },
      layer2Metalness: {
        label: "Metalness", value: 0.1, min: 0, max: 1, step: 0.01,
        render: (get) =>
          get("Model.model") === "jar" &&
          get("Model.activeLayer") === "layer2" &&
          get("Layer 2.layer2Mode") === "artwork",
      },
      layer2Roughness: {
        label: "Roughness", value: 0.5, min: 0, max: 1, step: 0.01,
        render: (get) =>
          get("Model.model") === "jar" &&
          get("Model.activeLayer") === "layer2" &&
          get("Layer 2.layer2Mode") === "artwork",
      },
    }, { collapsed: false }),

    "Layer 3": folder({
      layer3Mode: {
        label: "Mode", value: "artwork",
        options: { Artwork: "artwork", Foil: "foil" },
        render: (get) =>
          get("Model.model") === "jar" &&
          get("Model.activeLayer") === "layer3",
      },
      layer3Metalness: {
        label: "Metalness", value: 0.1, min: 0, max: 1, step: 0.01,
        render: (get) =>
          get("Model.model") === "jar" &&
          get("Model.activeLayer") === "layer3" &&
          get("Layer 3.layer3Mode") === "artwork",
      },
      layer3Roughness: {
        label: "Roughness", value: 0.5, min: 0, max: 1, step: 0.01,
        render: (get) =>
          get("Model.model") === "jar" &&
          get("Model.activeLayer") === "layer3" &&
          get("Layer 3.layer3Mode") === "artwork",
      },
    }, { collapsed: false }),

    Scene: folder({
      autoRotate: { label: "Auto Rotate", value: false },
      lighting: {
        label: "Lighting", value: "studio",
        options: { Studio: "studio", Warehouse: "warehouse", City: "city", Forest: "forest", Sunset: "sunset", Rave: "rave" },
      },
    }, { collapsed: true }),

    Environment: folder({
      environment: {
        label: "Scene",
        value: "default",
        options: { Default: "default", Smoke: "smoke", Dim: "dim" },
      },
    }, { collapsed: false }),
  });

  // Suppress unused warning — activeLayer only drives Leva visibility, not
  // the render tree.
  void activeLayer;

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
  // and the bag material's env-map reflections — down to 50%. Rave already
  // has its own explicit intensity for the HDRI, so we don't stack dimming
  // on top of it.
  const dimScale = isDim ? 0.5 : 1;

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
    });
  }, [
    finish,
    metalness,
    roughness,
    bagColor,
    labelMetalness,
    labelRoughness,
    lighting,
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
      {!isRave && <ambientLight intensity={0.45 * dimScale} />}

      <Suspense fallback={null}>
        {isRave ? (
          <>
            <RaveLights />
            {/* Turned way down — keeps colored lights dominant on reflections */}
            <Environment preset="studio" background={false} environmentIntensity={0.22} />
          </>
        ) : (
          <Environment
            preset={lighting as "studio"}
            environmentIntensity={dimScale}
          />
        )}

        {isSmoke && (
          <>
            <SmokeBackLight />
            <SmokeBackground />
          </>
        )}

        {isDim && (
          <>
            <DimRimLights />
            <AluminumShell />
            <DimFloor />
          </>
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
            iridescence={preset?.iridescence ?? 0}
            iridescenceIOR={preset?.iridescenceIOR ?? 1.5}
            iridescenceThicknessRange={preset?.iridescenceThicknessRange ?? [100, 800]}
            finish={finish}
            envIntensityScale={dimScale}
            floating={environment === "default"}
          />
        ) : (
          <SupplementJarMesh
            // Layer 1 — base label material. Identical to bag's Surface.
            finish={finish as BagFinish}
            labelColor={bagColor}
            metalness={metalness}
            roughness={roughness}
            iridescence={preset?.iridescence ?? 0}
            iridescenceIOR={preset?.iridescenceIOR ?? 1.5}
            iridescenceThicknessRange={preset?.iridescenceThicknessRange ?? [100, 800]}
            // Layer 2 / Layer 3 — transparent artwork/foil decals. The bag
            // default textures are the pre-baked mylar artwork, which would
            // look wrong scrunched around a cylinder, so we explicitly zero
            // them out in jar mode — the decals stay clear until the user
            // uploads something jar-appropriate.
            layer2TextureUrl={
              textureUrl === DEFAULT_FRONT_TEXTURE ? null : textureUrl
            }
            layer2Mode={layer2Mode as "artwork" | "foil"}
            layer2Metalness={layer2Metalness}
            layer2Roughness={layer2Roughness}
            layer3TextureUrl={
              backTextureUrl === DEFAULT_BACK_TEXTURE ? null : backTextureUrl ?? null
            }
            layer3Mode={layer3Mode as "artwork" | "foil"}
            layer3Metalness={layer3Metalness}
            layer3Roughness={layer3Roughness}
            envIntensityScale={dimScale}
            floating={environment === "default"}
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
