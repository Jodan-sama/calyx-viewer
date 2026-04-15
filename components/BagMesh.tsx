"use client";

import { useRef, useMemo, useEffect, useState } from "react";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { useFrame } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";

interface BagMeshProps {
  /** Front-panel artwork. Null → built-in placeholder. */
  textureUrl: string | null;
  /** Back-panel artwork. Null → built-in placeholder (shared with front). */
  backTextureUrl?: string | null;
  metalness: number;
  roughness: number;
  color: string;
  labelMetalness: number;
  labelRoughness: number;
  iridescence?: number;
  iridescenceIOR?: number;
  iridescenceThicknessRange?: [number, number];
  finish?: string;
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

useGLTF.preload("/mylar_bag.glb");

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
}: BagMeshProps) {
  // ── Refs ───────────────────────────────────────────────────────────────────
  const groupRef = useRef<THREE.Group>(null);
  const decalDirty = useRef(true);

  // ── Scene ──────────────────────────────────────────────────────────────────
  const { scene } = useGLTF("/mylar_bag.glb") as { scene: THREE.Group };

  const holographicTex = useMemo(() => buildHolographicTexture(), []);

  // ── Holographic Foil shader ────────────────────────────────────────────────
  const holographicFoilMat = useMemo(() => {
    const mat = new THREE.MeshPhysicalMaterial({
      metalness: 1.0, roughness: 0.0, envMapIntensity: 0.6, side: THREE.DoubleSide,
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

  // ── Multi-chrome shader ────────────────────────────────────────────────────
  const multiChromeMat = useMemo(() => {
    const mat = new THREE.MeshPhysicalMaterial({
      metalness: 1.0, roughness: 0.0, envMapIntensity: 0.25, side: THREE.DoubleSide,
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

  // ── Bag scene + materials ──────────────────────────────────────────────────
  const bagScene = useMemo(() => scene.clone(true), [scene]);

  const mylarMat = useMemo(() => new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(color), metalness, roughness,
    envMapIntensity: 2.0, side: THREE.DoubleSide,
    iridescence, iridescenceIOR, iridescenceThicknessRange,
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), []);

  useEffect(() => {
    mylarMat.color.set(color);
    mylarMat.metalness = metalness;
    mylarMat.roughness = roughness;
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
  }, [color, metalness, roughness, iridescence, iridescenceIOR, iridescenceThicknessRange, mylarMat, holographicTex]);

  useEffect(() => {
    bagScene.traverse((obj) => {
      const m = obj as THREE.Mesh;
      if (!m.isMesh) return;
      if (finish === "foil")  m.material = holographicFoilMat;
      else if (iridescence > 0) m.material = multiChromeMat;
      else                   m.material = mylarMat;
      m.castShadow = true;
      m.receiveShadow = true;
      m.renderOrder = 0;
    });
  }, [bagScene, mylarMat, multiChromeMat, holographicFoilMat, iridescence, finish]);

  // Mark label geo dirty when bag scene changes
  useEffect(() => { decalDirty.current = true; }, [bagScene]);

  // ── Label materials (front + back) ─────────────────────────────────────────
  // Two separate materials so front and back can hold different maps.
  const buildLabelMat = () =>
    new THREE.MeshStandardMaterial({
      metalness: labelMetalness,
      roughness: labelRoughness,
      envMapIntensity: 0.5,
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

  useEffect(() => {
    frontLabelMat.map = frontLabelTex;
    frontLabelMat.metalness = labelMetalness;
    frontLabelMat.roughness = labelRoughness;
    frontLabelMat.needsUpdate = true;
  }, [frontLabelTex, labelMetalness, labelRoughness, frontLabelMat]);

  useEffect(() => {
    backLabelMat.map = backLabelTex;
    backLabelMat.metalness = labelMetalness;
    backLabelMat.roughness = labelRoughness;
    backLabelMat.needsUpdate = true;
  }, [backLabelTex, labelMetalness, labelRoughness, backLabelMat]);

  // ── Label geometries (front + back, regenerated on decalDirty) ─────────────
  const [frontLabelGeo, setFrontLabelGeo] = useState<THREE.BufferGeometry | null>(null);
  const [backLabelGeo, setBackLabelGeo] = useState<THREE.BufferGeometry | null>(null);

  useEffect(() => () => { frontLabelGeo?.dispose(); }, [frontLabelGeo]);
  useEffect(() => () => { backLabelGeo?.dispose(); }, [backLabelGeo]);

  // ── Animation loop: float + decal rebuild ──────────────────────────────────
  const BASE_Y = -1.1;

  useFrame(({ clock }) => {
    if (!groupRef.current) return;

    groupRef.current.position.y = BASE_Y + Math.sin(clock.elapsedTime * 0.6) * 0.02;

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

      {/* Labels — front and back use the same polygon-offset material config
           with independent maps, so uploaded art shows on both sides. Each
           mesh only mounts once its texture has loaded, so the bag never
           flashes a placeholder. */}
      {frontLabelGeo && frontLabelTex && (
        <mesh geometry={frontLabelGeo} material={frontLabelMat} renderOrder={1} />
      )}
      {backLabelGeo && backLabelTex && (
        <mesh geometry={backLabelGeo} material={backLabelMat} renderOrder={1} />
      )}
    </group>
  );
}
