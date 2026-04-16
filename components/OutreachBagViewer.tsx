"use client";

import { Suspense, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import {
  OrbitControls,
  Environment,
  ContactShadows,
  Cloud,
  Clouds,
  MeshReflectorMaterial,
} from "@react-three/drei";
import * as THREE from "three";
import BagMesh from "./BagMesh";
import {
  DEFAULT_BACK_TEXTURE,
  DEFAULT_FRONT_TEXTURE,
  DEFAULT_MATERIAL,
  FINISH_PRESETS,
  resolveSurface,
  type BagMaterial,
} from "@/lib/bagMaterial";
import type { SceneEnvironment } from "@/lib/types";

interface Props {
  /** Front-panel artwork. Null → default Calyx bag front. */
  textureUrl: string | null;
  /** Back-panel artwork. Null → default Calyx bag back. */
  backTextureUrl?: string | null;
  /** Captured material config from BagViewer; null → DEFAULT_MATERIAL. */
  material?: BagMaterial | null;
  /** When false, OrbitControls are dropped and canvas ignores pointer events
   *  so parent <Link>/<button> clicks bubble through. Defaults to true. */
  interactive?: boolean;
  /** Auto-rotate the bag. Useful for non-interactive previews. */
  autoRotate?: boolean;
  /** Skip the solid scene background so the page underneath shows through —
   *  used on the landing page so the wavy-line backdrop reads behind the bag. */
  transparent?: boolean;
  /** Scene environment captured at save time. Null → "default". */
  environment?: SceneEnvironment | null;
}

// ── Rave lighting (mirrors BagViewer) ────────────────────────────────────────
function RaveLights() {
  return (
    <>
      <pointLight position={[-1.5, 1.5, 2.5]} intensity={60} color="#ff00cc" distance={15} decay={2} />
      <pointLight position={[2, 0, 2.5]} intensity={45} color="#00ffee" distance={15} decay={2} />
      <pointLight position={[0, 0.5, -2.5]} intensity={35} color="#aa00ff" distance={15} decay={2} />
      <pointLight position={[0, 3, 1.5]} intensity={30} color="#ff44aa" distance={15} decay={2} />
      <pointLight position={[2, -1.4, 2]} intensity={42} color="#22ff66" distance={15} decay={2} />
      <ambientLight intensity={0.05} color="#ffffff" />
    </>
  );
}

// ── Smoke scene elements (mirrors BagViewer) ─────────────────────────────────
function SmokeBackground() {
  const cloudsRef = useRef<THREE.Group>(null);
  useFrame((_, delta) => {
    if (cloudsRef.current) {
      cloudsRef.current.rotation.y += delta * 0.03;
    }
  });
  return (
    <group ref={cloudsRef} position={[0, 0.1, -2.2]}>
      <Clouds limit={300} material={THREE.MeshBasicMaterial}>
        <Cloud segments={48} bounds={[8, 2.0, 3.5]} volume={4} color="#eaecf2" opacity={0.55} fade={50} position={[-2.4, 0.3, 0]} />
        <Cloud segments={38} bounds={[7, 1.6, 3]} volume={3.2} color="#e0e4ee" opacity={0.5} fade={50} position={[2.6, 0.7, -0.6]} />
        <Cloud segments={34} bounds={[6, 1.4, 2.8]} volume={2.8} color="#d8dce8" opacity={0.6} fade={50} position={[0, -0.5, 0.5]} />
        <Cloud segments={26} bounds={[5, 1.2, 2.5]} volume={2.2} color="#eff0f5" opacity={0.4} fade={50} position={[-1.0, 1.0, -1.0]} />
      </Clouds>
    </group>
  );
}

function SmokeLights() {
  return (
    <>
      <pointLight position={[0, 0.8, -3.8]} intensity={32} color="#ffffff" distance={12} decay={2} />
      <pointLight position={[-2.0, 0.4, -3.0]} intensity={16} color="#e8ecf8" distance={10} decay={2} />
      <pointLight position={[2.0, 0.4, -3.0]} intensity={16} color="#f3ecf8" distance={10} decay={2} />
      <spotLight position={[-2.5, 2.5, 3.5]} intensity={40} color="#ffffff" angle={0.5} penumbra={0.8} distance={14} decay={2} castShadow />
      <spotLight position={[2.5, 2.5, 3.5]} intensity={40} color="#ffffff" angle={0.5} penumbra={0.8} distance={14} decay={2} castShadow />
      <spotLight position={[0, 4, 0]} intensity={20} color="#f0f2ff" angle={0.7} penumbra={1} distance={12} decay={2} />
    </>
  );
}

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

// ── Dim scene elements (mirrors BagViewer) ───────────────────────────────────
function DimRimLights() {
  return (
    <>
      <pointLight position={[0, 1.6, 0.8]} intensity={14} color="#fff0d4" distance={8} decay={2} />
      <pointLight position={[0, -1.4, 0.8]} intensity={10} color="#fde9c4" distance={8} decay={2} />
      <pointLight position={[-1.9, 0, 0.8]} intensity={12} color="#fff3d8" distance={8} decay={2} />
      <pointLight position={[1.9, 0, 0.8]} intensity={12} color="#fcebc0" distance={8} decay={2} />
      <pointLight position={[-1.4, 1.2, 1.4]} intensity={9} color="#fff5dc" distance={8} decay={2} />
      <pointLight position={[1.4, 1.2, 1.4]} intensity={9} color="#fdeec8" distance={8} decay={2} />
      <pointLight position={[-1.4, -1.0, 1.4]} intensity={8} color="#ffeed0" distance={8} decay={2} />
      <pointLight position={[1.4, -1.0, 1.4]} intensity={8} color="#ffe7c0" distance={8} decay={2} />
      <pointLight position={[-1.2, 0.4, -2.2]} intensity={10} color="#ffe9c4" distance={9} decay={2} />
      <pointLight position={[1.2, 0.4, -2.2]} intensity={10} color="#fff0d4" distance={9} decay={2} />
    </>
  );
}

function DimFloor() {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -1.28, 0]} receiveShadow>
      <planeGeometry args={[40, 40]} />
      <meshStandardMaterial color="#f6ecd6" metalness={0.05} roughness={0.9} />
    </mesh>
  );
}

function AluminumShell() {
  return (
    <mesh>
      <sphereGeometry args={[14, 48, 32]} />
      <meshStandardMaterial color="#b8bcc3" metalness={0.7} roughness={0.1} side={THREE.BackSide} />
    </mesh>
  );
}

// ── Scene-level auto-rotator (used when OrbitControls are disabled) ──────────
function SpinningGroup({
  speed = 0.3,
  children,
}: {
  speed?: number;
  children: React.ReactNode;
}) {
  const ref = useRef<THREE.Group>(null);
  useFrame((_, delta) => {
    if (ref.current) ref.current.rotation.y += delta * speed;
  });
  return <group ref={ref}>{children}</group>;
}

/**
 * Lightweight BagViewer used inside Outreach slot thumbnails and the landing
 * card preview. No Leva panel, no screenshot capture — just a 3D preview
 * that faithfully plays back the material config captured at save time.
 */
export default function OutreachBagViewer({
  textureUrl,
  backTextureUrl = null,
  material,
  interactive = true,
  autoRotate = false,
  transparent = false,
  environment: envProp,
}: Props) {
  const mat: BagMaterial = material ?? DEFAULT_MATERIAL;
  const surface = resolveSurface(mat);
  const isRave = mat.lighting === "rave";
  const env = envProp ?? "default";
  const isSmoke = env === "smoke";
  const isDim = env === "dim";
  const dimScale = isDim ? 0.5 : 1;

  const iridescenceCfg =
    mat.finish !== "custom" ? FINISH_PRESETS[mat.finish] : null;

  // Fall back to the branded default artwork on both sides so the playback
  // viewer never renders with the procedural placeholder.
  const resolvedFront = textureUrl ?? DEFAULT_FRONT_TEXTURE;
  const resolvedBack = backTextureUrl ?? DEFAULT_BACK_TEXTURE;

  const bag = (
    <BagMesh
      textureUrl={resolvedFront}
      backTextureUrl={resolvedBack}
      metalness={surface.metalness}
      roughness={surface.roughness}
      color={mat.bagColor}
      labelMetalness={mat.labelMetalness}
      labelRoughness={mat.labelRoughness}
      iridescence={iridescenceCfg?.iridescence ?? 0}
      iridescenceIOR={iridescenceCfg?.iridescenceIOR ?? 1.5}
      iridescenceThicknessRange={
        iridescenceCfg?.iridescenceThicknessRange ?? [100, 800]
      }
      finish={mat.finish}
      envIntensityScale={dimScale}
      floating={env === "default"}
    />
  );

  return (
    <Canvas
      camera={{ position: [0, -0.3, 4.5], fov: 42 }}
      // Leave the gl context at drei's defaults (alpha: true) so ContactShadows
      // and other transparent-material primitives composite the way they always
      // have. Transparency for the landing page is achieved purely by *omitting*
      // the scene-background <color> below — the canvas is already alpha-capable
      // by default, so the page bg simply shows through.
      gl={{
        antialias: true,
        toneMapping: THREE.ACESFilmicToneMapping,
        toneMappingExposure: isRave ? 1.1 : 1.4,
      }}
      shadows
      dpr={[1, 2]}
      style={{
        width: "100%",
        height: "100%",
        // Let clicks pass through to the parent (e.g. landing Link card)
        pointerEvents: interactive ? "auto" : "none",
      }}
    >
      {!transparent && <color attach="background" args={["#eef1f8"]} />}
      {!isRave && <ambientLight intensity={0.45 * dimScale} />}

      <Suspense fallback={null}>
        {isRave ? (
          <>
            <RaveLights />
            <Environment preset="studio" background={false} environmentIntensity={0.22} />
          </>
        ) : (
          <Environment
            preset={mat.lighting as "studio"}
            environmentIntensity={dimScale}
          />
        )}

        {isSmoke && (
          <>
            <SmokeLights />
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

        {autoRotate && !interactive ? (
          <SpinningGroup speed={0.35}>{bag}</SpinningGroup>
        ) : (
          bag
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
      </Suspense>

      {interactive && (
        <OrbitControls
          target={[0, -0.3, 0]}
          autoRotate={autoRotate}
          autoRotateSpeed={1.6}
          enablePan={false}
          enableDamping
          dampingFactor={0.05}
          minDistance={2.5}
          maxDistance={8}
          maxPolarAngle={Math.PI * 0.85}
        />
      )}
    </Canvas>
  );
}
