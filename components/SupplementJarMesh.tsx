"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { useGLTF } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import {
  mergeGeometries,
  mergeVertices,
} from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { FINISH_PRESETS, type BagFinish } from "@/lib/bagMaterial";

// ── Assets ───────────────────────────────────────────────────────────────────
// The full jar comes from two glbs: one provides the body + lid (we reuse it
// but hide its built-in label meshes so we don't double-render a label) and
// the other is the standalone label geometry the modeller ships for Layer 1.
const JAR_BODY_GLB = "/models/supplement-circle.glb";
const JAR_LABEL_GLB = "/models/supplement-circle-label.glb";
// Both assets are Draco-compressed (832 KB → 222 KB body, 59 KB → 16 KB
// label). The `true` flag enables drei's built-in DRACOLoader — decoder
// blobs are fetched once and shared with BagMesh's mylar-bag load.
useGLTF.preload(JAR_BODY_GLB, true);
useGLTF.preload(JAR_LABEL_GLB, true);

// Base env-map intensities (mirroring BagMesh so the jar's label reads the
// scene with the same punch the bag does). `envIntensityScale` multiplies in.
const MYLAR_ENV_BASE = 2.0;
const FOIL_ENV_BASE = 0.6;
const CHROME_ENV_BASE = 0.25;
const PRISM_ENV_BASE = 0.45;
const PLASTIC_ENV_BASE = 0.8;
const DECAL_ENV_BASE = 0.6;

// Varnish tuning — matches BagMesh.
const VARNISH_BUMP_SCALE = 0.008;
const VARNISH_CLEARCOAT = 1.0;
const VARNISH_CLEARCOAT_ROUGHNESS = 0.02;
const VARNISH_ROUGHNESS = 0.05;

/** Builds a greyscale bump-map texture from a source texture's alpha channel.
 *  Plugged into MeshPhysicalMaterial.bumpMap so the varnish only raises the
 *  surface where the artwork is actually opaque. */
function buildAlphaBumpTexture(src: THREE.Texture): THREE.CanvasTexture | null {
  const img = src.image as
    | HTMLImageElement
    | HTMLCanvasElement
    | ImageBitmap
    | undefined;
  if (!img) return null;
  const w = (img as { width?: number }).width;
  const h = (img as { height?: number }).height;
  if (!w || !h) return null;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(img as CanvasImageSource, 0, 0);
  const imgData = ctx.getImageData(0, 0, w, h);
  const d = imgData.data;
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3];
    d[i] = a;
    d[i + 1] = a;
    d[i + 2] = a;
    d[i + 3] = 255;
  }
  ctx.putImageData(imgData, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.NoColorSpace;
  tex.anisotropy = 16;
  tex.wrapS = THREE.RepeatWrapping;
  return tex;
}

/** Kept as an exported type for backwards compatibility with existing callers;
 *  the jar itself no longer branches on Mode — artwork decals are always
 *  rendered as artwork, and "foil"-style masked rendering is reached via the
 *  per-layer Material checkbox instead. */
export type LayerMode = "artwork" | "foil";

interface SupplementJarMeshProps {
  // ── Layer 1 — the label surface. Behaves exactly like the bag's mylar. ────
  finish: BagFinish;
  labelColor: string;
  /** Only used when finish === "custom" */
  metalness: number;
  /** Only used when finish === "custom" */
  roughness: number;
  iridescence?: number;
  iridescenceIOR?: number;
  iridescenceThicknessRange?: [number, number];

  // ── Layer 2 — artwork decal. Clear until a texture is supplied. ─────────
  layer2TextureUrl: string | null;
  layer2Metalness: number;
  layer2Roughness: number;
  /** Clear-gloss overprint on Layer 2 artwork. */
  layer2Varnish?: boolean;
  /** When true, Layer 2's artwork becomes a mask — every opaque pixel shows
   *  the Material finish selected for *this layer* (see `layer2MatFinish`)
   *  rather than the artwork image itself. Effectively turns the artwork
   *  into a material cutout. */
  layer2Material?: boolean;
  /** Per-layer Material finish. Used only when `layer2Material` is on. If
   *  omitted the layer falls back to Layer 1's finish — which keeps the
   *  pre-per-layer behaviour intact for older saves. */
  layer2MatFinish?: BagFinish;
  /** Custom metalness for `layer2MatFinish === "custom"`. */
  layer2MatMetalness?: number;
  /** Custom roughness for `layer2MatFinish === "custom"`. */
  layer2MatRoughness?: number;

  // ── Layer 3 — artwork decal. Clear until a texture is supplied. ─────────
  layer3TextureUrl: string | null;
  layer3Metalness: number;
  layer3Roughness: number;
  /** Clear-gloss overprint on Layer 3 artwork. */
  layer3Varnish?: boolean;
  /** When true, Layer 3's artwork becomes a Surface-finish cutout — same
   *  rules as `layer2Material`. */
  layer3Material?: boolean;
  /** Per-layer Material finish for Layer 3. Falls back to Layer 1's
   *  finish when omitted. */
  layer3MatFinish?: BagFinish;
  /** Custom metalness for `layer3MatFinish === "custom"`. */
  layer3MatMetalness?: number;
  /** Custom roughness for `layer3MatFinish === "custom"`. */
  layer3MatRoughness?: number;

  /** Scene-level env dim (same prop as BagMesh). 1 = default. */
  envIntensityScale?: number;
  /** Whether to float the jar above the ground. When false (e.g. in the Smoke
   *  scene with a reflective floor), the jar sits flush on the floor with no
   *  oscillation, so the cast reflection lines up cleanly with its base. */
  floating?: boolean;
}

// ── HSV → RGB helper for holographic texture (duplicated from BagMesh) ──────
function hsvToRgb(h: number): [number, number, number] {
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const q = 1 - f;
  const t = f;
  switch (i % 6) {
    case 0: return [1, t, 0];
    case 1: return [q, 1, 0];
    case 2: return [0, 1, t];
    case 3: return [0, q, 1];
    case 4: return [t, 0, 1];
    default: return [1, 0, q];
  }
}

function buildHolographicTexture(): THREE.CanvasTexture {
  const W = 512, H = 512;
  const canvas = document.createElement("canvas");
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  const imgData = ctx.createImageData(W, H);
  const d = imgData.data;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const u = x / W, v = y / H;
      const hue = (
        (u * 2.1 + v * 1.3) +
        Math.sin(u * 18 + v * 12) * 0.18 +
        Math.sin((u - v) * 24)    * 0.12
      ) % 1.0;
      const [r, g, b] = hsvToRgb((hue + 1) % 1);
      const i = (y * W + x) * 4;
      d[i] = Math.floor(r * 255); d[i+1] = Math.floor(g * 255);
      d[i+2] = Math.floor(b * 255); d[i+3] = 255;
    }
  }
  ctx.putImageData(imgData, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

// ── Texture loader with alpha-edge cleanup (shared with BagMesh) ───────────
async function loadLabelTexture(
  url: string,
  signal: { cancelled: boolean }
): Promise<THREE.CanvasTexture | null> {
  try {
    const blob = await fetch(url).then((r) => r.blob());
    const bitmap = await createImageBitmap(blob, { premultiplyAlpha: "none" });
    if (signal.cancelled) return null;

    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    ctx.drawImage(bitmap, 0, 0);

    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const d = imgData.data;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 10) d[i] = d[i + 1] = d[i + 2] = d[i + 3] = 0;
    }
    ctx.putImageData(imgData, 0, 0);

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 16;
    tex.wrapS = THREE.RepeatWrapping;
    return tex;
  } catch (e) {
    console.error("Texture load failed:", e);
    return null;
  }
}

// ── Cylindrical UV reprojection ─────────────────────────────────────────────
// Clones + de-indexes the source geometry, computes u = (seamAngle -
// atan2(z,x))/(2π) around the Y axis (the seamAngle parameter rotates the
// u=0/u=1 boundary so it can be hidden inside a physical gap in the label
// geometry) and v = normalised height against the supplied yMin/yMax. Then
// bumps low-u vertices on seam-spanning triangles by +1 so RepeatWrapping on
// the texture gives a seamless wrap.
//
// The source geometry is expected to already have smooth, welded normals
// (computed on the merged label geometry before this call). After toNonIndexed
// duplicates each vertex per triangle, we transfer those smooth normals back
// via a position hash so the seam-bumping doesn't reintroduce flat shading.
function cylindricalUVs(
  src: THREE.BufferGeometry,
  yMin: number,
  yMax: number,
  seamAngle = Math.PI
): THREE.BufferGeometry {
  // Cache the welded normals before we de-index — keyed by quantised position.
  // Precision needs to be tighter than the geometry's smallest feature; the
  // label GLB ships in 0.002-unit-wide native space, so 4 decimals would
  // bucket every vertex into ~3 hash slots. 8 decimals covers anything down
  // to 1e-8, which is well below float round-trip error for these positions.
  const PRECISION = 8;
  const posKey = (x: number, y: number, z: number) =>
    `${x.toFixed(PRECISION)}|${y.toFixed(PRECISION)}|${z.toFixed(PRECISION)}`;
  const normalMap = new Map<string, [number, number, number]>();
  const srcPos = src.attributes.position as THREE.BufferAttribute;
  const srcNorm = src.attributes.normal as THREE.BufferAttribute | undefined;
  if (srcNorm) {
    for (let i = 0; i < srcPos.count; i++) {
      normalMap.set(
        posKey(srcPos.getX(i), srcPos.getY(i), srcPos.getZ(i)),
        [srcNorm.getX(i), srcNorm.getY(i), srcNorm.getZ(i)]
      );
    }
  }

  const geo = src.clone().toNonIndexed();
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const yRange = yMax - yMin || 1;

  const uv = new Float32Array(pos.count * 2);
  const TWO_PI = Math.PI * 2;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    // u shifts so the seam (u=0/u=1) lands at seamAngle. The minus sign
    // matches viewing the label from outside the cylinder — without it,
    // text reads mirrored ("CALYX" → "XYLAC").
    let u = (seamAngle - Math.atan2(z, x)) / TWO_PI;
    u = u - Math.floor(u); // wrap into [0, 1)
    uv[i * 2] = u;
    uv[i * 2 + 1] = (y - yMin) / yRange;
  }

  for (let i = 0; i < pos.count; i += 3) {
    const u0 = uv[i * 2];
    const u1 = uv[(i + 1) * 2];
    const u2 = uv[(i + 2) * 2];
    if (Math.max(u0, u1, u2) - Math.min(u0, u1, u2) > 0.5) {
      if (u0 < 0.5) uv[i * 2] += 1;
      if (u1 < 0.5) uv[(i + 1) * 2] += 1;
      if (u2 < 0.5) uv[(i + 2) * 2] += 1;
    }
  }

  geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));

  // Restore smooth normals from the welded source via position hash. If we
  // fall through to computeVertexNormals() the per-triangle averaging on a
  // non-indexed geometry produces flat shading at every primitive boundary,
  // which is exactly the dark-stripe artefact we're trying to avoid.
  if (normalMap.size > 0) {
    const newNormals = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const k = posKey(pos.getX(i), pos.getY(i), pos.getZ(i));
      const n = normalMap.get(k);
      if (n) {
        newNormals[i * 3] = n[0];
        newNormals[i * 3 + 1] = n[1];
        newNormals[i * 3 + 2] = n[2];
      }
    }
    geo.setAttribute("normal", new THREE.BufferAttribute(newNormals, 3));
  } else {
    geo.computeVertexNormals();
  }

  return geo;
}

export default function SupplementJarMesh({
  finish,
  labelColor,
  metalness,
  roughness,
  iridescence = 0,
  iridescenceIOR = 1.5,
  iridescenceThicknessRange = [100, 800],
  layer2TextureUrl,
  layer2Metalness,
  layer2Roughness,
  layer2Varnish = false,
  layer2Material = false,
  layer2MatFinish,
  layer2MatMetalness,
  layer2MatRoughness,
  layer3TextureUrl,
  layer3Metalness,
  layer3Roughness,
  layer3Varnish = false,
  layer3Material = false,
  layer3MatFinish,
  layer3MatMetalness,
  layer3MatRoughness,
  envIntensityScale = 1,
  floating = true,
}: SupplementJarMeshProps) {
  const { scene: bodyScene } = useGLTF(JAR_BODY_GLB, true) as { scene: THREE.Group };
  const { scene: labelScene } = useGLTF(JAR_LABEL_GLB, true) as { scene: THREE.Group };

  // ── Plastic body/lid material ─────────────────────────────────────────────
  // Tuned for matte black supplement-jar plastic: base roughness lifted
  // (0.32 → 0.62) so the diffuse response reads as a softer, flatter
  // surface, and the clearcoat is pulled way back (0.8 → 0.25 strength,
  // 0.18 → 0.55 rough) so there's just a whisper of a polished top-coat
  // rather than a piano-gloss shine. Base colour nudged up one notch
  // (#141414 → #181818) so the highlights still read against the
  // studio HDRI without looking chalky.
  const plasticMat = useMemo(
    () =>
      new THREE.MeshPhysicalMaterial({
        color: "#181818",
        metalness: 0.08,
        roughness: 0.62,
        clearcoat: 0.25,
        clearcoatRoughness: 0.55,
        envMapIntensity: PLASTIC_ENV_BASE,
      }),
    []
  );

  useEffect(() => {
    plasticMat.envMapIntensity = PLASTIC_ENV_BASE * envIntensityScale;
    plasticMat.needsUpdate = true;
  }, [envIntensityScale, plasticMat]);

  // ── Layer 1 materials (mylar / foil / multi-chrome) ──────────────────────
  // Mirrors BagMesh. We build all three, then select one via layer1Material.
  const holographicTex = useMemo(() => buildHolographicTexture(), []);

  const mylarMat = useMemo(
    () =>
      new THREE.MeshPhysicalMaterial({
        color: new THREE.Color(labelColor),
        metalness,
        roughness,
        envMapIntensity: MYLAR_ENV_BASE,
        side: THREE.DoubleSide,
        iridescence,
        iridescenceIOR,
        iridescenceThicknessRange,
        // Push the label slightly toward the camera so it always renders
        // in front of the dark plastic body sitting directly underneath —
        // prevents z-fighting artifacts (dark stripes at glancing angles).
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const holographicFoilMat = useMemo(() => {
    const mat = new THREE.MeshPhysicalMaterial({
      metalness: 1.0,
      roughness: 0.0,
      envMapIntensity: FOIL_ENV_BASE,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    mat.onBeforeCompile = (shader) => {
      shader.vertexShader = `varying vec3 vWorldPos;\n` + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace(
        "#include <worldpos_vertex>",
        `#include <worldpos_vertex>
        vWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`
      );
      shader.fragmentShader =
        `varying vec3 vWorldPos;\n` + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <dithering_fragment>",
        `#include <dithering_fragment>
        vec3 wN = normalize(vNormal);
        vec3 vd = normalize(cameraPosition - vWorldPos);
        float ndv = clamp(dot(wN, vd), 0.0, 1.0);
        float scale = 28.0;
        vec2 cell = fract(vec2(vWorldPos.x, vWorldPos.y) * scale) - 0.5;
        float dist = length(cell);
        float circle = 1.0 - smoothstep(0.28, 0.42, dist);
        vec2 cellId = floor(vec2(vWorldPos.x, vWorldPos.y) * scale);
        float cellOffset = fract(sin(cellId.x * 127.1 + cellId.y * 311.7) * 0.12);
        float cellHue = fract(ndv * 1.8 + wN.x * 0.5 + wN.y * 0.3 + cellOffset);
        vec3 rainbow = clamp(abs(mod(cellHue * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
        vec3 chrome = vec3(0.85, 0.90, 0.95);
        vec3 dotColor = mix(chrome, rainbow, 0.55);
        vec3 foilColor = mix(chrome, dotColor, circle * 0.80);
        gl_FragColor.rgb = mix(gl_FragColor.rgb, foilColor, 0.52);
        gl_FragColor.a = 1.0;`
      );
    };
    return mat;
  }, []);

  // ── Prismatic Foil shader (mirrors BagMesh) ───────────────────────────────
  const prismaticFoilMat = useMemo(() => {
    const mat = new THREE.MeshPhysicalMaterial({
      metalness: 1.0,
      roughness: 0.0,
      envMapIntensity: PRISM_ENV_BASE,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    mat.onBeforeCompile = (shader) => {
      shader.vertexShader = `varying vec3 vWorldPos;\n` + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace(
        "#include <worldpos_vertex>",
        `#include <worldpos_vertex>
        vWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`
      );
      shader.fragmentShader =
        `varying vec3 vWorldPos;\n` + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <dithering_fragment>",
        `#include <dithering_fragment>
        vec3 wN = normalize(vNormal);
        vec3 vd = normalize(cameraPosition - vWorldPos);
        float ndv = clamp(dot(wN, vd), 0.0, 1.0);
        float ca = 0.7986;
        float sa = 0.6018;
        vec2 rot = vec2(vWorldPos.x * ca - vWorldPos.y * sa,
                        vWorldPos.x * sa + vWorldPos.y * ca);
        float grating = sin(rot.x * 220.0) * 0.5 + 0.5;
        float hue = fract(
          rot.y * 4.5 +
          ndv * 1.4 +
          wN.x * 0.35 +
          wN.y * 0.25
        );
        vec3 rainbow = clamp(abs(mod(hue * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
        vec3 chrome = vec3(0.90, 0.93, 0.98);
        vec3 prismBand = mix(chrome, rainbow, 0.72);
        vec3 finalColor = mix(chrome * 0.88, prismBand, 0.55 + grating * 0.45);
        gl_FragColor.rgb = mix(gl_FragColor.rgb, finalColor, 0.60);
        gl_FragColor.a = 1.0;`
      );
    };
    return mat;
  }, []);

  const multiChromeMat = useMemo(() => {
    const mat = new THREE.MeshPhysicalMaterial({
      metalness: 1.0,
      roughness: 0.0,
      envMapIntensity: CHROME_ENV_BASE,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    mat.onBeforeCompile = (shader) => {
      shader.vertexShader = `varying vec3 vWorldPos;\n` + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace(
        "#include <worldpos_vertex>",
        `#include <worldpos_vertex>
        vWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`
      );
      shader.fragmentShader =
        `varying vec3 vWorldPos;\n` + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <dithering_fragment>",
        `#include <dithering_fragment>
        vec3 wN = normalize(vNormal);
        vec3 vd = normalize(cameraPosition - vWorldPos);
        float ndv = clamp(dot(wN, vd), 0.0, 1.0);
        float normalHue = wN.x * 0.50 + wN.y * 0.30 + wN.z * 0.20;
        float detail =
          sin(vWorldPos.x * 2.2 + vWorldPos.y * 1.8) * 0.12 +
          sin(vWorldPos.y * 1.5 - vWorldPos.z * 2.0) * 0.08;
        float hue = fract(normalHue * 0.6 + detail + ndv * 0.35 + 0.15);
        vec3 chrome = vec3(0.82, 0.87, 0.94);
        vec3 blue   = vec3(0.30, 0.40, 0.95);
        vec3 purple = vec3(0.58, 0.22, 0.88);
        vec3 pink   = vec3(0.95, 0.38, 0.72);
        vec3 palColor;
        float t4 = hue * 4.0;
        if (t4 < 1.0)      palColor = mix(chrome, blue,   t4);
        else if (t4 < 2.0) palColor = mix(blue,   purple, t4 - 1.0);
        else if (t4 < 3.0) palColor = mix(purple, pink,   t4 - 2.0);
        else               palColor = mix(pink,   chrome, t4 - 3.0);
        gl_FragColor.rgb = mix(gl_FragColor.rgb, palColor, 0.40);
        gl_FragColor.a = 1.0;`
      );
    };
    return mat;
  }, []);

  // Sync mylarMat state with finish/color/custom props + env scale
  useEffect(() => {
    mylarMat.color.set(labelColor);
    mylarMat.metalness = metalness;
    mylarMat.roughness = roughness;
    mylarMat.envMapIntensity = MYLAR_ENV_BASE * envIntensityScale;
    mylarMat.iridescence = iridescence;
    mylarMat.iridescenceIOR = iridescenceIOR;
    mylarMat.iridescenceThicknessRange = iridescenceThicknessRange;
    if (iridescence > 0) {
      mylarMat.iridescenceThicknessMap = holographicTex;
      mylarMat.iridescenceThicknessRange = [0, 1200];
      mylarMat.color.set("#ffffff");
    } else {
      mylarMat.iridescenceThicknessMap = null;
      mylarMat.color.set(labelColor);
    }
    mylarMat.needsUpdate = true;
  }, [
    labelColor,
    metalness,
    roughness,
    iridescence,
    iridescenceIOR,
    iridescenceThicknessRange,
    envIntensityScale,
    mylarMat,
    holographicTex,
  ]);

  useEffect(() => {
    holographicFoilMat.envMapIntensity = FOIL_ENV_BASE * envIntensityScale;
    multiChromeMat.envMapIntensity = CHROME_ENV_BASE * envIntensityScale;
    prismaticFoilMat.envMapIntensity = PRISM_ENV_BASE * envIntensityScale;
    holographicFoilMat.needsUpdate = true;
    multiChromeMat.needsUpdate = true;
    prismaticFoilMat.needsUpdate = true;
  }, [envIntensityScale, holographicFoilMat, multiChromeMat, prismaticFoilMat]);

  // Pick the active Layer 1 material — matches BagMesh's traversal logic.
  const layer1Material: THREE.Material = useMemo(() => {
    if (finish === "foil") return holographicFoilMat;
    if (finish === "prismatic") return prismaticFoilMat;
    if (iridescence > 0) return multiChromeMat;
    return mylarMat;
  }, [finish, iridescence, mylarMat, holographicFoilMat, prismaticFoilMat, multiChromeMat]);

  // ── Layer 2 + Layer 3 decal materials ─────────────────────────────────────
  // MeshPhysicalMaterial instead of MeshStandardMaterial so the Varnish toggle
  // can reach for clearcoat + bumpMap. With varnish off these behave exactly
  // like MeshStandardMaterial — clearcoat and bumpMap stay at their defaults.
  const makeDecalMat = (offset: number) =>
    new THREE.MeshPhysicalMaterial({
      metalness: 0,
      roughness: 0.5,
      envMapIntensity: DECAL_ENV_BASE,
      transparent: true,
      alphaTest: 0.01,
      side: THREE.FrontSide,
      polygonOffset: true,
      polygonOffsetFactor: offset,
      polygonOffsetUnits: offset,
    });
  const layer2Mat = useMemo(() => makeDecalMat(-4), []);
  const layer3Mat = useMemo(() => makeDecalMat(-8), []);

  // ── Material-mode masked variants (Layer 2 + Layer 3) ────────────────────
  // When a layer's Material checkbox is on, the artwork's alpha becomes a
  // cutout mask and the revealed pixels paint with the current Layer 1
  // finish — a metal cutout, foil cutout, prismatic cutout, etc. Each
  // variant mirrors a Layer 1 shader but crucially does NOT clobber
  // gl_FragColor.a, so the alphaMap chain can attenuate visibility by the
  // uploaded artwork's alpha channel. Variants are built per layer with
  // deeper polygonOffsets so they never z-fight Layer 2 against Layer 3.

  type MaskedSet = {
    /** Physical (metallic / matte / gloss / satin / custom) — iridescence
     *  slots in for Multi-Chrome-ish presets when useful. */
    mylar: THREE.MeshPhysicalMaterial;
    /** Holographic Foil shader masked by alpha. */
    foil: THREE.MeshPhysicalMaterial;
    /** Prismatic Foil shader masked by alpha. */
    prismatic: THREE.MeshPhysicalMaterial;
    /** Multi-Chrome shader masked by alpha. */
    chrome: THREE.MeshPhysicalMaterial;
  };

  const buildMaskedSet = (polyOffset: number): MaskedSet => {
    const commonTransparent = {
      side: THREE.FrontSide,
      transparent: true,
      alphaTest: 0.01,
      polygonOffset: true,
      polygonOffsetFactor: polyOffset,
      polygonOffsetUnits: polyOffset,
    };

    const mylar = new THREE.MeshPhysicalMaterial({
      envMapIntensity: MYLAR_ENV_BASE,
      ...commonTransparent,
    });

    const foil = new THREE.MeshPhysicalMaterial({
      metalness: 1.0,
      roughness: 0.0,
      envMapIntensity: FOIL_ENV_BASE,
      ...commonTransparent,
    });
    foil.onBeforeCompile = (shader) => {
      shader.vertexShader = `varying vec3 vWorldPos;\n` + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace(
        "#include <worldpos_vertex>",
        `#include <worldpos_vertex>
        vWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`
      );
      shader.fragmentShader =
        `varying vec3 vWorldPos;\n` + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <dithering_fragment>",
        `#include <dithering_fragment>
        vec3 wN = normalize(vNormal);
        vec3 vd = normalize(cameraPosition - vWorldPos);
        float ndv = clamp(dot(wN, vd), 0.0, 1.0);
        float scale = 28.0;
        vec2 cell = fract(vec2(vWorldPos.x, vWorldPos.y) * scale) - 0.5;
        float dist = length(cell);
        float circle = 1.0 - smoothstep(0.28, 0.42, dist);
        vec2 cellId = floor(vec2(vWorldPos.x, vWorldPos.y) * scale);
        float cellOffset = fract(sin(cellId.x * 127.1 + cellId.y * 311.7) * 0.12);
        float cellHue = fract(ndv * 1.8 + wN.x * 0.5 + wN.y * 0.3 + cellOffset);
        vec3 rainbow = clamp(abs(mod(cellHue * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
        vec3 chrome = vec3(0.85, 0.90, 0.95);
        vec3 dotColor = mix(chrome, rainbow, 0.55);
        vec3 foilColor = mix(chrome, dotColor, circle * 0.80);
        gl_FragColor.rgb = mix(gl_FragColor.rgb, foilColor, 0.85);
        // gl_FragColor.a intentionally left alone — the alphaMap chain has
        // already attenuated it by the artwork's alpha, which is the mask.`
      );
    };

    const prismatic = new THREE.MeshPhysicalMaterial({
      metalness: 1.0,
      roughness: 0.0,
      envMapIntensity: PRISM_ENV_BASE,
      ...commonTransparent,
    });
    prismatic.onBeforeCompile = (shader) => {
      shader.vertexShader = `varying vec3 vWorldPos;\n` + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace(
        "#include <worldpos_vertex>",
        `#include <worldpos_vertex>
        vWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`
      );
      shader.fragmentShader =
        `varying vec3 vWorldPos;\n` + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <dithering_fragment>",
        `#include <dithering_fragment>
        vec3 wN = normalize(vNormal);
        vec3 vd = normalize(cameraPosition - vWorldPos);
        float ndv = clamp(dot(wN, vd), 0.0, 1.0);
        float ca = 0.7986;
        float sa = 0.6018;
        vec2 rot = vec2(vWorldPos.x * ca - vWorldPos.y * sa,
                        vWorldPos.x * sa + vWorldPos.y * ca);
        float grating = sin(rot.x * 220.0) * 0.5 + 0.5;
        float hue = fract(
          rot.y * 4.5 + ndv * 1.4 + wN.x * 0.35 + wN.y * 0.25
        );
        vec3 rainbow = clamp(abs(mod(hue * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
        vec3 chrome = vec3(0.90, 0.93, 0.98);
        vec3 prismBand = mix(chrome, rainbow, 0.72);
        vec3 finalColor = mix(chrome * 0.88, prismBand, 0.55 + grating * 0.45);
        gl_FragColor.rgb = mix(gl_FragColor.rgb, finalColor, 0.85);
        // gl_FragColor.a left alone — alphaMap chain handles cutout.`
      );
    };

    const chrome = new THREE.MeshPhysicalMaterial({
      metalness: 1.0,
      roughness: 0.0,
      envMapIntensity: CHROME_ENV_BASE,
      ...commonTransparent,
    });
    chrome.onBeforeCompile = (shader) => {
      shader.vertexShader = `varying vec3 vWorldPos;\n` + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace(
        "#include <worldpos_vertex>",
        `#include <worldpos_vertex>
        vWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`
      );
      shader.fragmentShader =
        `varying vec3 vWorldPos;\n` + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <dithering_fragment>",
        `#include <dithering_fragment>
        vec3 wN = normalize(vNormal);
        vec3 vd = normalize(cameraPosition - vWorldPos);
        float ndv = clamp(dot(wN, vd), 0.0, 1.0);
        float normalHue = wN.x * 0.50 + wN.y * 0.30 + wN.z * 0.20;
        float detail =
          sin(vWorldPos.x * 2.2 + vWorldPos.y * 1.8) * 0.12 +
          sin(vWorldPos.y * 1.5 - vWorldPos.z * 2.0) * 0.08;
        float hue = fract(normalHue * 0.6 + detail + ndv * 0.35 + 0.15);
        vec3 chrome0 = vec3(0.82, 0.87, 0.94);
        vec3 blue   = vec3(0.30, 0.40, 0.95);
        vec3 purple = vec3(0.58, 0.22, 0.88);
        vec3 pink   = vec3(0.95, 0.38, 0.72);
        vec3 palColor;
        float t4 = hue * 4.0;
        if (t4 < 1.0)      palColor = mix(chrome0, blue,   t4);
        else if (t4 < 2.0) palColor = mix(blue,   purple, t4 - 1.0);
        else if (t4 < 3.0) palColor = mix(purple, pink,   t4 - 2.0);
        else               palColor = mix(pink,   chrome0, t4 - 3.0);
        gl_FragColor.rgb = mix(gl_FragColor.rgb, palColor, 0.75);
        // gl_FragColor.a left alone — alphaMap chain handles cutout.`
      );
    };

    return { mylar, foil, prismatic, chrome };
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const layer2MaskedSet = useMemo(() => buildMaskedSet(-4), []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const layer3MaskedSet = useMemo(() => buildMaskedSet(-8), []);

  const [layer2Tex, setLayer2Tex] = useState<THREE.Texture | null>(null);
  const [layer3Tex, setLayer3Tex] = useState<THREE.Texture | null>(null);
  const [layer2BumpTex, setLayer2BumpTex] = useState<THREE.CanvasTexture | null>(null);
  const [layer3BumpTex, setLayer3BumpTex] = useState<THREE.CanvasTexture | null>(null);

  useEffect(() => {
    if (!layer2TextureUrl) { setLayer2Tex(null); return; }
    const signal = { cancelled: false };
    loadLabelTexture(layer2TextureUrl, signal).then((tex) => {
      if (!signal.cancelled && tex) setLayer2Tex(tex);
    });
    return () => { signal.cancelled = true; };
  }, [layer2TextureUrl]);

  useEffect(() => {
    if (!layer3TextureUrl) { setLayer3Tex(null); return; }
    const signal = { cancelled: false };
    loadLabelTexture(layer3TextureUrl, signal).then((tex) => {
      if (!signal.cancelled && tex) setLayer3Tex(tex);
    });
    return () => { signal.cancelled = true; };
  }, [layer3TextureUrl]);

  // Alpha-channel bump maps used by the Varnish toggle so clearcoat only
  // raises the surface where the artwork is opaque.
  useEffect(() => {
    if (!layer2Tex) { setLayer2BumpTex(null); return; }
    const tex = buildAlphaBumpTexture(layer2Tex);
    setLayer2BumpTex(tex);
    return () => { tex?.dispose(); };
  }, [layer2Tex]);

  useEffect(() => {
    if (!layer3Tex) { setLayer3BumpTex(null); return; }
    const tex = buildAlphaBumpTexture(layer3Tex);
    setLayer3BumpTex(tex);
    return () => { tex?.dispose(); };
  }, [layer3Tex]);

  // Layer 2 artwork material — always artwork mode. Varnish overrides to a
  // glossy clearcoat overprint with a subtle alpha-derived bump. This
  // material only renders when the Material checkbox is OFF; when Material
  // is ON the mesh picks up `layer2Masked` instead.
  useEffect(() => {
    layer2Mat.map = layer2Tex;
    if (layer2Varnish) {
      layer2Mat.metalness = 0;
      layer2Mat.roughness = VARNISH_ROUGHNESS;
      layer2Mat.clearcoat = VARNISH_CLEARCOAT;
      layer2Mat.clearcoatRoughness = VARNISH_CLEARCOAT_ROUGHNESS;
      layer2Mat.bumpMap = layer2BumpTex;
      layer2Mat.bumpScale = VARNISH_BUMP_SCALE;
    } else {
      layer2Mat.metalness = layer2Metalness;
      layer2Mat.roughness = layer2Roughness;
      layer2Mat.clearcoat = 0;
      layer2Mat.clearcoatRoughness = 0;
      layer2Mat.bumpMap = null;
      layer2Mat.bumpScale = 0;
    }
    layer2Mat.envMapIntensity = DECAL_ENV_BASE * envIntensityScale;
    layer2Mat.needsUpdate = true;
  }, [layer2Tex, layer2BumpTex, layer2Metalness, layer2Roughness, layer2Varnish, envIntensityScale, layer2Mat]);

  // Resolve the effective Material-mode surface for a given layer. Each
  // layer can override Layer 1's finish via `matFinish`; when omitted or set
  // to undefined the layer inherits Layer 1 (backwards-compatible with saves
  // from before per-layer finishes existed).
  //
  // Returns the concrete numbers used by syncMaskedSet so the consumer
  // doesn't need to understand BagFinish at all — everything collapses to
  // metalness / roughness / iridescence numbers that three.js can consume.
  type LayerSurface = {
    finish: BagFinish;
    metalness: number;
    roughness: number;
    iridescence: number;
    iridescenceIOR: number;
    iridescenceThicknessRange: [number, number];
  };
  const resolveLayerSurface = (
    matFinish: BagFinish | undefined,
    matCustomMet: number | undefined,
    matCustomRough: number | undefined
  ): LayerSurface => {
    // Null/undefined → fall back to Layer 1's already-resolved config.
    if (!matFinish) {
      return {
        finish,
        metalness,
        roughness,
        iridescence,
        iridescenceIOR,
        iridescenceThicknessRange,
      };
    }
    if (matFinish === "custom") {
      return {
        finish: "custom",
        metalness: matCustomMet ?? metalness,
        roughness: matCustomRough ?? roughness,
        iridescence: 0,
        iridescenceIOR: 1.5,
        iridescenceThicknessRange: [100, 800],
      };
    }
    const preset = FINISH_PRESETS[matFinish];
    return {
      finish: matFinish,
      metalness: preset.metalness,
      roughness: preset.roughness,
      iridescence: preset.iridescence ?? 0,
      iridescenceIOR: preset.iridescenceIOR ?? 1.5,
      iridescenceThicknessRange: preset.iridescenceThicknessRange ?? [100, 800],
    };
  };

  const layer2Surface = useMemo(
    () => resolveLayerSurface(layer2MatFinish, layer2MatMetalness, layer2MatRoughness),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [layer2MatFinish, layer2MatMetalness, layer2MatRoughness, finish, metalness, roughness, iridescence, iridescenceIOR, iridescenceThicknessRange]
  );
  const layer3Surface = useMemo(
    () => resolveLayerSurface(layer3MatFinish, layer3MatMetalness, layer3MatRoughness),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [layer3MatFinish, layer3MatMetalness, layer3MatRoughness, finish, metalness, roughness, iridescence, iridescenceIOR, iridescenceThicknessRange]
  );

  // Sync masked-material variants for each layer. The artwork texture is
  // bound as `map` (its .a channel attenuates diffuseColor.a — three's
  // built-in `alphaMap` would sample .g and misread our RGBA artwork).
  // Each variant's shader leaves gl_FragColor.a alone so the alphaMap chain
  // produces the artwork cutout. The mylar variant is tuned with the
  // layer's own resolved surface so e.g. a layer set to Matte produces a
  // matte cutout even if Layer 1 is Gloss.
  const syncMaskedSet = (
    set: MaskedSet,
    tex: THREE.Texture | null,
    surface: LayerSurface
  ) => {
    // Mylar variant — mirror this layer's resolved physical surface.
    set.mylar.map = tex;
    set.mylar.color.set(labelColor);
    set.mylar.metalness = surface.metalness;
    set.mylar.roughness = surface.roughness;
    set.mylar.iridescence = surface.iridescence;
    set.mylar.iridescenceIOR = surface.iridescenceIOR;
    set.mylar.iridescenceThicknessRange = surface.iridescenceThicknessRange;
    if (surface.iridescence > 0) {
      set.mylar.iridescenceThicknessMap = holographicTex;
      set.mylar.iridescenceThicknessRange = [0, 1200];
      set.mylar.color.set("#ffffff");
    } else {
      set.mylar.iridescenceThicknessMap = null;
    }
    set.mylar.envMapIntensity = MYLAR_ENV_BASE * envIntensityScale;
    set.mylar.needsUpdate = true;

    set.foil.map = tex;
    set.foil.envMapIntensity = FOIL_ENV_BASE * envIntensityScale;
    set.foil.needsUpdate = true;

    set.prismatic.map = tex;
    set.prismatic.envMapIntensity = PRISM_ENV_BASE * envIntensityScale;
    set.prismatic.needsUpdate = true;

    set.chrome.map = tex;
    set.chrome.envMapIntensity = CHROME_ENV_BASE * envIntensityScale;
    set.chrome.needsUpdate = true;
  };

  useEffect(() => {
    syncMaskedSet(layer2MaskedSet, layer2Tex, layer2Surface);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    layer2Tex,
    labelColor,
    layer2Surface,
    envIntensityScale,
    layer2MaskedSet,
    holographicTex,
  ]);

  useEffect(() => {
    syncMaskedSet(layer3MaskedSet, layer3Tex, layer3Surface);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    layer3Tex,
    labelColor,
    layer3Surface,
    envIntensityScale,
    layer3MaskedSet,
    holographicTex,
  ]);

  // Pick the active masked variant for each layer based on ITS OWN finish.
  // Iridescence > 0 (Multi-Chrome preset) routes to the chrome shader rather
  // than mylar so the rainbow reads properly.
  const pickMasked = (set: MaskedSet, surface: LayerSurface): THREE.Material => {
    if (surface.finish === "foil") return set.foil;
    if (surface.finish === "prismatic") return set.prismatic;
    if (surface.finish === "multi-chrome" || surface.iridescence > 0) return set.chrome;
    return set.mylar;
  };
  const layer2Masked = useMemo(
    () => pickMasked(layer2MaskedSet, layer2Surface),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [layer2Surface, layer2MaskedSet]
  );
  const layer3Masked = useMemo(
    () => pickMasked(layer3MaskedSet, layer3Surface),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [layer3Surface, layer3MaskedSet]
  );

  useEffect(() => {
    layer3Mat.map = layer3Tex;
    if (layer3Varnish) {
      layer3Mat.metalness = 0;
      layer3Mat.roughness = VARNISH_ROUGHNESS;
      layer3Mat.clearcoat = VARNISH_CLEARCOAT;
      layer3Mat.clearcoatRoughness = VARNISH_CLEARCOAT_ROUGHNESS;
      layer3Mat.bumpMap = layer3BumpTex;
      layer3Mat.bumpScale = VARNISH_BUMP_SCALE;
    } else {
      layer3Mat.metalness = layer3Metalness;
      layer3Mat.roughness = layer3Roughness;
      layer3Mat.clearcoat = 0;
      layer3Mat.clearcoatRoughness = 0;
      layer3Mat.bumpMap = null;
      layer3Mat.bumpScale = 0;
    }
    layer3Mat.envMapIntensity = DECAL_ENV_BASE * envIntensityScale;
    layer3Mat.needsUpdate = true;
  }, [layer3Tex, layer3BumpTex, layer3Metalness, layer3Roughness, layer3Varnish, envIntensityScale, layer3Mat]);

  // ── Scene processing (body + label) ───────────────────────────────────────
  // Body: hide the old glb's built-in label (any non-Plastic primitive) and
  // swap our plastic material in over the remaining body/lid meshes.
  const processedBodyScene = useMemo(() => {
    const clone = bodyScene.clone(true);
    clone.traverse((obj) => {
      const m = obj as THREE.Mesh;
      if (!m.isMesh || !m.geometry) return;
      const mat = m.material as THREE.Material | undefined;
      if (mat?.name === "Plastic") {
        m.castShadow = true;
        m.receiveShadow = true;
      } else {
        m.visible = false;
      }
    });
    return clone;
  }, [bodyScene]);

  // Keep the plastic material assignment reactive so env-scale updates land.
  useEffect(() => {
    processedBodyScene.traverse((obj) => {
      const m = obj as THREE.Mesh;
      if (!m.isMesh || !m.visible) return;
      m.material = plasticMat;
    });
  }, [processedBodyScene, plasticMat]);

  // Label: clone the label-only glb, bake each primitive's world matrix into
  // its geometry, merge them all into one BufferGeometry, weld vertices that
  // share a position so smooth-normal computation can cross primitive
  // boundaries (without this you get hard creases at every primitive seam,
  // which read as dark vertical stripes under reflective materials), then
  // reproject UVs onto a cylinder. The final geometry is shared by Layer 1
  // (base material), Layer 2 (artwork/foil), and Layer 3 (artwork/foil).
  const labelGeo = useMemo(() => {
    const clone = labelScene.clone(true);
    clone.updateMatrixWorld(true);

    const collected: THREE.BufferGeometry[] = [];
    clone.traverse((obj) => {
      const m = obj as THREE.Mesh;
      if (!m.isMesh || !m.geometry?.attributes?.position) return;
      // Strip to position-only and normalise to non-indexed so mergeGeometries
      // never trips on attribute mismatches or mixed indexed/non-indexed
      // primitives (it returns null silently if the indexed status differs
      // between inputs).
      const src = m.geometry;
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", src.attributes.position.clone());
      if (src.index) g.setIndex(src.index.clone());
      g.applyMatrix4(m.matrixWorld);
      collected.push(g.toNonIndexed());
    });

    if (collected.length === 0) return new THREE.BufferGeometry();

    const merged =
      collected.length === 1
        ? collected[0]
        : mergeGeometries(collected, false);
    if (!merged) return new THREE.BufferGeometry();

    // Weld coincident vertices using a tolerance scaled to the label's actual
    // size — the label GLB is in tiny native units (~0.002 wide), so the
    // default 1e-4 would weld together vertices that are an entire edge
    // apart. Use 0.1% of the bounding box diagonal as the weld threshold.
    merged.computeBoundingBox();
    const bb = merged.boundingBox!;
    const diag = bb.min.distanceTo(bb.max);
    const weldTol = Math.max(diag * 0.001, 1e-7);

    const welded = mergeVertices(merged, weldTol);
    welded.computeVertexNormals();

    // Compute Y extent for the cylindrical V coordinate, and the largest
    // angular gap around the cylinder so the texture seam can hide inside
    // the physical opening on the back of the label. The label GLB ships
    // with a deliberate gap in its wrap; we bin angles into discrete buckets,
    // find the widest empty arc, and seat the seam at its midpoint.
    const pos = welded.attributes.position as THREE.BufferAttribute;
    let yMin = Infinity;
    let yMax = -Infinity;

    const ANGLE_BINS = 720; // 0.5° resolution
    const occupied = new Uint8Array(ANGLE_BINS);
    const TWO_PI = Math.PI * 2;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      if (y < yMin) yMin = y;
      if (y > yMax) yMax = y;
      // Skip vertices on (or extremely near) the cylinder axis where atan2
      // is numerically unstable and doesn't reflect a real surface angle.
      if (x * x + z * z < 1e-14) continue;
      let a = Math.atan2(z, x); // [-π, π]
      if (a < 0) a += TWO_PI; // [0, 2π)
      const bin = Math.floor((a / TWO_PI) * ANGLE_BINS) % ANGLE_BINS;
      occupied[bin] = 1;
    }

    // Walk the ring twice so we find the longest empty run even if it
    // straddles the bin-0 boundary.
    let bestStart = 0;
    let bestLen = 0;
    let curStart = 0;
    let curLen = 0;
    for (let i = 0; i < ANGLE_BINS * 2; i++) {
      const bin = i % ANGLE_BINS;
      if (occupied[bin] === 0) {
        if (curLen === 0) curStart = i;
        curLen++;
        if (curLen > bestLen) {
          bestLen = curLen;
          bestStart = curStart;
        }
      } else {
        curLen = 0;
      }
    }

    // Default to π (back of jar) if the wrap is fully closed; otherwise put
    // the seam in the middle of the largest empty arc.
    let seamAngle = Math.PI;
    if (bestLen > 0 && bestLen < ANGLE_BINS) {
      const midBin = (bestStart + bestLen / 2) % ANGLE_BINS;
      seamAngle = (midBin / ANGLE_BINS) * TWO_PI;
    }

    return cylindricalUVs(welded, yMin, yMax, seamAngle);
  }, [labelScene]);

  // ── Autofit ───────────────────────────────────────────────────────────────
  // Target height 1.0 units — the jar is wider than it is tall, so even with
  // a modest height it still takes up a lot of horizontal viewport.
  //
  // IMPORTANT: targetScale is computed ONCE from the native model bbox, with
  // only `processedBodyScene` as a dependency. If `floating` were in this
  // dep array the useMemo would re-fire when the user switches environments,
  // at which point `processedBodyScene` is already in the scene graph under
  // a group with `scale=[targetScale, …]`. `Box3.setFromObject` returns the
  // WORLD-space bbox (already scaled up), so the new targetScale collapses
  // toward 1 — shrinking the jar to near-invisible. Splitting the two
  // computations avoids this feedback loop.
  const { targetScale, nativeBboxMinY } = useMemo(() => {
    const bbox = new THREE.Box3().setFromObject(processedBodyScene);
    const height = bbox.max.y - bbox.min.y;
    const targetScale = height > 0 ? 1.0 / height : 1000;
    return { targetScale, nativeBboxMinY: bbox.min.y };
  }, [processedBodyScene]);

  // baseGroupY is derived — recalculates whenever floating changes without
  // re-running the bounding-box computation. When `floating`, sits ~0.18
  // above y=-1.28 so the jar floats the same distance above the contact
  // shadow as the bag does in the Default scene; when not floating (Smoke),
  // sits flush on the reflective floor (y=-1.265) so the cast reflection
  // joins seamlessly at the base.
  const FLOAT_GAP = 0.18;
  const FLOOR_Y = floating ? -1.28 : -1.265;
  const baseGroupY = FLOOR_Y + (floating ? FLOAT_GAP : 0) - nativeBboxMinY * targetScale;

  // Gentle hover — same speed/amplitude as the bag's float animation in
  // BagMesh, so swapping models doesn't change the scene's overall motion.
  const groupRef = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (!groupRef.current) return;
    groupRef.current.position.y = floating
      ? baseGroupY + Math.sin(clock.elapsedTime * 0.6) * 0.02
      : baseGroupY;
  });

  return (
    <group
      ref={groupRef}
      scale={[targetScale, targetScale, targetScale]}
      position={[0, baseGroupY, 0]}
    >
      <primitive object={processedBodyScene} />

      {/* Layer 1 — base label material (mylar / foil / chrome / custom). */}
      <mesh
        geometry={labelGeo}
        material={layer1Material}
        castShadow
        receiveShadow
      />

      {/* Layer 2 — artwork decal. With Material ON, the artwork's alpha
           cuts out the current Layer 1 finish (foil/prismatic/chrome/
           matte/…) instead of painting the artwork pixels themselves. With
           Material OFF it's a standard transparent artwork decal (Varnish
           optionally applies a clearcoat overprint). */}
      {layer2Tex && (
        <mesh
          geometry={labelGeo}
          material={layer2Material ? layer2Masked : layer2Mat}
          renderOrder={1}
        />
      )}

      {/* Layer 3 — same behavior as Layer 2, one render order higher so it
           always reads on top when overlapping. */}
      {layer3Tex && (
        <mesh
          geometry={labelGeo}
          material={layer3Material ? layer3Masked : layer3Mat}
          renderOrder={3}
        />
      )}
    </group>
  );
}
