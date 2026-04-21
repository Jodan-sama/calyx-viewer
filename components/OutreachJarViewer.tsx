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
import SupplementJarMesh from "./SupplementJarMesh";
import {
  DEFAULT_MATERIAL,
  FINISH_PRESETS,
  resolveSurface,
  resolveEnvironmentPreset,
  type BagMaterial,
} from "@/lib/bagMaterial";
import {
  CustomLightRig,
  hasCustomRig,
  resolveToneMapping,
  resolveWrapperBackground,
} from "./CustomLightRig";
import type { SceneEnvironment } from "@/lib/types";

interface Props {
  /** The label artwork to map onto the jar's body label (Layer 2). */
  textureUrl: string | null;
  /** Optional back-side artwork mapped to Layer 3. */
  backTextureUrl?: string | null;
  /** Captured material config from the preview (label finish/colour). Reused
   *  for the jar's Layer-1 surface so the saved jar matches what the user
   *  saw in Calyx Preview. */
  material?: BagMaterial | null;
  interactive?: boolean;
  autoRotate?: boolean;
  /** Skip the solid scene background so the page underneath shows through —
   *  used on the landing page so the wavy-line backdrop reads behind the jar. */
  transparent?: boolean;
  /** Scene environment captured at save time. Null → "default". */
  environment?: SceneEnvironment | null;
}

// ── Rave lighting (mirrors BagViewer) ────────────────────────────────────────
// "rave" isn't a valid drei Environment preset, so whenever a slot was saved
// with lighting === "rave" we drop these saturated colored point lights into
// the scene and route Environment to "studio" at reduced intensity. Without
// this handling drei throws "Preset must be one of: …" and the whole page
// fails to hydrate.
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

// ── UV Blacklight rig (mirrors BagViewer) ────────────────────────────────────
function UVLights() {
  return (
    <>
      <pointLight position={[-2, 2.5, 1.5]} intensity={8} color="#6a00ff" distance={12} decay={2} />
      <pointLight position={[2, 2.5, 1.5]} intensity={8} color="#6a00ff" distance={12} decay={2} />
      <pointLight position={[0, 1.8, -2.5]} intensity={5} color="#aa33ff" distance={10} decay={2} />
      <ambientLight intensity={0.02} color="#2a1155" />
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
    <group ref={cloudsRef} position={[0, 0.2, -1.8]}>
      <Clouds limit={200} material={THREE.MeshBasicMaterial}>
        <Cloud segments={40} bounds={[5, 1.2, 2]} volume={3} color="#c8ccd6" opacity={0.6} fade={40} position={[-1.6, 0.2, 0]} />
        <Cloud segments={30} bounds={[4, 1.0, 2]} volume={2.4} color="#b4b8c4" opacity={0.55} fade={40} position={[1.8, 0.6, -0.4]} />
        <Cloud segments={28} bounds={[3, 0.9, 1.8]} volume={2.0} color="#9ea3b0" opacity={0.7} fade={40} position={[0, -0.6, 0.3]} />
        <Cloud segments={24} bounds={[6, 1.4, 2.5]} volume={2.6} color="#c0c4d0" opacity={0.35} fade={50} position={[0.4, 0.4, -1.8]} />
      </Clouds>
    </group>
  );
}

function SmokeLights() {
  return (
    <>
      <pointLight position={[0, 0.8, -3.2]} intensity={28} color="#ffffff" distance={10} decay={2} />
      <pointLight position={[-1.6, 0.4, -2.6]} intensity={14} color="#e8ecf8" distance={8} decay={2} />
      <pointLight position={[1.6, 0.4, -2.6]} intensity={14} color="#f3ecf8" distance={8} decay={2} />
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

// ── Dim scene — dark moody environment with orbiting rainbow lights ─────────
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


// Scene-level auto-rotator (used when OrbitControls are off, e.g. in the
// non-interactive landing/slot previews).
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
 * Lightweight jar viewer used inside Outreach hero slots that were saved as
 * `supplement-jar`. Mirrors OutreachBagViewer's shape so the slot layout and
 * camera framing stay consistent across product types — only the underlying
 * mesh changes.
 */
export default function OutreachJarViewer({
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
  const env = envProp ?? "default";
  const isSmoke = env === "smoke";
  const isDim = env === "dim";
  const isRave = mat.lighting === "rave";
  const isUV = mat.lighting === "uv";
  const dimScale = isDim ? 0.2 : 1;
  // Saved slots can carry lighting = "rave" (a BagViewer concept that doesn't
  // correspond to any drei Environment preset). Resolve it to a drei-safe
  // preset string here so the <Environment> primitive never throws.
  const envPreset = resolveEnvironmentPreset(mat.lighting);
  const iridescenceCfg =
    mat.finish !== "custom" ? FINISH_PRESETS[mat.finish] : null;

  const jar = (
    <SupplementJarMesh
      finish={mat.finish}
      labelColor={mat.bagColor}
      metalness={surface.metalness}
      roughness={surface.roughness}
      iridescence={iridescenceCfg?.iridescence ?? 0}
      iridescenceIOR={iridescenceCfg?.iridescenceIOR ?? 1.5}
      iridescenceThicknessRange={
        iridescenceCfg?.iridescenceThicknessRange ?? [100, 800]
      }
      lighting={mat.lighting}
      layer2UV={mat.layer2UV ?? false}
      layer3UV={mat.layer3UV ?? false}
      // The saved label image lives on Layer 2 of the jar; Layer 3 is the
      // optional second stacked artwork. Both default to clear if absent
      // so the bare label finish shows through.
      layer2TextureUrl={textureUrl}
      layer2Metalness={mat.layer2Metalness ?? 0}
      layer2Roughness={mat.layer2Roughness ?? 0.5}
      layer2Varnish={mat.layer2Varnish ?? false}
      layer2Material={mat.layer2Material ?? false}
      layer2MatFinish={mat.layer2MatFinish}
      layer2MatMetalness={mat.layer2MatMetalness}
      layer2MatRoughness={mat.layer2MatRoughness}
      layer3TextureUrl={backTextureUrl}
      layer3Metalness={mat.layer3Metalness ?? 0}
      layer3Roughness={mat.layer3Roughness ?? 0.5}
      layer3Varnish={mat.layer3Varnish ?? false}
      layer3Material={mat.layer3Material ?? false}
      layer3MatFinish={mat.layer3MatFinish}
      layer3MatMetalness={mat.layer3MatMetalness}
      layer3MatRoughness={mat.layer3MatRoughness}
      envIntensityScale={dimScale}
      floating={env !== "smoke"}
      // Mosaic — shared source URL + per-layer crop seeds. Undefined
      // fields fall through to the mesh prop defaults (0) which still
      // produce a valid crop when mosaic isn't in use on that layer.
      mosaicSourceUrl={mat.mosaicSourceImageUrl ?? null}
      mosaicZoom={mat.mosaicZoom}
      mosaicOffsetU={mat.mosaicOffsetU}
      mosaicOffsetV={mat.mosaicOffsetV}
      mosaicFlipX={mat.mosaicFlipX}
      mosaicFlipY={mat.mosaicFlipY}
      layer2MosaicOffsetU={mat.layer2MosaicOffsetU}
      layer2MosaicOffsetV={mat.layer2MosaicOffsetV}
      layer2MosaicFlipX={mat.layer2MosaicFlipX}
      layer2MosaicFlipY={mat.layer2MosaicFlipY}
      layer3MosaicOffsetU={mat.layer3MosaicOffsetU}
      layer3MosaicOffsetV={mat.layer3MosaicOffsetV}
      layer3MosaicFlipX={mat.layer3MosaicFlipX}
      layer3MosaicFlipY={mat.layer3MosaicFlipY}
    />
  );

  // Play back the user's full rig when the slot was saved with one.
  const customRig = hasCustomRig(mat);
  const bgMode = customRig ? mat.backgroundMode ?? "flat" : "flat";
  const canvasBg = isUV
    ? "#07021a"
    : transparent || bgMode !== "flat"
      ? null
      : customRig
        ? mat.backgroundColor1 ?? "#eef1f8"
        : "#eef1f8";
  const gradientBg =
    !isUV && customRig && bgMode === "gradient" && !transparent
      ? resolveWrapperBackground(mat)
      : null;

  const canvas = (
    <Canvas
      camera={{ position: [0, -0.3, 4.5], fov: 42 }}
      gl={{
        antialias: true,
        toneMapping: customRig
          ? resolveToneMapping(mat.toneMappingCurve)
          : THREE.ACESFilmicToneMapping,
        toneMappingExposure: customRig
          ? mat.toneMappingExposure ?? 1.4
          : 1.4,
      }}
      shadows
      dpr={[1, 2]}
      style={{
        width: "100%",
        height: "100%",
        pointerEvents: interactive ? "auto" : "none",
      }}
    >
      {canvasBg && <color attach="background" args={[canvasBg]} />}
      {customRig && mat.fogEnabled && (
        <fog
          attach="fog"
          args={[mat.fogColor ?? "#cccccc", mat.fogNear ?? 2, mat.fogFar ?? 10]}
        />
      )}
      {customRig ? (
        <ambientLight
          intensity={(mat.ambientIntensity ?? 0.45) * dimScale}
          color={mat.ambientColor ?? "#ffffff"}
        />
      ) : (
        !isRave && !isUV && <ambientLight intensity={0.45 * dimScale} />
      )}

      <Suspense fallback={null}>
        {/* HDRI environment — rave/UV both force studio with low
            intensity. See OutreachBagViewer for rationale. */}
        {isRave ? (
          <Environment
            preset="studio"
            background={false}
            environmentIntensity={
              customRig ? (mat.envIntensity ?? 1) * dimScale : 0.22
            }
          />
        ) : isUV ? (
          // No Environment in UV — see BagViewer/OutreachBagViewer for
          // rationale. UVLights + the meshes' uvDarkMat handle the look.
          null
        ) : (
          <Environment
            preset={envPreset}
            environmentIntensity={
              customRig ? (mat.envIntensity ?? 1) * dimScale : dimScale
            }
          />
        )}

        {isRave && <RaveLights />}
        {isUV && <UVLights />}
        {isDim && <RainbowLights />}

        {isSmoke && (
          <>
            <SmokeLights />
            <SmokeBackground />
          </>
        )}

        {customRig && (
          <CustomLightRig
            mat={mat}
            shadowsEnabled={mat.shadowsEnabled ?? false}
            shadowMapSize={(mat.shadowMapSize ?? 1024) as number}
            shadowRadius={(mat.shadowRadius ?? 4) as number}
          />
        )}

        {autoRotate && !interactive ? (
          <SpinningGroup speed={0.35}>{jar}</SpinningGroup>
        ) : (
          jar
        )}

        {isSmoke ? (
          <ReflectiveFloor />
        ) : (
          <ContactShadows
            position={[0, -1.28, 0]}
            opacity={customRig ? mat.shadowOpacity ?? 0.5 : 0.5}
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

  if (gradientBg) {
    return (
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: gradientBg,
        }}
      >
        {canvas}
      </div>
    );
  }
  return canvas;
}
