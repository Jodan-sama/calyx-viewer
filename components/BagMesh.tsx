"use client";

import { useRef, useMemo, useEffect, useState } from "react";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { useFrame } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import { FINISH_PRESETS, UV_GLOW_COLOR, type BagFinish, type BagLighting } from "@/lib/bagMaterial";
import { applyPrismaticShader } from "@/lib/foilShaders";
import {
  applyMosaicCrop,
  buildArtworkAlphaMap,
  buildMirroredSourceTexture,
  cloneMosaicTexture,
  loadMosaicTexture,
  resolveMosaicCrop,
} from "@/lib/mosaicTexture";

interface BagMeshProps {
  // ── Base surface (mylar / foil / multi-chrome / custom) ─────────────────
  metalness: number;
  roughness: number;
  color: string;
  iridescence?: number;
  iridescenceIOR?: number;
  iridescenceThicknessRange?: [number, number];
  finish?: string;

  // ── Layer 2 — front + back artwork decals. ──────────────────────────────
  /** Front-panel artwork. Null → no front decal. */
  textureUrl: string | null;
  /** Back-panel artwork. Null → no back decal. */
  backTextureUrl?: string | null;
  labelMetalness: number;
  labelRoughness: number;
  /** When true, the label artwork becomes a glossy clear-varnish overprint
   *  with a tiny alpha-derived bump — only raised where the artwork is
   *  opaque. Background bag surface is unaffected. */
  labelVarnish?: boolean;
  /** When true, Layer 2's artwork alpha becomes a mask and the opaque
   *  pixels paint with the Material finish selected for *this layer* (see
   *  `labelMatFinish`) rather than the artwork's RGB values. */
  labelMaterial?: boolean;
  /** Per-layer Material finish for Layer 2. Falls back to Layer 1's finish
   *  when omitted, preserving the pre-per-layer behaviour for older saves. */
  labelMatFinish?: BagFinish;
  /** Custom metalness for `labelMatFinish === "custom"`. */
  labelMatMetalness?: number;
  /** Custom roughness for `labelMatFinish === "custom"`. */
  labelMatRoughness?: number;

  // ── Layer 3 — optional second artwork layer, stacked above Layer 2. ─────
  /** Layer 3 front-panel artwork. Null → Layer 3 front skipped. */
  layer3FrontTextureUrl?: string | null;
  /** Layer 3 back-panel artwork. Null → Layer 3 back skipped. */
  layer3BackTextureUrl?: string | null;
  layer3Metalness?: number;
  layer3Roughness?: number;
  layer3Varnish?: boolean;
  layer3Material?: boolean;
  /** Per-layer Material finish for Layer 3. Falls back to Layer 1's finish. */
  layer3MatFinish?: BagFinish;
  /** Custom metalness for `layer3MatFinish === "custom"`. */
  layer3MatMetalness?: number;
  /** Custom roughness for `layer3MatFinish === "custom"`. */
  layer3MatRoughness?: number;

  /** Multiplier applied to every material's envMapIntensity — lets the
   *  caller dim the HDRI reflections on the bag without touching the
   *  scene's <Environment>. 1.0 = default, 0.5 = half-strength, etc. */
  envIntensityScale?: number;
  /** When true (Default scene), the bag floats above the contact shadow
   *  with a gentle ±0.02 oscillation. When false (Smoke scene), it sits
   *  flush on the reflective floor so the cast reflection joins seamlessly
   *  at the base. */
  floating?: boolean;

  /** HDRI / scene preset. Only read to gate the UV-blacklight emissive
   *  path — every other preset is handled by the viewer's scene wiring. */
  lighting?: BagLighting;
  /** Tag Layer 2 artwork as fluorescent. Takes effect only when
   *  `lighting === "uv"`; emits UV_GLOW_COLOR through the artwork's
   *  alpha so the decal glows lime-green against a dark scene. */
  labelUV?: boolean;
  /** Same as `labelUV` but for the stacked Layer 3 decal. */
  layer3UV?: boolean;

  /** Mosaic finish — source image shared by every layer set to
   *  finish === "mosaic". Null → mosaic layers skip rendering (fall
   *  through to a neutral placeholder material). */
  mosaicSourceUrl?: string | null;
  /** Mirror the source along its vertical centre before any layer
   *  samples from it — shared across every mosaic layer. */
  mosaicMirror?: boolean;
  /** Crop zoom 0–1. 1 = full-fit aspect-correct crop of the source;
   *  smaller values zoom in and surface finer detail. Shared across
   *  layers so a single slider drives the whole design. */
  mosaicZoom?: number;
  /** Layer 1 mosaic crop seed (normalised 0–1 pair) + flip X/Y toggles. */
  mosaicOffsetU?: number;
  mosaicOffsetV?: number;
  mosaicFlipX?: boolean;
  mosaicFlipY?: boolean;
  /** Bag Layer 2 mosaic crop seed + flip X/Y toggles. */
  labelMosaicOffsetU?: number;
  labelMosaicOffsetV?: number;
  labelMosaicFlipX?: boolean;
  labelMosaicFlipY?: boolean;
  /** Bag Layer 3 mosaic crop seed + flip X/Y toggles. */
  layer3MosaicOffsetU?: number;
  layer3MosaicOffsetV?: number;
  layer3MosaicFlipX?: boolean;
  layer3MosaicFlipY?: boolean;
}

// Base env-map intensities per material — the scale prop multiplies into these.
// Base envMapIntensity multipliers, further scaled by the scene's
// dim/HDRI sliders at runtime. Originally the mylar was cranked to
// 2.0 for a chrome look while the label sat at 0.5 so artwork colors
// would stay legible — but that 4× gap made it look like only one
// material "caught the light" when the user rotated the bag, since
// the same HDRI direction rendered as a saturated hotspot on the
// mylar and a barely-visible tint on the label. Narrowing the gap
// to ~2× (1.6 vs 0.9) keeps the mylar obviously more reflective
// than the label without making reflection look like it only
// happens on one or the other.
const MYLAR_ENV_BASE = 1.6;
const LABEL_ENV_BASE = 0.9;
const FOIL_ENV_BASE = 0.6;
const CHROME_ENV_BASE = 0.25;
const PRISM_ENV_BASE = 0.45;

// Varnish tuning — subtle raise, full clearcoat gloss.
const VARNISH_BUMP_SCALE = 0.008;
const VARNISH_CLEARCOAT = 1.0;
const VARNISH_CLEARCOAT_ROUGHNESS = 0.02;
const VARNISH_ROUGHNESS = 0.05;

/** Builds a greyscale CanvasTexture whose pixel brightness equals the source
 *  texture's alpha channel, so it can be plugged straight into MeshPhysical
 *  Material.bumpMap to raise the surface only where artwork is opaque. */
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
  tex.colorSpace = THREE.NoColorSpace; // bump maps are linear intensity
  tex.anisotropy = 16;
  return tex;
}

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

// Draco-compressed (7.4 MB → 418 KB). The `true` second arg turns on
// drei's built-in DRACOLoader; the decoder wasm + JS are fetched once
// from www.gstatic.com/draco/ (cached across the session) and shared
// with every other useGLTF(url, true) call in the app.
useGLTF.preload("/mylar_bag.glb", true);

// ── Label geometry extractor ─────────────────────────────────────────────────
// Collects every mesh triangle under the bag root, normalises vertex
// attributes so they can be merged, then filters at the triangle level by
// centroid-Z to split the merged geometry into front/back panels. Back UVs
// are mirrored on X so uploaded artwork reads correctly from behind.
//
// NOTE: we intentionally do NOT pre-filter at the mesh level. An earlier
// version sampled each mesh's average normal and dropped meshes whose avg
// pointed opposite to the side being built — but that heuristic cut out
// the right half of the back panel in the GLB, because the sampled normals
// of that chunk skewed front-ish. Triangle-level centroid-Z is the
// authoritative classifier, so we let every mesh in and filter per-triangle.
function buildLabelGeo(
  rootGroup: THREE.Group,
  side: "front" | "back"
): THREE.BufferGeometry | null {
  const groupInv = new THREE.Matrix4()
    .copy(rootGroup.matrixWorld)
    .invert();
  const collected: THREE.BufferGeometry[] = [];

  rootGroup.traverse((obj) => {
    const m = obj as THREE.Mesh;
    if (!m.isMesh || !m.geometry?.attributes?.position) return;

    // Build a fresh geometry holding ONLY position/normal/uv so the
    // subsequent mergeGeometries() call never fails on attribute mismatch
    // (the GLB has meshes with varying secondary UV sets and tangents).
    const src = m.geometry;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", src.attributes.position.clone());
    if (src.attributes.normal) {
      g.setAttribute("normal", src.attributes.normal.clone());
    }
    if (src.attributes.uv) {
      g.setAttribute("uv", src.attributes.uv.clone());
    } else {
      g.setAttribute(
        "uv",
        new THREE.BufferAttribute(
          new Float32Array(src.attributes.position.count * 2),
          2
        )
      );
    }
    if (src.index) g.setIndex(src.index.clone());

    g.applyMatrix4(
      new THREE.Matrix4().multiplyMatrices(groupInv, m.matrixWorld)
    );
    collected.push(g);
  });

  if (collected.length === 0) return null;

  const merged =
    collected.length === 1
      ? collected[0]
      : mergeGeometries(collected, false);
  if (!merged) return null;
  const geo = merged;

  geo.computeVertexNormals();

  // Triangle-level filter by centroid Z.
  // After baking, group-local Z range is ≈ -0.021 (back) to +0.021 (front).
  const pos0 = geo.attributes.position as THREE.BufferAttribute;
  const idx = geo.index;
  if (idx) {
    const keep: number[] = [];
    for (let i = 0; i < idx.count; i += 3) {
      const ia = idx.getX(i),
        ib = idx.getX(i + 1),
        ic = idx.getX(i + 2);
      const cz =
        (pos0.getZ(ia) + pos0.getZ(ib) + pos0.getZ(ic)) / 3;
      if (side === "front" && cz > 0.0) keep.push(ia, ib, ic);
      else if (side === "back" && cz < 0.0) keep.push(ia, ib, ic);
    }
    geo.setIndex(keep);
  }
  geo.computeVertexNormals();

  // Per-vertex outward-flip: any vertex whose stored normal Z
  // disagrees with this panel's outward direction gets negated
  // individually. A whole-panel consensus-sum check (the prior
  // version) silently skipped the fix whenever mixed winding made
  // the panel's average Z land near zero — leaving a subset of
  // triangles with inward normals that killed direct-light
  // reflections on the back-panel artwork in lit scenes like Rave.
  const normals = geo.attributes.normal as THREE.BufferAttribute;
  const outwardZ = side === "front" ? 1 : -1;
  let flipped = false;
  for (let i = 0; i < normals.count; i++) {
    if (normals.getZ(i) * outwardZ < 0) {
      normals.setXYZ(
        i,
        -normals.getX(i),
        -normals.getY(i),
        -normals.getZ(i)
      );
      flipped = true;
    }
  }
  if (flipped) normals.needsUpdate = true;

  // UVs from XY bounds; mirror U for the back so art reads correctly.
  const posAttr = geo.attributes.position as THREE.BufferAttribute;
  const uvAttr = geo.attributes.uv as THREE.BufferAttribute;
  let xMin = Infinity,
    xMax = -Infinity,
    yMin = Infinity,
    yMax = -Infinity;
  for (let i = 0; i < posAttr.count; i++) {
    const x = posAttr.getX(i),
      y = posAttr.getY(i);
    if (x < xMin) xMin = x;
    if (x > xMax) xMax = x;
    if (y < yMin) yMin = y;
    if (y > yMax) yMax = y;
  }
  const xRange = xMax - xMin,
    yRange = yMax - yMin;
  for (let i = 0; i < uvAttr.count; i++) {
    const u = (posAttr.getX(i) - xMin) / xRange;
    const v = (posAttr.getY(i) - yMin) / yRange;
    uvAttr.setXY(i, side === "back" ? 1 - u : u, v);
  }
  uvAttr.needsUpdate = true;

  // Stash the physical aspect ratio on the geometry for the mosaic
  // material to read. UVs run 0–1 over the bounding rectangle, so a
  // square source crop would squash to the panel's aspect; the mosaic
  // shader compensates by setting repeat.x/repeat.y to match.
  geo.userData.panelAspect = yRange > 0 ? xRange / yRange : 1;

  return geo;
}

// Shared label-texture loader: decodes the image, zeroes pure-transparent
// pixels (fixes haloing on PNG alpha), and wraps it in a CanvasTexture.
async function loadLabelTexture(
  url: string,
  signal: { cancelled: boolean }
): Promise<THREE.CanvasTexture | null> {
  try {
    const blob = await fetch(url).then((r) => r.blob());
    const bitmap = await createImageBitmap(blob, {
      premultiplyAlpha: "none",
    });
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
    return tex;
  } catch (e) {
    console.error("Texture load failed:", e);
    return null;
  }
}

export default function BagMesh({
  textureUrl,
  backTextureUrl = null,
  metalness,
  roughness,
  color,
  labelMetalness,
  labelRoughness,
  iridescence = 0,
  iridescenceIOR = 1.5,
  iridescenceThicknessRange = [100, 800],
  finish = "",
  labelVarnish = false,
  labelMaterial = false,
  labelMatFinish,
  labelMatMetalness,
  labelMatRoughness,
  layer3FrontTextureUrl = null,
  layer3BackTextureUrl = null,
  layer3Metalness = 0.1,
  layer3Roughness = 0.5,
  layer3Varnish = false,
  layer3Material = false,
  layer3MatFinish,
  layer3MatMetalness,
  layer3MatRoughness,
  lighting,
  labelUV = false,
  layer3UV = false,
  envIntensityScale = 1,
  floating = true,
  mosaicSourceUrl = null,
  mosaicMirror = false,
  mosaicZoom = 1,
  mosaicOffsetU = 0,
  mosaicOffsetV = 0,
  mosaicFlipX = false,
  mosaicFlipY = false,
  labelMosaicOffsetU = 0,
  labelMosaicOffsetV = 0,
  labelMosaicFlipX = false,
  labelMosaicFlipY = false,
  layer3MosaicOffsetU = 0,
  layer3MosaicOffsetV = 0,
  layer3MosaicFlipX = false,
  layer3MosaicFlipY = false,
}: BagMeshProps) {
  // ── Refs ───────────────────────────────────────────────────────────────────
  const groupRef = useRef<THREE.Group>(null);
  const decalDirty = useRef(true);

  // ── Scene ──────────────────────────────────────────────────────────────────
  const { scene } = useGLTF("/mylar_bag.glb", true) as { scene: THREE.Group };

  const holographicTex = useMemo(() => buildHolographicTexture(), []);

  // ── Holographic Foil shader ────────────────────────────────────────────────
  const holographicFoilMat = useMemo(() => {
    const mat = new THREE.MeshPhysicalMaterial({
      metalness: 1.0, roughness: 0.0, envMapIntensity: FOIL_ENV_BASE, side: THREE.DoubleSide,
    });
    mat.onBeforeCompile = (shader) => {
      shader.vertexShader = `varying vec3 vWorldPos;\n` + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
        vWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`
      );
      shader.fragmentShader = `varying vec3 vWorldPos;\n` + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <dithering_fragment>',
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

  // ── Prismatic Foil shader ──────────────────────────────────────────────────
  // Diffraction-grating look — fine diagonal streaks with a rainbow spectrum
  // that shifts along the streak direction and with view angle. Reads as a
  // linear prism-split rainbow rather than the holographic's dot-cell pattern.
  const prismaticFoilMat = useMemo(() => {
    const mat = new THREE.MeshPhysicalMaterial({
      metalness: 1.0, roughness: 0.0, envMapIntensity: PRISM_ENV_BASE, side: THREE.DoubleSide,
    });
    applyPrismaticShader(mat, { mixStrength: 0.6, preserveAlpha: false });
    return mat;
  }, []);

  // ── Multi-chrome shader ────────────────────────────────────────────────────
  const multiChromeMat = useMemo(() => {
    const mat = new THREE.MeshPhysicalMaterial({
      metalness: 1.0, roughness: 0.0, envMapIntensity: CHROME_ENV_BASE, side: THREE.DoubleSide,
    });
    mat.onBeforeCompile = (shader) => {
      shader.vertexShader = `varying vec3 vWorldPos;\n` + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
        vWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`
      );
      shader.fragmentShader = `varying vec3 vWorldPos;\n` + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <dithering_fragment>',
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

  // ── Texture loading (front + back) ─────────────────────────────────────────
  const [frontTex, setFrontTex] = useState<THREE.Texture | null>(null);
  const [backTex, setBackTex] = useState<THREE.Texture | null>(null);

  useEffect(() => {
    if (!textureUrl) {
      setFrontTex(null);
      decalDirty.current = true;
      return;
    }
    const signal = { cancelled: false };
    loadLabelTexture(textureUrl, signal).then((tex) => {
      if (!signal.cancelled && tex) {
        decalDirty.current = true;
        setFrontTex(tex);
      }
    });
    return () => {
      signal.cancelled = true;
    };
  }, [textureUrl]);

  useEffect(() => {
    if (!backTextureUrl) {
      setBackTex(null);
      decalDirty.current = true;
      return;
    }
    const signal = { cancelled: false };
    loadLabelTexture(backTextureUrl, signal).then((tex) => {
      if (!signal.cancelled && tex) {
        decalDirty.current = true;
        setBackTex(tex);
      }
    });
    return () => {
      signal.cancelled = true;
    };
  }, [backTextureUrl]);

  // No fallback texture — if art hasn't loaded yet the decal mesh is skipped
  // entirely rather than flashing a placeholder.
  const frontLabelTex = frontTex;
  const backLabelTex = backTex;

  // ── Label geometry state (front + back, rebuilt on decalDirty) ───────────
  // Declared up-front so mosaic sync effects can read the per-panel aspect
  // off `geo.userData.panelAspect` without a TDZ crash. The actual rebuild
  // useFrame lives further down alongside the float animation.
  const [frontLabelGeo, setFrontLabelGeo] = useState<THREE.BufferGeometry | null>(null);
  const [backLabelGeo, setBackLabelGeo] = useState<THREE.BufferGeometry | null>(null);
  useEffect(() => () => { frontLabelGeo?.dispose(); }, [frontLabelGeo]);
  useEffect(() => () => { backLabelGeo?.dispose(); }, [backLabelGeo]);

  // ── Mosaic source texture ─────────────────────────────────────────────────
  // Shared by every layer whose finish is "mosaic". Each consuming material
  // gets its own Texture clone (see the masked set build) so offset/repeat
  // don't stomp each other across layers/panels.
  //
  // `rawMosaicTex` is the user's uploaded image verbatim; `mosaicSourceTex`
  // is what the layers actually sample from — either the raw texture or a
  // centre-mirrored canvas derived from it (when the Mirror toggle is on).
  // Splitting the two lets us toggle Mirror without re-fetching the
  // upload: we keep the raw bytes and regenerate the mirrored canvas
  // cheaply when the flag flips.
  const [rawMosaicTex, setRawMosaicTex] = useState<THREE.Texture | null>(null);
  useEffect(() => {
    if (!mosaicSourceUrl) { setRawMosaicTex(null); return; }
    const signal = { cancelled: false };
    loadMosaicTexture(mosaicSourceUrl, signal).then((tex) => {
      if (!signal.cancelled && tex) setRawMosaicTex(tex);
    });
    return () => { signal.cancelled = true; };
  }, [mosaicSourceUrl]);

  const [mosaicSourceTex, setMosaicSourceTex] = useState<THREE.Texture | null>(null);
  useEffect(() => {
    if (!rawMosaicTex) { setMosaicSourceTex(null); return; }
    if (!mosaicMirror) { setMosaicSourceTex(rawMosaicTex); return; }
    const mirrored = buildMirroredSourceTexture(rawMosaicTex);
    if (mirrored) {
      setMosaicSourceTex(mirrored);
      return () => { mirrored.dispose(); };
    }
    // Mirror canvas failed (e.g. tainted image) — fall through to raw so
    // the mosaic still renders rather than going blank.
    setMosaicSourceTex(rawMosaicTex);
  }, [rawMosaicTex, mosaicMirror]);

  // ── Bag scene + materials ──────────────────────────────────────────────────
  // The mylar-bag GLB ships with inconsistent vertex normals — front and
  // back panels point the same direction in stored data, so one panel ends
  // up inward-facing at shade time. We fix it at scene-clone time by
  // forcing each vertex's outward direction (in world space) to agree
  // with the panel side it sits on: +Z for front (pz > 0), -Z for back.
  // Plan is to replace the GLB with a correctly-normal'd one; the
  // workaround below can then be dropped entirely.
  const bagScene = useMemo(() => {
    const clone = scene.clone(true);
    clone.updateMatrixWorld(true);
    const worldPos = new THREE.Vector3();
    const worldN = new THREE.Vector3();
    const normalMat = new THREE.Matrix3();

    clone.traverse((obj) => {
      const m = obj as THREE.Mesh;
      if (!m.isMesh || !m.geometry) return;

      // Clone the geometry explicitly. `Object3D.clone(recursive)`
      // shares BufferGeometry references between clones, so mutating
      // the cloned mesh's geometry would also mutate drei's cached
      // GLB. Under Strict Mode / HMR that stacks mutations on top of
      // each other and produces indeterminate normals.
      m.geometry = m.geometry.clone();
      const geo = m.geometry;

      const pos = geo.attributes.position as THREE.BufferAttribute;
      const nor = geo.attributes.normal as THREE.BufferAttribute;
      if (!pos || !nor) return;

      normalMat.getNormalMatrix(m.matrixWorld);

      // For every vertex whose world normal has a dominant Z axis
      // (|nz| > 0.3 — panel face rather than gusset/seam), force
      // sign(worldN.z) to match sign(worldPos.z). Flipping the local
      // normal negates its world transform too, so mutating the local
      // buffer here produces the correct world direction at shade
      // time. Seam-adjacent vertices (|pz| ≈ 0) stay untouched.
      const count = Math.min(pos.count, nor.count);
      const NZ_THRESHOLD = 0.3;
      const POS_Z_EPS = 0.001;
      for (let i = 0; i < count; i++) {
        worldPos.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
        worldN.fromBufferAttribute(nor, i).applyMatrix3(normalMat).normalize();
        if (Math.abs(worldPos.z) < POS_Z_EPS) continue;
        if (Math.abs(worldN.z) < NZ_THRESHOLD) continue;
        const wantSign = worldPos.z > 0 ? 1 : -1;
        if (worldN.z * wantSign < 0) {
          nor.setXYZ(i, -nor.getX(i), -nor.getY(i), -nor.getZ(i));
        }
      }
      nor.needsUpdate = true;
    });
    return clone;
  }, [scene]);

  const mylarMat = useMemo(() => new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(color), metalness, roughness,
    envMapIntensity: MYLAR_ENV_BASE, side: THREE.DoubleSide,
    iridescence, iridescenceIOR, iridescenceThicknessRange,
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), []);

  // Debug material — colours every fragment by its world-space normal
  // direction (r = nx*0.5+0.5, g = ny*0.5+0.5, b = nz*0.5+0.5). When
  // Surface → Finish is set to "Debug Normals" we swap this in for the
  // whole bag so we can tell by eye whether each panel's normals are
  // pointing where they should be: pure blue (#0000ff-ish) means the
  // normal is pointing +Z (toward camera / out of front), pure yellow
  // (#ffff00-ish) means it's pointing -Z (out of back). Mixed / wrong
  // colours on a given panel indicate inverted or scrambled normals.
  const debugNormalMat = useMemo(
    () => new THREE.MeshNormalMaterial({ side: THREE.DoubleSide }),
    []
  );

  // UV Blacklight kills HDRI-driven reflections on EVERY material so
  // mylar/foil/chrome/label don't catch studio-white highlights when
  // the only light should be the violet blacklight rig. Effectively
  // treats the HDRI as a tiny ambient tint (~2%) rather than a scene.
  const uvEnvMult = lighting === "uv" ? 0.003 : 1;

  useEffect(() => {
    mylarMat.color.set(color);
    mylarMat.metalness = metalness;
    mylarMat.roughness = roughness;
    mylarMat.envMapIntensity = MYLAR_ENV_BASE * envIntensityScale * uvEnvMult;
    mylarMat.iridescence = iridescence;
    mylarMat.iridescenceIOR = iridescenceIOR;
    mylarMat.iridescenceThicknessRange = iridescenceThicknessRange;
    if (iridescence > 0) {
      mylarMat.iridescenceThicknessMap = holographicTex;
      mylarMat.iridescenceThicknessRange = [0, 1200];
      mylarMat.map = null;
      mylarMat.color.set("#ffffff");
    } else {
      mylarMat.iridescenceThicknessMap = null;
      mylarMat.map = null;
      mylarMat.color.set(color);
    }
    mylarMat.needsUpdate = true;
  }, [color, metalness, roughness, iridescence, iridescenceIOR, iridescenceThicknessRange, envIntensityScale, uvEnvMult, mylarMat, holographicTex]);

  // Keep the foil + multi-chrome + prismatic shaders in sync with env scale.
  useEffect(() => {
    holographicFoilMat.envMapIntensity = FOIL_ENV_BASE * envIntensityScale * uvEnvMult;
    holographicFoilMat.needsUpdate = true;
    multiChromeMat.envMapIntensity = CHROME_ENV_BASE * envIntensityScale * uvEnvMult;
    multiChromeMat.needsUpdate = true;
    prismaticFoilMat.envMapIntensity = PRISM_ENV_BASE * envIntensityScale * uvEnvMult;
    prismaticFoilMat.needsUpdate = true;
  }, [envIntensityScale, uvEnvMult, holographicFoilMat, multiChromeMat, prismaticFoilMat]);

  // Dark stand-in material the entire bag body switches to under UV
  // Blacklight lighting — replaces whichever finish the user picked
  // (mylar / foil / multi-chrome / prismatic) because those finishes'
  // custom shaders self-illuminate bright pastel / iridescent colours
  // independent of lighting, which fights the fluorescent-layers-only
  // look UV is trying to sell. A plain diffuse near-black material
  // reacts only to the violet UV point lights so the body reads as a
  // deep-violet silhouette against the black scene.
  const uvDarkMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: "#1a0a2e",
        metalness: 0,
        roughness: 0.95,
        envMapIntensity: 0,
      }),
    []
  );

  // ── Mosaic Layer 1 material (bag body) ───────────────────────────────────
  // When finish === "mosaic", swap the bag body's material for this. The
  // bag GLB ships with its own UVs (baked unwrap) so we pass aspect=null
  // which maps a square crop into whatever the GLB dictates. Metalness /
  // roughness come live from Leva (BagViewer routes them through the
  // existing `metalness`/`roughness` props when finish is "mosaic", the
  // same way it does for "custom"), so the user can dial the surface
  // gloss without leaving the Mosaic finish.
  const mosaicBagMat = useMemo(
    () => new THREE.MeshPhysicalMaterial({
      envMapIntensity: MYLAR_ENV_BASE,
      side: THREE.DoubleSide,
    }),
    []
  );
  // Per-material Texture clone for Layer 1 mosaic so offset/repeat live
  // on an object this material uniquely owns — critical because Texture
  // UV transforms are stored on the Texture, not the material.
  const [mosaicBagTex, setMosaicBagTex] = useState<THREE.Texture | null>(null);
  useEffect(() => {
    if (!mosaicSourceTex) { setMosaicBagTex(null); return; }
    const clone = cloneMosaicTexture(mosaicSourceTex);
    setMosaicBagTex(clone);
    return () => { clone.dispose(); };
  }, [mosaicSourceTex]);

  useEffect(() => {
    mosaicBagMat.map = mosaicBagTex;
    mosaicBagMat.metalness = metalness;
    mosaicBagMat.roughness = roughness;
    mosaicBagMat.envMapIntensity = MYLAR_ENV_BASE * envIntensityScale * uvEnvMult;
    if (mosaicBagTex) {
      applyMosaicCrop(mosaicBagTex, resolveMosaicCrop({
        aspect: null,
        zoom: mosaicZoom,
        offsetU: mosaicOffsetU,
        offsetV: mosaicOffsetV,
        flipX: mosaicFlipX,
        flipY: mosaicFlipY,
      }));
      mosaicBagTex.needsUpdate = true;
    }
    mosaicBagMat.needsUpdate = true;
  }, [mosaicBagTex, mosaicZoom, mosaicOffsetU, mosaicOffsetV, mosaicFlipX, mosaicFlipY, metalness, roughness, envIntensityScale, uvEnvMult, mosaicBagMat]);

  useEffect(() => {
    bagScene.traverse((obj) => {
      const m = obj as THREE.Mesh;
      if (!m.isMesh) return;
      if (lighting === "uv")                m.material = uvDarkMat;
      else if (finish === "debug-normals")  m.material = debugNormalMat;
      else if (finish === "foil")           m.material = holographicFoilMat;
      else if (finish === "prismatic")      m.material = prismaticFoilMat;
      else if (finish === "mosaic" && mosaicBagTex) m.material = mosaicBagMat;
      else if (iridescence > 0)             m.material = multiChromeMat;
      else                                  m.material = mylarMat;
      m.castShadow = true;
      m.receiveShadow = true;
      m.renderOrder = 0;
    });
  }, [bagScene, mylarMat, multiChromeMat, holographicFoilMat, prismaticFoilMat, debugNormalMat, uvDarkMat, iridescence, finish, lighting, mosaicBagMat, mosaicBagTex]);

  // Mark label geo dirty when bag scene changes
  useEffect(() => { decalDirty.current = true; }, [bagScene]);

  // ── Label materials (front + back) ─────────────────────────────────────────
  // MeshPhysicalMaterial so the Varnish toggle can reach for clearcoat +
  // bumpMap. When varnish is off these behave identically to the old
  // MeshStandardMaterial — clearcoat stays at 0 and bumpMap is null.
  const buildLabelMat = () =>
    new THREE.MeshPhysicalMaterial({
      metalness: labelMetalness,
      roughness: labelRoughness,
      envMapIntensity: LABEL_ENV_BASE,
      transparent: true,
      alphaTest: 0.01,
      side: THREE.FrontSide,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
    });

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const frontLabelMat = useMemo(buildLabelMat, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const backLabelMat = useMemo(buildLabelMat, []);

  // Alpha-derived bump maps — regenerated whenever the artwork changes. Kept
  // in state so the useEffect that applies them to the material can dispose
  // stale textures cleanly.
  const [frontBumpTex, setFrontBumpTex] = useState<THREE.CanvasTexture | null>(null);
  const [backBumpTex, setBackBumpTex] = useState<THREE.CanvasTexture | null>(null);

  useEffect(() => {
    if (!frontLabelTex) { setFrontBumpTex(null); return; }
    const tex = buildAlphaBumpTexture(frontLabelTex);
    setFrontBumpTex(tex);
    return () => { tex?.dispose(); };
  }, [frontLabelTex]);

  useEffect(() => {
    if (!backLabelTex) { setBackBumpTex(null); return; }
    const tex = buildAlphaBumpTexture(backLabelTex);
    setBackBumpTex(tex);
    return () => { tex?.dispose(); };
  }, [backLabelTex]);

  useEffect(() => {
    frontLabelMat.map = frontLabelTex;
    frontLabelMat.envMapIntensity = LABEL_ENV_BASE * envIntensityScale * uvEnvMult;
    if (labelVarnish) {
      frontLabelMat.metalness = 0;
      frontLabelMat.roughness = VARNISH_ROUGHNESS;
      frontLabelMat.clearcoat = VARNISH_CLEARCOAT;
      frontLabelMat.clearcoatRoughness = VARNISH_CLEARCOAT_ROUGHNESS;
      frontLabelMat.bumpMap = frontBumpTex;
      frontLabelMat.bumpScale = VARNISH_BUMP_SCALE;
    } else {
      frontLabelMat.metalness = labelMetalness;
      frontLabelMat.roughness = labelRoughness;
      frontLabelMat.clearcoat = 0;
      frontLabelMat.clearcoatRoughness = 0;
      frontLabelMat.bumpMap = null;
      frontLabelMat.bumpScale = 0;
    }
    // UV Blacklight — pump up emissive from the artwork texture so the
    // decal "glows" under violet scene lighting while dark materials
    // around it stay near-black. Reset emissive when UV is off or the
    // scene isn't UV so non-UV renders are unchanged.
    if (labelUV && lighting === "uv") {
      frontLabelMat.emissive = new THREE.Color(UV_GLOW_COLOR);
      frontLabelMat.emissiveMap = frontLabelTex;
      frontLabelMat.emissiveIntensity = 6.5;
    } else {
      frontLabelMat.emissive = new THREE.Color(0x000000);
      frontLabelMat.emissiveMap = null;
      frontLabelMat.emissiveIntensity = 1;
    }
    frontLabelMat.needsUpdate = true;
  }, [frontLabelTex, frontBumpTex, labelMetalness, labelRoughness, labelVarnish, envIntensityScale, uvEnvMult, frontLabelMat, labelUV, lighting]);

  useEffect(() => {
    backLabelMat.map = backLabelTex;
    backLabelMat.envMapIntensity = LABEL_ENV_BASE * envIntensityScale * uvEnvMult;
    if (labelVarnish) {
      backLabelMat.metalness = 0;
      backLabelMat.roughness = VARNISH_ROUGHNESS;
      backLabelMat.clearcoat = VARNISH_CLEARCOAT;
      backLabelMat.clearcoatRoughness = VARNISH_CLEARCOAT_ROUGHNESS;
      backLabelMat.bumpMap = backBumpTex;
      backLabelMat.bumpScale = VARNISH_BUMP_SCALE;
    } else {
      backLabelMat.metalness = labelMetalness;
      backLabelMat.roughness = labelRoughness;
      backLabelMat.clearcoat = 0;
      backLabelMat.clearcoatRoughness = 0;
      backLabelMat.bumpMap = null;
      backLabelMat.bumpScale = 0;
    }
    if (labelUV && lighting === "uv") {
      backLabelMat.emissive = new THREE.Color(UV_GLOW_COLOR);
      backLabelMat.emissiveMap = backLabelTex;
      backLabelMat.emissiveIntensity = 6.5;
    } else {
      backLabelMat.emissive = new THREE.Color(0x000000);
      backLabelMat.emissiveMap = null;
      backLabelMat.emissiveIntensity = 1;
    }
    backLabelMat.needsUpdate = true;
  }, [backLabelTex, backBumpTex, labelMetalness, labelRoughness, labelVarnish, envIntensityScale, uvEnvMult, backLabelMat, labelUV, lighting]);

  // ── Layer 3 — optional second decal layer (front + back) ─────────────────
  // Mirrors Layer 2 exactly: independent textures, alpha-bump maps driving a
  // Varnish toggle, and its own Material toggle. Rendered one polygon-offset
  // step deeper than Layer 2 so it always reads on top.
  const [layer3FrontTex, setLayer3FrontTex] = useState<THREE.Texture | null>(null);
  const [layer3BackTex, setLayer3BackTex] = useState<THREE.Texture | null>(null);

  useEffect(() => {
    if (!layer3FrontTextureUrl) { setLayer3FrontTex(null); return; }
    const signal = { cancelled: false };
    loadLabelTexture(layer3FrontTextureUrl, signal).then((tex) => {
      if (!signal.cancelled && tex) setLayer3FrontTex(tex);
    });
    return () => { signal.cancelled = true; };
  }, [layer3FrontTextureUrl]);

  useEffect(() => {
    if (!layer3BackTextureUrl) { setLayer3BackTex(null); return; }
    const signal = { cancelled: false };
    loadLabelTexture(layer3BackTextureUrl, signal).then((tex) => {
      if (!signal.cancelled && tex) setLayer3BackTex(tex);
    });
    return () => { signal.cancelled = true; };
  }, [layer3BackTextureUrl]);

  const [layer3FrontBumpTex, setLayer3FrontBumpTex] = useState<THREE.CanvasTexture | null>(null);
  const [layer3BackBumpTex, setLayer3BackBumpTex] = useState<THREE.CanvasTexture | null>(null);

  useEffect(() => {
    if (!layer3FrontTex) { setLayer3FrontBumpTex(null); return; }
    const tex = buildAlphaBumpTexture(layer3FrontTex);
    setLayer3FrontBumpTex(tex);
    return () => { tex?.dispose(); };
  }, [layer3FrontTex]);

  useEffect(() => {
    if (!layer3BackTex) { setLayer3BackBumpTex(null); return; }
    const tex = buildAlphaBumpTexture(layer3BackTex);
    setLayer3BackBumpTex(tex);
    return () => { tex?.dispose(); };
  }, [layer3BackTex]);

  // Layer 3 artwork materials — built with deeper polygonOffset (-8 vs Layer
  // 2's -4) so they always render on top when the two layers overlap.
  const buildLayer3Mat = () =>
    new THREE.MeshPhysicalMaterial({
      metalness: layer3Metalness,
      roughness: layer3Roughness,
      envMapIntensity: LABEL_ENV_BASE,
      transparent: true,
      alphaTest: 0.01,
      side: THREE.FrontSide,
      polygonOffset: true,
      polygonOffsetFactor: -8,
      polygonOffsetUnits: -8,
    });

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const layer3FrontMat = useMemo(buildLayer3Mat, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const layer3BackMat = useMemo(buildLayer3Mat, []);

  useEffect(() => {
    layer3FrontMat.map = layer3FrontTex;
    layer3FrontMat.envMapIntensity = LABEL_ENV_BASE * envIntensityScale * uvEnvMult;
    if (layer3Varnish) {
      layer3FrontMat.metalness = 0;
      layer3FrontMat.roughness = VARNISH_ROUGHNESS;
      layer3FrontMat.clearcoat = VARNISH_CLEARCOAT;
      layer3FrontMat.clearcoatRoughness = VARNISH_CLEARCOAT_ROUGHNESS;
      layer3FrontMat.bumpMap = layer3FrontBumpTex;
      layer3FrontMat.bumpScale = VARNISH_BUMP_SCALE;
    } else {
      layer3FrontMat.metalness = layer3Metalness;
      layer3FrontMat.roughness = layer3Roughness;
      layer3FrontMat.clearcoat = 0;
      layer3FrontMat.clearcoatRoughness = 0;
      layer3FrontMat.bumpMap = null;
      layer3FrontMat.bumpScale = 0;
    }
    if (layer3UV && lighting === "uv") {
      layer3FrontMat.emissive = new THREE.Color(UV_GLOW_COLOR);
      layer3FrontMat.emissiveMap = layer3FrontTex;
      layer3FrontMat.emissiveIntensity = 6.5;
    } else {
      layer3FrontMat.emissive = new THREE.Color(0x000000);
      layer3FrontMat.emissiveMap = null;
      layer3FrontMat.emissiveIntensity = 1;
    }
    layer3FrontMat.needsUpdate = true;
  }, [layer3FrontTex, layer3FrontBumpTex, layer3Metalness, layer3Roughness, layer3Varnish, envIntensityScale, uvEnvMult, layer3FrontMat, layer3UV, lighting]);

  useEffect(() => {
    layer3BackMat.map = layer3BackTex;
    layer3BackMat.envMapIntensity = LABEL_ENV_BASE * envIntensityScale * uvEnvMult;
    if (layer3Varnish) {
      layer3BackMat.metalness = 0;
      layer3BackMat.roughness = VARNISH_ROUGHNESS;
      layer3BackMat.clearcoat = VARNISH_CLEARCOAT;
      layer3BackMat.clearcoatRoughness = VARNISH_CLEARCOAT_ROUGHNESS;
      layer3BackMat.bumpMap = layer3BackBumpTex;
      layer3BackMat.bumpScale = VARNISH_BUMP_SCALE;
    } else {
      layer3BackMat.metalness = layer3Metalness;
      layer3BackMat.roughness = layer3Roughness;
      layer3BackMat.clearcoat = 0;
      layer3BackMat.clearcoatRoughness = 0;
      layer3BackMat.bumpMap = null;
      layer3BackMat.bumpScale = 0;
    }
    if (layer3UV && lighting === "uv") {
      layer3BackMat.emissive = new THREE.Color(UV_GLOW_COLOR);
      layer3BackMat.emissiveMap = layer3BackTex;
      layer3BackMat.emissiveIntensity = 6.5;
    } else {
      layer3BackMat.emissive = new THREE.Color(0x000000);
      layer3BackMat.emissiveMap = null;
      layer3BackMat.emissiveIntensity = 1;
    }
    layer3BackMat.needsUpdate = true;
  }, [layer3BackTex, layer3BackBumpTex, layer3Metalness, layer3Roughness, layer3Varnish, envIntensityScale, uvEnvMult, layer3BackMat, layer3UV, lighting]);

  // ── Material-mode masked variants (Layer 2 + Layer 3, front + back) ──────
  // When a layer's Material checkbox is on, the artwork's alpha becomes a
  // cutout mask and the opaque pixels paint with the current base-surface
  // finish — a metallic cutout, foil cutout, prismatic cutout, multi-chrome
  // cutout, etc. Each variant mirrors a base shader but crucially leaves
  // gl_FragColor.a alone, so three's alphaMap chain attenuates visibility by
  // the uploaded artwork's alpha channel.
  //
  // Each front/back mesh needs its own instance because each binds a unique
  // texture as `map`. 16 masked materials in total (2 layers × 2 sides × 4
  // finish variants) — a little heavy on GPU state, but they're all created
  // lazily once and only the active one renders per mesh.

  type MaskedSet = {
    mylar: THREE.MeshPhysicalMaterial;
    foil: THREE.MeshPhysicalMaterial;
    prismatic: THREE.MeshPhysicalMaterial;
    chrome: THREE.MeshPhysicalMaterial;
    /** "Mosaic" variant — map = mosaic source crop, alphaMap = artwork
     *  alpha so the artwork's shape cuts out the mosaic colour. The
     *  material's `.map` is assigned a per-set Texture clone in the
     *  sync effect (so offset/repeat don't stomp siblings). */
    mosaic: THREE.MeshPhysicalMaterial;
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
        // gl_FragColor.a left alone — alphaMap chain handles the cutout.`
      );
    };

    const prismatic = new THREE.MeshPhysicalMaterial({
      metalness: 1.0,
      roughness: 0.0,
      envMapIntensity: PRISM_ENV_BASE,
      ...commonTransparent,
    });
    applyPrismaticShader(prismatic, { mixStrength: 0.85, preserveAlpha: true });

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
        // gl_FragColor.a left alone — alphaMap chain handles the cutout.`
      );
    };

    // Mosaic variant — simple PBR material (no custom shader). The actual
    // texture + artwork alphaMap + aspect-correct crop are assigned in the
    // syncMaskedSet effect because they depend on live mosaic state and
    // the artwork's per-side alpha channel.
    const mosaic = new THREE.MeshPhysicalMaterial({
      metalness: 0.1,
      roughness: 0.45,
      envMapIntensity: LABEL_ENV_BASE,
      ...commonTransparent,
    });

    return { mylar, foil, prismatic, chrome, mosaic };
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const layer2FrontMaskedSet = useMemo(() => buildMaskedSet(-4), []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const layer2BackMaskedSet = useMemo(() => buildMaskedSet(-4), []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const layer3FrontMaskedSet = useMemo(() => buildMaskedSet(-8), []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const layer3BackMaskedSet = useMemo(() => buildMaskedSet(-8), []);

  // ── Per-masked-set mosaic Texture clones ─────────────────────────────────
  // Each masked variant needs its own clone so offset/repeat on one doesn't
  // leak into siblings. Re-created whenever the shared source texture
  // changes (e.g. user uploads a new mosaic source image).
  const [layer2FrontMosaicTex, setLayer2FrontMosaicTex] = useState<THREE.Texture | null>(null);
  const [layer2BackMosaicTex, setLayer2BackMosaicTex] = useState<THREE.Texture | null>(null);
  const [layer3FrontMosaicTex, setLayer3FrontMosaicTex] = useState<THREE.Texture | null>(null);
  const [layer3BackMosaicTex, setLayer3BackMosaicTex] = useState<THREE.Texture | null>(null);

  useEffect(() => {
    if (!mosaicSourceTex) {
      setLayer2FrontMosaicTex(null);
      setLayer2BackMosaicTex(null);
      setLayer3FrontMosaicTex(null);
      setLayer3BackMosaicTex(null);
      return;
    }
    const a = cloneMosaicTexture(mosaicSourceTex);
    const b = cloneMosaicTexture(mosaicSourceTex);
    const c = cloneMosaicTexture(mosaicSourceTex);
    const d = cloneMosaicTexture(mosaicSourceTex);
    setLayer2FrontMosaicTex(a);
    setLayer2BackMosaicTex(b);
    setLayer3FrontMosaicTex(c);
    setLayer3BackMosaicTex(d);
    return () => {
      a.dispose();
      b.dispose();
      c.dispose();
      d.dispose();
    };
  }, [mosaicSourceTex]);

  // ── Artwork alpha-maps (for mosaic cutouts) ──────────────────────────────
  // When a layer paints mosaic colour, the artwork's alpha channel acts as
  // the cutout mask via MeshPhysicalMaterial.alphaMap. We derive greyscale
  // alpha textures once per artwork texture and assign them into the mosaic
  // variant inside syncMaskedSet.
  const [frontArtAlpha, setFrontArtAlpha] = useState<THREE.CanvasTexture | null>(null);
  const [backArtAlpha, setBackArtAlpha] = useState<THREE.CanvasTexture | null>(null);
  const [layer3FrontArtAlpha, setLayer3FrontArtAlpha] = useState<THREE.CanvasTexture | null>(null);
  const [layer3BackArtAlpha, setLayer3BackArtAlpha] = useState<THREE.CanvasTexture | null>(null);

  useEffect(() => {
    if (!frontLabelTex) { setFrontArtAlpha(null); return; }
    const tex = buildArtworkAlphaMap(frontLabelTex);
    setFrontArtAlpha(tex);
    return () => { tex?.dispose(); };
  }, [frontLabelTex]);

  useEffect(() => {
    if (!backLabelTex) { setBackArtAlpha(null); return; }
    const tex = buildArtworkAlphaMap(backLabelTex);
    setBackArtAlpha(tex);
    return () => { tex?.dispose(); };
  }, [backLabelTex]);

  useEffect(() => {
    if (!layer3FrontTex) { setLayer3FrontArtAlpha(null); return; }
    const tex = buildArtworkAlphaMap(layer3FrontTex);
    setLayer3FrontArtAlpha(tex);
    return () => { tex?.dispose(); };
  }, [layer3FrontTex]);

  useEffect(() => {
    if (!layer3BackTex) { setLayer3BackArtAlpha(null); return; }
    const tex = buildArtworkAlphaMap(layer3BackTex);
    setLayer3BackArtAlpha(tex);
    return () => { tex?.dispose(); };
  }, [layer3BackTex]);

  // Resolve the effective Material-mode surface for a given layer. Each
  // layer can override Layer 1's finish via `matFinish`; when omitted the
  // layer inherits Layer 1 (backwards-compatible for older saves).
  type LayerSurface = {
    finish: BagFinish | string;
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
    // Custom and Mosaic both read metalness/roughness from the per-layer
    // "Custom" sliders (labelMatMetalness etc.). Mosaic reuses the same
    // numbers so the user has a single surface-knob story, without
    // doubling the persisted schema for a second set of sliders.
    if (matFinish === "custom" || matFinish === "mosaic") {
      return {
        finish: matFinish,
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
    () => resolveLayerSurface(labelMatFinish, labelMatMetalness, labelMatRoughness),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [labelMatFinish, labelMatMetalness, labelMatRoughness, finish, metalness, roughness, iridescence, iridescenceIOR, iridescenceThicknessRange]
  );
  const layer3Surface = useMemo(
    () => resolveLayerSurface(layer3MatFinish, layer3MatMetalness, layer3MatRoughness),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [layer3MatFinish, layer3MatMetalness, layer3MatRoughness, finish, metalness, roughness, iridescence, iridescenceIOR, iridescenceThicknessRange]
  );

  // Sync masked-material variants with the layer's own resolved surface.
  // The artwork texture is bound as `map` so its .a channel drives the cutout;
  // each variant's custom shader is careful to leave gl_FragColor.a alone so
  // the alphaMap chain still attenuates visibility.
  //
  // `mosaic` params are read only when the layer's finish is "mosaic" — the
  // mosaic variant's `.map` becomes the source-image crop while the artwork's
  // alpha channel (derived separately into a greyscale alphaMap) carves the
  // artwork shape out of that colour. Passing `mosaicTex = null` (no uploaded
  // source) leaves the variant empty so pickMasked can still fall back.
  const syncMaskedSet = (
    set: MaskedSet,
    tex: THREE.Texture | null,
    surface: LayerSurface,
    mosaic?: {
      mosaicTex: THREE.Texture | null;
      artAlpha: THREE.Texture | null;
      aspect: number | null;
      zoom: number;
      offsetU: number;
      offsetV: number;
      flipX: boolean;
      flipY: boolean;
    }
  ) => {
    // Mylar variant — mirror this layer's resolved physical surface.
    set.mylar.map = tex;
    set.mylar.color.set(color);
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
    set.mylar.envMapIntensity = MYLAR_ENV_BASE * envIntensityScale * uvEnvMult;
    set.mylar.needsUpdate = true;

    set.foil.map = tex;
    set.foil.envMapIntensity = FOIL_ENV_BASE * envIntensityScale * uvEnvMult;
    set.foil.needsUpdate = true;

    set.prismatic.map = tex;
    set.prismatic.envMapIntensity = PRISM_ENV_BASE * envIntensityScale * uvEnvMult;
    set.prismatic.needsUpdate = true;

    set.chrome.map = tex;
    set.chrome.envMapIntensity = CHROME_ENV_BASE * envIntensityScale * uvEnvMult;
    set.chrome.needsUpdate = true;

    // Mosaic variant — map = source crop, alphaMap = artwork alpha.
    // When mosaicTex or artAlpha is missing the material stays empty so the
    // mesh doesn't render a coloured rectangle where artwork should be.
    // Metalness/roughness mirror this layer's resolved surface so the
    // Mosaic finish responds to the same sliders that drive Custom —
    // gives the user a single surface-knob story without duplicating
    // the persisted schema.
    set.mosaic.map = mosaic?.mosaicTex ?? null;
    set.mosaic.alphaMap = mosaic?.artAlpha ?? null;
    set.mosaic.metalness = surface.metalness;
    set.mosaic.roughness = surface.roughness;
    set.mosaic.envMapIntensity = LABEL_ENV_BASE * envIntensityScale * uvEnvMult;
    if (mosaic?.mosaicTex) {
      applyMosaicCrop(mosaic.mosaicTex, resolveMosaicCrop({
        aspect: mosaic.aspect,
        zoom: mosaic.zoom,
        offsetU: mosaic.offsetU,
        offsetV: mosaic.offsetV,
        flipX: mosaic.flipX,
        flipY: mosaic.flipY,
      }));
      mosaic.mosaicTex.needsUpdate = true;
    }
    set.mosaic.needsUpdate = true;
  };

  // Front panel's mosaic aspect comes from the rebuilt label geometry's
  // userData.panelAspect (stored by buildLabelGeo). Backs share aspect with
  // the mirrored front. Fall back to 1 so first-mount race with geometry
  // build doesn't crash resolveMosaicCrop.
  const frontPanelAspect = (frontLabelGeo?.userData?.panelAspect as number | undefined) ?? 1;
  const backPanelAspect = (backLabelGeo?.userData?.panelAspect as number | undefined) ?? 1;

  useEffect(() => {
    syncMaskedSet(layer2FrontMaskedSet, frontLabelTex, layer2Surface, {
      mosaicTex: layer2FrontMosaicTex,
      artAlpha: frontArtAlpha,
      aspect: frontPanelAspect,
      zoom: mosaicZoom,
      offsetU: labelMosaicOffsetU,
      offsetV: labelMosaicOffsetV,
      flipX: labelMosaicFlipX,
      flipY: labelMosaicFlipY,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frontLabelTex, color, layer2Surface, envIntensityScale, layer2FrontMaskedSet, holographicTex,
      layer2FrontMosaicTex, frontArtAlpha, frontPanelAspect, mosaicZoom, labelMosaicOffsetU, labelMosaicOffsetV, labelMosaicFlipX, labelMosaicFlipY]);

  useEffect(() => {
    syncMaskedSet(layer2BackMaskedSet, backLabelTex, layer2Surface, {
      mosaicTex: layer2BackMosaicTex,
      artAlpha: backArtAlpha,
      aspect: backPanelAspect,
      zoom: mosaicZoom,
      offsetU: labelMosaicOffsetU,
      offsetV: labelMosaicOffsetV,
      flipX: labelMosaicFlipX,
      flipY: labelMosaicFlipY,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backLabelTex, color, layer2Surface, envIntensityScale, layer2BackMaskedSet, holographicTex,
      layer2BackMosaicTex, backArtAlpha, backPanelAspect, mosaicZoom, labelMosaicOffsetU, labelMosaicOffsetV, labelMosaicFlipX, labelMosaicFlipY]);

  useEffect(() => {
    syncMaskedSet(layer3FrontMaskedSet, layer3FrontTex, layer3Surface, {
      mosaicTex: layer3FrontMosaicTex,
      artAlpha: layer3FrontArtAlpha,
      aspect: frontPanelAspect,
      zoom: mosaicZoom,
      offsetU: layer3MosaicOffsetU,
      offsetV: layer3MosaicOffsetV,
      flipX: layer3MosaicFlipX,
      flipY: layer3MosaicFlipY,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layer3FrontTex, color, layer3Surface, envIntensityScale, layer3FrontMaskedSet, holographicTex,
      layer3FrontMosaicTex, layer3FrontArtAlpha, frontPanelAspect, mosaicZoom, layer3MosaicOffsetU, layer3MosaicOffsetV, layer3MosaicFlipX, layer3MosaicFlipY]);

  useEffect(() => {
    syncMaskedSet(layer3BackMaskedSet, layer3BackTex, layer3Surface, {
      mosaicTex: layer3BackMosaicTex,
      artAlpha: layer3BackArtAlpha,
      aspect: backPanelAspect,
      zoom: mosaicZoom,
      offsetU: layer3MosaicOffsetU,
      offsetV: layer3MosaicOffsetV,
      flipX: layer3MosaicFlipX,
      flipY: layer3MosaicFlipY,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layer3BackTex, color, layer3Surface, envIntensityScale, layer3BackMaskedSet, holographicTex,
      layer3BackMosaicTex, layer3BackArtAlpha, backPanelAspect, mosaicZoom, layer3MosaicOffsetU, layer3MosaicOffsetV, layer3MosaicFlipX, layer3MosaicFlipY]);

  // Pick the active masked variant per set based on THIS LAYER's resolved
  // finish. iridescence > 0 (Multi-Chrome preset) routes to the chrome shader.
  // Mosaic needs both a source texture and the artwork alpha to render; when
  // either is missing (user hasn't uploaded yet) we fall back to the mylar
  // variant so the layer still shows the raw artwork rather than vanishing.
  const pickMasked = (
    set: MaskedSet,
    surface: LayerSurface,
    mosaicReady: boolean
  ): THREE.Material => {
    if (surface.finish === "foil") return set.foil;
    if (surface.finish === "prismatic") return set.prismatic;
    if (surface.finish === "multi-chrome" || surface.iridescence > 0) return set.chrome;
    if (surface.finish === "mosaic" && mosaicReady) return set.mosaic;
    return set.mylar;
  };
  const layer2FrontMosaicReady = !!(layer2FrontMosaicTex && frontArtAlpha);
  const layer2BackMosaicReady = !!(layer2BackMosaicTex && backArtAlpha);
  const layer3FrontMosaicReady = !!(layer3FrontMosaicTex && layer3FrontArtAlpha);
  const layer3BackMosaicReady = !!(layer3BackMosaicTex && layer3BackArtAlpha);

  const layer2FrontMasked = useMemo(
    () => pickMasked(layer2FrontMaskedSet, layer2Surface, layer2FrontMosaicReady),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [layer2Surface, layer2FrontMaskedSet, layer2FrontMosaicReady]
  );
  const layer2BackMasked = useMemo(
    () => pickMasked(layer2BackMaskedSet, layer2Surface, layer2BackMosaicReady),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [layer2Surface, layer2BackMaskedSet, layer2BackMosaicReady]
  );
  const layer3FrontMasked = useMemo(
    () => pickMasked(layer3FrontMaskedSet, layer3Surface, layer3FrontMosaicReady),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [layer3Surface, layer3FrontMaskedSet, layer3FrontMosaicReady]
  );
  const layer3BackMasked = useMemo(
    () => pickMasked(layer3BackMaskedSet, layer3Surface, layer3BackMosaicReady),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [layer3Surface, layer3BackMaskedSet, layer3BackMosaicReady]
  );

  // ── Animation loop: float + decal rebuild ──────────────────────────────────
  // BASE_Y_FLOAT centres the gentle ±0.02 oscillation in the Default scene;
  // BASE_Y_GROUND drops the bag onto the Smoke scene's reflective floor
  // (y=-1.265) with a small offset that matches where the mylar's lower
  // pinch sits relative to the group origin.
  const BASE_Y_FLOAT = -1.1;
  const BASE_Y_GROUND = -1.265;
  const BASE_Y = floating ? BASE_Y_FLOAT : BASE_Y_GROUND;

  useFrame(({ clock }) => {
    if (!groupRef.current) return;

    groupRef.current.position.y = floating
      ? BASE_Y_FLOAT + Math.sin(clock.elapsedTime * 0.6) * 0.02
      : BASE_Y_GROUND;

    if (!decalDirty.current) return;
    decalDirty.current = false;
    groupRef.current.updateMatrixWorld(true);

    const nextFront = buildLabelGeo(groupRef.current, "front");
    const nextBack = buildLabelGeo(groupRef.current, "back");
    if (nextFront) setFrontLabelGeo(nextFront);
    if (nextBack) setBackLabelGeo(nextBack);
  });

  return (
    <group ref={groupRef} position={[0, BASE_Y, 0]} scale={[5.5, 5.5, 5.5]}>
      {/* Bag */}
      <primitive object={bagScene} />

      {/* Layer 2 — front + back artwork decals. With Material ON, the
           artwork's alpha cuts out the current base finish (foil / prismatic
           / multi-chrome / matte / …) instead of painting the PNG's RGB
           directly. With Material OFF it's a standard transparent artwork
           decal (Varnish optionally adds a clear-gloss overprint). */}
      {frontLabelGeo && frontLabelTex && (
        <mesh
          geometry={frontLabelGeo}
          material={labelMaterial ? layer2FrontMasked : frontLabelMat}
          renderOrder={1}
        />
      )}
      {backLabelGeo && backLabelTex && (
        <mesh
          geometry={backLabelGeo}
          material={labelMaterial ? layer2BackMasked : backLabelMat}
          renderOrder={1}
        />
      )}

      {/* Layer 3 — optional second artwork layer. Same rules as Layer 2 but
           rendered one polygon-offset step deeper so it sits on top when
           the two layers overlap. */}
      {frontLabelGeo && layer3FrontTex && (
        <mesh
          geometry={frontLabelGeo}
          material={layer3Material ? layer3FrontMasked : layer3FrontMat}
          renderOrder={2}
        />
      )}
      {backLabelGeo && layer3BackTex && (
        <mesh
          geometry={backLabelGeo}
          material={layer3Material ? layer3BackMasked : layer3BackMat}
          renderOrder={2}
        />
      )}
    </group>
  );
}
