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
import {
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
          color="#ffffff"
          opacity={0.55}
          fade={40}
          position={[-1.6, 0.2, 0]}
        />
        <Cloud
          segments={30}
          bounds={[4, 1.0, 2]}
          volume={2.4}
          color="#f4f6fb"
          opacity={0.5}
          fade={40}
          position={[1.8, 0.6, -0.4]}
        />
        <Cloud
          segments={28}
          bounds={[3, 0.9, 1.8]}
          volume={2.0}
          color="#dde2ec"
          opacity={0.65}
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

function ReflectiveFloor() {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -1.3, 0]} receiveShadow>
      <planeGeometry args={[40, 40]} />
      <MeshReflectorMaterial
        blur={[300, 80]}
        resolution={1024}
        mixBlur={1.2}
        mixStrength={1.2}
        roughness={0.8}
        depthScale={0.5}
        minDepthThreshold={0.4}
        maxDepthThreshold={1.4}
        color="#dfe3ec"
        metalness={0.25}
        mirror={0}
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
}

export default function BagViewer({
  textureUrl,
  backTextureUrl = null,
  onScreenshot,
  captureRef,
  onMaterialChange,
}: BagViewerProps) {
  const {
    finish, metalness, roughness, bagColor,
    autoRotate, lighting, environment,
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

    Environment: folder({
      environment: {
        label: "Scene",
        value: "default",
        options: { Default: "default", Smoke: "smoke" },
      },
    }, { collapsed: false }),
  });

  const preset =
    finish === "custom"
      ? null
      : FINISH_PRESETS[finish as Exclude<BagFinish, "custom">] ?? FINISH_PRESETS.metallic;
  const bagProps = preset
    ? { metalness: preset.metalness, roughness: preset.roughness }
    : { metalness, roughness };

  const isRave = lighting === "rave";
  const isSmoke = environment === "smoke";

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
      {!isRave && <ambientLight intensity={0.45} />}

      <Suspense fallback={null}>
        {isRave ? (
          <>
            <RaveLights />
            {/* Turned way down — keeps colored lights dominant on reflections */}
            <Environment preset="studio" background={false} environmentIntensity={0.22} />
          </>
        ) : (
          <Environment preset={lighting as "studio"} />
        )}

        {isSmoke && (
          <>
            <SmokeBackLight />
            <SmokeBackground />
          </>
        )}

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
        />

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
