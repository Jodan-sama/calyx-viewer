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
import { useIsMobile } from "@/lib/useIsMobile";
import { useInViewport } from "@/lib/useInViewport";

interface Props {
  /** Front-panel artwork. Null → default Calyx bag front. */
  textureUrl: string | null;
  /** Back-panel artwork. Null → default Calyx bag back. */
  backTextureUrl?: string | null;
  /** Bag Layer 3 front stacked decal. Null → skip layer. */
  layer3FrontTextureUrl?: string | null;
  /** Bag Layer 3 back stacked decal. Null → skip layer. */
  layer3BackTextureUrl?: string | null;
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

function ReflectiveFloor({ mobile }: { mobile: boolean }) {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -1.265, 0]} receiveShadow>
      <planeGeometry args={[40, 40]} />
      <MeshReflectorMaterial
        blur={[35, 12]}
        // 2048² reflection render-target = ~16 MB VRAM. Mobile can't
        // afford that alongside the main framebuffer + HDRI mipmaps,
        // so we quarter-resolution on narrow viewports. The blur pass
        // hides the lower resolution well enough to read as the same
        // mirror floor at typical viewing angles.
        resolution={mobile ? 512 : 2048}
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
  layer3FrontTextureUrl = null,
  layer3BackTextureUrl = null,
  material,
  interactive = true,
  autoRotate = false,
  transparent = false,
  environment: envProp,
}: Props) {
  const mat: BagMaterial = material ?? DEFAULT_MATERIAL;
  const surface = resolveSurface(mat);
  const isRave = mat.lighting === "rave";
  const isUV = mat.lighting === "uv";
  const env = envProp ?? "default";
  const isSmoke = env === "smoke";
  const isDim = env === "dim";
  const dimScale = isDim ? 0.2 : 1;

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
      layer3FrontTextureUrl={layer3FrontTextureUrl}
      layer3BackTextureUrl={layer3BackTextureUrl}
      metalness={surface.metalness}
      roughness={surface.roughness}
      color={mat.bagColor}
      labelMetalness={mat.labelMetalness}
      labelRoughness={mat.labelRoughness}
      labelVarnish={mat.labelVarnish ?? false}
      labelTactile={mat.labelTactile ?? false}
      labelMaterial={mat.labelMaterial ?? false}
      // Per-layer Material finish reproduces the same cutout the user saw
      // at save time. Undefined → BagMesh falls back to Layer 1's finish,
      // matching pre-per-layer behaviour for older saves.
      labelMatFinish={mat.labelMatFinish}
      labelMatMetalness={mat.labelMatMetalness}
      labelMatRoughness={mat.labelMatRoughness}
      lighting={mat.lighting}
      labelUV={mat.labelUV ?? false}
      layer3UV={mat.layer3UV ?? false}
      // Layer 3 material settings — undefined-safe; BagMesh falls back to its
      // own defaults for saves from before Layer 3 was persisted.
      layer3Metalness={mat.layer3Metalness}
      layer3Roughness={mat.layer3Roughness}
      layer3Varnish={mat.layer3Varnish ?? false}
      layer3Tactile={mat.layer3Tactile ?? false}
      layer3Material={mat.layer3Material ?? false}
      layer3MatFinish={mat.layer3MatFinish}
      layer3MatMetalness={mat.layer3MatMetalness}
      layer3MatRoughness={mat.layer3MatRoughness}
      iridescence={iridescenceCfg?.iridescence ?? 0}
      iridescenceIOR={iridescenceCfg?.iridescenceIOR ?? 1.5}
      iridescenceThicknessRange={
        iridescenceCfg?.iridescenceThicknessRange ?? [100, 800]
      }
      finish={mat.finish}
      envIntensityScale={dimScale}
      floating={env !== "smoke"}
    />
  );

  // If the slot was saved with the full lighting rig (post-2026-04-16),
  // play back the user's actual setup; otherwise fall back to the legacy
  // preset-based lighting so older slots keep rendering the way they
  // always did. The sentinel is `mat.rectCount !== undefined` — present
  // iff BagViewer's full-rig emit touched the material.
  // Mobile performance overrides. Cap DPR, drop MSAA, shrink the HDRI
  // cubemap + reflector render target, and pause the render loop when
  // the slot scrolls out of viewport. The outer wrapper below owns the
  // IntersectionObserver ref so the observed box matches what the user
  // sees on screen.
  const isMobile = useIsMobile();
  const outerRef = useRef<HTMLDivElement>(null);
  const inViewport = useInViewport(outerRef);

  // On mobile (non-UV) we strip the slot down to a common baseline so
  // every tile renders the same cheap scene: transparent background,
  // no saved custom-light rig, no Smoke / fog / gradient / flat colour
  // fill, HDRI forced to drei's Warehouse preset. UV slots are exempt
  // because the fluorescent-glow preview is their whole point.
  const forceMobileBaseline = isMobile && !isUV;

  const customRig = forceMobileBaseline ? false : hasCustomRig(mat);
  const bgMode = forceMobileBaseline
    ? "transparent"
    : customRig
      ? mat.backgroundMode ?? "flat"
      : "flat";
  // UV Blacklight forces a near-black scene regardless of the slot's
  // saved background. A light backdrop washes out the fluorescent
  // glow, which is the only thing the UV preset is trying to sell.
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
        // MSAA 4× is the default when antialias is on. On retina
        // mobile that's 33 megasamples per frame per slot — the
        // single biggest fillrate cost on the client surface. Drop
        // it on mobile; the small visual gain isn't worth the
        // crashes on mid-tier phones.
        antialias: !isMobile,
        toneMapping: customRig
          ? resolveToneMapping(mat.toneMappingCurve)
          : THREE.ACESFilmicToneMapping,
        toneMappingExposure: customRig
          ? mat.toneMappingExposure ?? 1.4
          : isRave
            ? 1.1
            : 1.4,
      }}
      // Retina DPR = 2 yields a 4× pixel count vs DPR = 1. 1.5 is
      // the perceptual-equivalence point on phones (at 5-6" screens
      // you can't resolve the difference between 1.5 and 2), so
      // capping here buys ~30% fillrate with no visible penalty.
      dpr={isMobile ? [1, 1.5] : [1, 2]}
      // "demand" only re-renders when something in the scene
      // changes; "always" re-renders at 60 fps. Off-screen slots
      // have no reason to run at 60 fps, so we flip them to demand
      // and the GPU idles instead of burning power on an invisible
      // framebuffer. Flips back to "always" the moment the slot
      // scrolls into view (with a 200 px rootMargin pre-warm so the
      // first frame is ready before it lands on screen).
      frameloop={inViewport ? "always" : "demand"}
      style={{
        width: "100%",
        height: "100%",
        pointerEvents: interactive ? "auto" : "none",
      }}
    >
      {canvasBg && <color attach="background" args={[canvasBg]} />}
      {customRig ? (
        <ambientLight
          intensity={(mat.ambientIntensity ?? 0.45) * dimScale}
          color={mat.ambientColor ?? "#ffffff"}
        />
      ) : (
        !isRave && !isUV && <ambientLight intensity={0.45 * dimScale} />
      )}

      <Suspense fallback={null}>
        {/* HDRI environment — rave/UV presets still force studio + low
            intensity because neither is a valid drei preset. UV goes
            even lower than rave since fluorescent pigment response
            should dominate, not HDRI reflections. Every other case
            honours the saved material's preset + intensity. */}
        {isRave ? (
          <Environment
            preset="studio"
            background={false}
            // Shrink the precomputed PMREM cubemap on mobile. Default
            // is 256²; 128² drops VRAM ~4× and the difference is
            // invisible on the small mobile tiles.
            resolution={isMobile ? 128 : 256}
            environmentIntensity={
              customRig ? (mat.envIntensity ?? 1) * dimScale : 0.22
            }
          />
        ) : isUV ? (
          // No Environment at all in UV — see BagViewer for rationale.
          // The saved rig's own lights (if any) plus UVLights handle
          // all illumination; foils/chrome/prismatic get swapped to a
          // plain dark diffuse by BagMesh/SupplementJarMesh.
          null
        ) : (
          <Environment
            // On mobile (non-UV) every slot gets the same Warehouse
            // HDR so the browser HTTP-cache delivers one file to all
            // three contexts; desktop keeps the per-slot saved preset.
            preset={
              forceMobileBaseline
                ? "warehouse"
                : resolveEnvironmentPreset(mat.lighting)
            }
            resolution={isMobile ? 128 : 256}
            environmentIntensity={
              customRig ? (mat.envIntensity ?? 1) * dimScale : dimScale
            }
          />
        )}

        {/* Preset-driven extra lights — rave/UV/dim add their colour
            characters even when a custom rig is also saved, because
            they're tied to the `lighting` HDRI preset the user picked,
            not to the additive rig. Smoke env visuals live below. */}
        {isRave && <RaveLights />}
        {isUV && <UVLights />}
        {isDim && <RainbowLights />}

        {/* Smoke-environment scene elements — always render when the
            slot was saved with environment="smoke", independent of
            whether a custom rig exists. These (clouds + low-key lights)
            are part of the env, not the material's lighting rig.
            Skipped on the mobile baseline — Clouds' 200-particle
            system and the SmokeLights rig are the single biggest
            fillrate cost we can drop without changing the mesh. */}
        {isSmoke && !forceMobileBaseline && (
          <>
            <SmokeLights />
            <SmokeBackground />
          </>
        )}

        {/* User's custom rig — stacks on top of preset + env lights so
            spotlights / directional / point / rect adds are additive. */}
        {customRig && <CustomLightRig mat={mat} />}

        {autoRotate && !interactive ? (
          <SpinningGroup speed={0.35}>{bag}</SpinningGroup>
        ) : (
          bag
        )}

        {isSmoke && !forceMobileBaseline ? (
          <ReflectiveFloor mobile={isMobile} />
        ) : (
          <ContactShadows
            position={[0, -1.28, 0]}
            opacity={customRig ? mat.shadowOpacity ?? 0.5 : isRave ? 0.8 : 0.5}
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

  // Always wrap in a positioned div so the IntersectionObserver ref
  // attaches to the slot's on-screen box. Gradient background (when
  // needed) paints on this same wrapper; otherwise the wrapper is
  // transparent and only exists to host the ref.
  return (
    <div
      ref={outerRef}
      style={{
        position: "absolute",
        inset: 0,
        ...(gradientBg ? { background: gradientBg } : {}),
      }}
    >
      {canvas}
    </div>
  );
}
