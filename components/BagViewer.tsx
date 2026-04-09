"use client";

import { Suspense, useRef, useEffect } from "react";
import { Canvas, useThree, useFrame } from "@react-three/fiber";
import { OrbitControls, Environment, ContactShadows } from "@react-three/drei";
import { useControls, folder, Leva } from "leva";
import * as THREE from "three";
import BagMesh from "./BagMesh";

interface FinishPreset {
  metalness: number;
  roughness: number;
  iridescence?: number;
  iridescenceIOR?: number;
  iridescenceThicknessRange?: [number, number];
}

const FINISH_PRESETS: Record<string, FinishPreset> = {
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
      {/* Very dim ambient */}
      <ambientLight intensity={0.05} color="#ffffff" />
    </>
  );
}

interface BagViewerProps {
  textureUrl: string | null;
  onScreenshot?: (url: string) => void;
  captureRef?: React.MutableRefObject<(() => void) | null>;
}

export default function BagViewer({ textureUrl, onScreenshot, captureRef }: BagViewerProps) {
  const {
    finish, metalness, roughness, bagColor,
    autoRotate, lighting,
    labelMetalness, labelRoughness,
  } = useControls({
    Surface: folder({
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
      },
      metalness: {
        label: "Metalness", value: 0.92, min: 0, max: 1, step: 0.01,
        render: (get) => get("Surface.finish") === "custom",
      },
      roughness: {
        label: "Roughness", value: 0.08, min: 0, max: 1, step: 0.01,
        render: (get) => get("Surface.finish") === "custom",
      },
      bagColor: { label: "Bag Color", value: "#c4cdd8" },
    }, { collapsed: false }),

    Label: folder({
      labelMetalness: { label: "Metalness", value: 0.1,  min: 0, max: 1, step: 0.01 },
      labelRoughness: { label: "Roughness", value: 0.55, min: 0, max: 1, step: 0.01 },
    }, { collapsed: false }),

    Scene: folder({
      autoRotate: { label: "Auto Rotate", value: false },
      lighting: {
        label: "Lighting", value: "studio",
        options: { Studio: "studio", Warehouse: "warehouse", City: "city", Forest: "forest", Sunset: "sunset", Rave: "rave" },
      },
    }, { collapsed: true }),
  });

  const preset = finish === "custom" ? null : (FINISH_PRESETS[finish] ?? FINISH_PRESETS.metallic);
  const bagProps = preset
    ? { metalness: preset.metalness, roughness: preset.roughness }
    : { metalness, roughness };

  const isRave = lighting === "rave";

  return (
    <>
      <Leva
        theme={{
          colors: {
            highlight1: "#0033A1",
            highlight2: "#001F60",
            accent1:    "#0033A1",
            accent2:    "#001F60",
            accent3:    "#3d5fcf",
            elevation1: "#f5f7ff",
            elevation2: "#eef1fb",
            elevation3: "#DBE6FF",
            folderWidgetColor: "#0033A1",
            folderTextColor:   "#272724",
            toolTipBackground: "#272724",
            toolTipText:       "#ffffff",
          },
          radii:     { xs: "3px", sm: "6px", lg: "8px" },
          fontSizes: { root: "11px" },
          sizes:     { rootWidth: "265px" },
          fonts:     { mono: "Poppins, sans-serif", sans: "Poppins, sans-serif" },
        }}
        titleBar={{ title: "Material Controls", drag: false, filter: false }}
      />

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
        <color attach="background" args={["#eef1f8"]} />
        {!isRave && <ambientLight intensity={0.45} />}

        <Suspense fallback={null}>
          {isRave ? (
            <>
              <RaveLights />
              {/* Enough env so metallic surfaces have something to reflect */}
              <Environment preset="studio" background={false} environmentIntensity={0.8} />
            </>
          ) : (
            <Environment preset={lighting as "studio"} />
          )}

          <BagMesh
            textureUrl={textureUrl}
            metalness={bagProps.metalness}
            roughness={bagProps.roughness}
            color={bagColor}
            labelMetalness={labelMetalness}
            labelRoughness={labelRoughness}
            iridescence={preset?.iridescence ?? 0}
            iridescenceIOR={preset?.iridescenceIOR ?? 1.5}
            iridescenceThicknessRange={preset?.iridescenceThicknessRange ?? [100, 800]}
            finish={finish}
          />

          <ContactShadows
            position={[0, -1.28, 0]}
            opacity={isRave ? 0.8 : 0.5}
            scale={5}
            blur={2.5}
            far={2}
          />

          {onScreenshot && (
            <ScreenshotCapture onCapture={onScreenshot} resetKey={textureUrl ?? "default"} captureRef={captureRef} />
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
    </>
  );
}
