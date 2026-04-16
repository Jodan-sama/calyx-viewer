"use client";

import { useEffect, useMemo, useState } from "react";
import * as THREE from "three";
import { useGLTF } from "@react-three/drei";
import type { BagFinish } from "@/lib/bagMaterial";

// ── Assets ───────────────────────────────────────────────────────────────────
// The full jar comes from two glbs: one provides the body + lid (we reuse it
// but hide its built-in label meshes so we don't double-render a label) and
// the other is the standalone label geometry the modeller ships for Layer 1.
const JAR_BODY_GLB = "/models/supplement-circle.glb";
const JAR_LABEL_GLB = "/models/supplement-circle-label.glb";
useGLTF.preload(JAR_BODY_GLB);
useGLTF.preload(JAR_LABEL_GLB);

// Base env-map intensities (mirroring BagMesh so the jar's label reads the
// scene with the same punch the bag does). `envIntensityScale` multiplies in.
const MYLAR_ENV_BASE = 2.0;
const FOIL_ENV_BASE = 0.6;
const CHROME_ENV_BASE = 0.25;
const PLASTIC_ENV_BASE = 0.8;
const DECAL_ENV_BASE = 0.6;

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

  // ── Layer 2 — artwork or foil decal. Clear until a texture is supplied. ──
  layer2TextureUrl: string | null;
  layer2Mode: LayerMode;
  layer2Metalness: number;
  layer2Roughness: number;

  // ── Layer 3 — artwork or foil decal. Clear until a texture is supplied. ──
  layer3TextureUrl: string | null;
  layer3Mode: LayerMode;
  layer3Metalness: number;
  layer3Roughness: number;

  /** Scene-level env dim (same prop as BagMesh). 1 = default. */
  envIntensityScale?: number;
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
// Clones + de-indexes the source geometry, computes u = atan2(z,x)/2π around
// the Y axis and v = normalised height against the supplied yMin/yMax, then
// bumps low-u vertices on seam-spanning triangles by +1 so RepeatWrapping on
// the texture gives a seamless wrap.
function cylindricalUVs(
  src: THREE.BufferGeometry,
  yMin: number,
  yMax: number
): THREE.BufferGeometry {
  const geo = src.clone().toNonIndexed();
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const yRange = yMax - yMin || 1;

  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    uv[i * 2] = Math.atan2(z, x) / (Math.PI * 2) + 0.5;
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
  geo.computeVertexNormals();
  return geo;
}

interface DecalGeo {
  geometry: THREE.BufferGeometry;
  /** World matrix baked in so the decal mesh renders at the group level. */
  matrix: THREE.Matrix4;
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
  layer2Mode,
  layer2Metalness,
  layer2Roughness,
  layer3TextureUrl,
  layer3Mode,
  layer3Metalness,
  layer3Roughness,
  envIntensityScale = 1,
}: SupplementJarMeshProps) {
  const { scene: bodyScene } = useGLTF(JAR_BODY_GLB) as { scene: THREE.Group };
  const { scene: labelScene } = useGLTF(JAR_LABEL_GLB) as { scene: THREE.Group };

  // ── Plastic body/lid material ─────────────────────────────────────────────
  const plasticMat = useMemo(
    () =>
      new THREE.MeshPhysicalMaterial({
        color: "#141414",
        metalness: 0.1,
        roughness: 0.32,
        clearcoat: 0.8,
        clearcoatRoughness: 0.18,
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

  const multiChromeMat = useMemo(() => {
    const mat = new THREE.MeshPhysicalMaterial({
      metalness: 1.0,
      roughness: 0.0,
      envMapIntensity: CHROME_ENV_BASE,
      side: THREE.DoubleSide,
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
    holographicFoilMat.needsUpdate = true;
    multiChromeMat.needsUpdate = true;
  }, [envIntensityScale, holographicFoilMat, multiChromeMat]);

  // Pick the active Layer 1 material — matches BagMesh's traversal logic.
  const layer1Material: THREE.Material = useMemo(() => {
    if (finish === "foil") return holographicFoilMat;
    if (iridescence > 0) return multiChromeMat;
    return mylarMat;
  }, [finish, iridescence, mylarMat, holographicFoilMat, multiChromeMat]);

  // ── Layer 2 + Layer 3 decal materials ─────────────────────────────────────
  const makeDecalMat = (offset: number) =>
    new THREE.MeshStandardMaterial({
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

  const [layer2Tex, setLayer2Tex] = useState<THREE.Texture | null>(null);
  const [layer3Tex, setLayer3Tex] = useState<THREE.Texture | null>(null);

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

  // Foil mode pins metalness/roughness to mirror-polished chrome. Artwork mode
  // uses the per-layer controls so the designer can dial in satin vs. gloss.
  useEffect(() => {
    layer2Mat.map = layer2Tex;
    if (layer2Mode === "foil") {
      layer2Mat.metalness = 1.0;
      layer2Mat.roughness = 0.05;
    } else {
      layer2Mat.metalness = layer2Metalness;
      layer2Mat.roughness = layer2Roughness;
    }
    layer2Mat.envMapIntensity = DECAL_ENV_BASE * envIntensityScale;
    layer2Mat.needsUpdate = true;
  }, [layer2Tex, layer2Mode, layer2Metalness, layer2Roughness, envIntensityScale, layer2Mat]);

  useEffect(() => {
    layer3Mat.map = layer3Tex;
    if (layer3Mode === "foil") {
      layer3Mat.metalness = 1.0;
      layer3Mat.roughness = 0.05;
    } else {
      layer3Mat.metalness = layer3Metalness;
      layer3Mat.roughness = layer3Roughness;
    }
    layer3Mat.envMapIntensity = DECAL_ENV_BASE * envIntensityScale;
    layer3Mat.needsUpdate = true;
  }, [layer3Tex, layer3Mode, layer3Metalness, layer3Roughness, envIntensityScale, layer3Mat]);

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

  // Label: clone the label-only glb and build cylindrical-UV decal geometries
  // from each primitive for layers 2/3 to use. The cloned label scene is
  // itself rendered as Layer 1 with whatever material comes out of the
  // Surface controls.
  const { processedLabelScene, decalGeos } = useMemo(() => {
    const clone = labelScene.clone(true);
    const labelMeshes: THREE.Mesh[] = [];
    clone.traverse((obj) => {
      const m = obj as THREE.Mesh;
      if (!m.isMesh || !m.geometry) return;
      labelMeshes.push(m);
      m.castShadow = true;
      m.receiveShadow = true;
    });

    let yMinL = Infinity;
    let yMaxL = -Infinity;
    for (const m of labelMeshes) {
      const pos = m.geometry.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) {
        const y = pos.getY(i);
        if (y < yMinL) yMinL = y;
        if (y > yMaxL) yMaxL = y;
      }
    }

    clone.updateMatrixWorld(true);
    const decalGeos: DecalGeo[] = labelMeshes.map((src) => ({
      geometry: cylindricalUVs(src.geometry, yMinL, yMaxL),
      matrix: src.matrixWorld.clone(),
    }));

    return { processedLabelScene: clone, decalGeos };
  }, [labelScene]);

  // Apply the current Layer 1 material to every primitive of the label scene.
  useEffect(() => {
    processedLabelScene.traverse((obj) => {
      const m = obj as THREE.Mesh;
      if (!m.isMesh) return;
      m.material = layer1Material;
    });
  }, [processedLabelScene, layer1Material]);

  // ── Autofit ───────────────────────────────────────────────────────────────
  // Target height 1.8 units (smaller than the bag's ~2.5 so the jar doesn't
  // feel zoomed in when it loads). Group Y pins the base to y=-1.28 so both
  // models sit on the same floor.
  const { targetScale, groupY } = useMemo(() => {
    const bbox = new THREE.Box3().setFromObject(processedBodyScene);
    const height = bbox.max.y - bbox.min.y;
    const targetScale = height > 0 ? 1.8 / height : 1000;
    const groupY = -1.28 - bbox.min.y * targetScale;
    return { targetScale, groupY };
  }, [processedBodyScene]);

  return (
    <group
      scale={[targetScale, targetScale, targetScale]}
      position={[0, groupY, 0]}
    >
      <primitive object={processedBodyScene} />
      <primitive object={processedLabelScene} />

      {layer2Tex &&
        decalGeos.map((d, i) => (
          <mesh
            key={`l2-${i}`}
            geometry={d.geometry}
            matrix={d.matrix}
            matrixAutoUpdate={false}
            material={layer2Mat}
            renderOrder={1}
          />
        ))}

      {layer3Tex &&
        decalGeos.map((d, i) => (
          <mesh
            key={`l3-${i}`}
            geometry={d.geometry}
            matrix={d.matrix}
            matrixAutoUpdate={false}
            material={layer3Mat}
            renderOrder={2}
          />
        ))}
    </group>
  );
}
