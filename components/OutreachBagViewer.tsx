"use client";

import { Suspense, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls, Environment, ContactShadows } from "@react-three/drei";
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
}

// ── Rave lighting (mirrors BagViewer) ────────────────────────────────────────
function RaveLights() {
  return (
    <>
      <pointLight position={[-1.5, 1.5, 2.5]} intensity={60} color="#ff00cc" distance={15} decay={2} />
      <pointLight position={[2, 0, 2.5]} intensity={45} color="#00ffee" distance={15} decay={2} />
      <pointLight position={[0, 0.5, -2.5]} intensity={35} color="#aa00ff" distance={15} decay={2} />
      <pointLight position={[0, 3, 1.5]} intensity={30} color="#ff44aa" distance={15} decay={2} />
      <ambientLight intensity={0.05} color="#ffffff" />
    </>
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
}: Props) {
  const mat: BagMaterial = material ?? DEFAULT_MATERIAL;
  const surface = resolveSurface(mat);
  const isRave = mat.lighting === "rave";

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
    />
  );

  return (
    <Canvas
      camera={{ position: [0, -0.3, 4.5], fov: 42 }}
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
      <color attach="background" args={["#eef1f8"]} />
      {!isRave && <ambientLight intensity={0.45} />}

      <Suspense fallback={null}>
        {isRave ? (
          <>
            <RaveLights />
            <Environment preset="studio" background={false} environmentIntensity={0.8} />
          </>
        ) : (
          <Environment preset={mat.lighting as "studio"} />
        )}

        {autoRotate && !interactive ? (
          <SpinningGroup speed={0.35}>{bag}</SpinningGroup>
        ) : (
          bag
        )}

        <ContactShadows
          position={[0, -1.28, 0]}
          opacity={isRave ? 0.8 : 0.5}
          scale={5}
          blur={2.5}
          far={2}
        />
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
