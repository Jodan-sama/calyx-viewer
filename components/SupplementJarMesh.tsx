"use client";

import { useEffect, useMemo, useState } from "react";
import * as THREE from "three";
import { useGLTF } from "@react-three/drei";

const JAR_GLB = "/models/supplement-circle.glb";
useGLTF.preload(JAR_GLB);

const LABEL_ENV_BASE = 0.5;
const PLASTIC_ENV_BASE = 0.8;

interface SupplementJarMeshProps {
  /** Wrap-around label artwork. Null → no label decal (white mesh stays hidden). */
  textureUrl: string | null;
  labelMetalness: number;
  labelRoughness: number;
  /** Multiplier on envMap intensity — lets the scene dim reflections. */
  envIntensityScale?: number;
}

// ── Texture loader (mirrors BagMesh.loadLabelTexture) ────────────────────────
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
    tex.wrapS = THREE.RepeatWrapping; // so seam-overflow UVs (u>1) wrap cleanly
    return tex;
  } catch (e) {
    console.error("Texture load failed:", e);
    return null;
  }
}

// ── Cylindrical UV reprojection ──────────────────────────────────────────────
// The glb ships with an atlas UV layout that only uses a narrow strip of the
// texture space for the label side wrap. That's fine for the baked preview
// texture the modeller made, but user-uploaded artwork expects to fill u=[0,1]
// and wrap the full circumference of the cylinder. This function:
//
//   1. Clones + de-indexes the source geometry so per-triangle UV surgery is
//      safe to perform on unique vertices.
//   2. Computes u from atan2(z, x) around the cylinder axis (Y) and v from
//      normalised height against a shared yMin/yMax (passed in — shared across
//      ALL label primitives so they sample the same wrap).
//   3. Fixes the standard cylinder-wrap seam problem: triangles that straddle
//      u=0/u=1 get their low-u vertices bumped into the u>1 range and rely on
//      the texture's RepeatWrapping to sample continuously.
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

  // Seam fix: triangles whose u values span > 0.5 are wrapping around u=0/u=1.
  // Bump their low-u verts by +1 so the whole triangle samples a continuous
  // region (RepeatWrapping on the texture handles u>1).
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

interface LabelMeshData {
  geometry: THREE.BufferGeometry;
  /** Baked world transform from the source mesh, so we can render the label at
   *  the group level without re-parenting inside the cloned scene. */
  matrix: THREE.Matrix4;
}

export default function SupplementJarMesh({
  textureUrl,
  labelMetalness,
  labelRoughness,
  envIntensityScale = 1,
}: SupplementJarMeshProps) {
  const { scene } = useGLTF(JAR_GLB) as { scene: THREE.Group };

  // ── Materials ────────────────────────────────────────────────────────────
  // Opaque dark plastic for the jar body/lid. The GLB's native material is a
  // transmissive clearcoat black plastic, but transmission is expensive and
  // doesn't match the rest of the scene's visual language (the bag isn't
  // transmissive), so we swap to a solid jet-black physical plastic with a
  // clearcoat pass for shine highlights.
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

  // Label material — mirrors BagMesh's label (polygon offset so it sits on
  // top of the underlying white label without z-fighting).
  const labelMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        metalness: labelMetalness,
        roughness: labelRoughness,
        envMapIntensity: LABEL_ENV_BASE,
        transparent: true,
        alphaTest: 0.01,
        side: THREE.FrontSide,
        polygonOffset: true,
        polygonOffsetFactor: -4,
        polygonOffsetUnits: -4,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  // ── Load wrap texture ────────────────────────────────────────────────────
  const [labelTex, setLabelTex] = useState<THREE.Texture | null>(null);
  useEffect(() => {
    if (!textureUrl) {
      setLabelTex(null);
      return;
    }
    const signal = { cancelled: false };
    loadLabelTexture(textureUrl, signal).then((tex) => {
      if (!signal.cancelled && tex) setLabelTex(tex);
    });
    return () => {
      signal.cancelled = true;
    };
  }, [textureUrl]);

  useEffect(() => {
    labelMat.map = labelTex;
    labelMat.metalness = labelMetalness;
    labelMat.roughness = labelRoughness;
    labelMat.envMapIntensity = LABEL_ENV_BASE * envIntensityScale;
    labelMat.needsUpdate = true;
  }, [labelTex, labelMetalness, labelRoughness, envIntensityScale, labelMat]);

  // ── Process the scene ────────────────────────────────────────────────────
  // One-shot clone + prep: hide the original label meshes (we'll render our
  // reprojected-UV clones on top), swap in our plastic material for the jar
  // body, compute auto-scale + group Y-offset so the jar sits on the ground
  // at y=-1.28 (matching the bag).
  const { jarScene, labelMeshes, targetScale, groupY } = useMemo(() => {
    const cloned = scene.clone(true);

    // Pass 1: categorise meshes.
    const labelPrims: THREE.Mesh[] = [];
    cloned.traverse((obj) => {
      const m = obj as THREE.Mesh;
      if (!m.isMesh || !m.geometry) return;
      const mat = m.material as THREE.Material | undefined;
      // The GLB has exactly two materials: "Plastic" (body/lid) and an
      // unnamed red-tinted one (label). Negate to capture the label.
      const isLabel = mat?.name !== "Plastic";
      if (isLabel) {
        labelPrims.push(m);
        m.visible = false;
      } else {
        m.material = plasticMat;
        m.castShadow = true;
        m.receiveShadow = true;
      }
    });

    cloned.updateMatrixWorld(true);

    // Pass 2: compute shared label Y range (in world/local — they're the
    // same here because the GLB root nodes are all at identity).
    let yMinL = Infinity;
    let yMaxL = -Infinity;
    for (const m of labelPrims) {
      const pos = m.geometry.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) {
        const y = pos.getY(i);
        if (y < yMinL) yMinL = y;
        if (y > yMaxL) yMaxL = y;
      }
    }

    // Pass 3: build reprojected label geometries (one per source primitive),
    // baking each source's world matrix in so they can be rendered at the
    // group level with no re-parenting.
    const labelMeshes: LabelMeshData[] = labelPrims.map((src) => {
      const repro = cylindricalUVs(src.geometry, yMinL, yMaxL);
      return { geometry: repro, matrix: src.matrixWorld.clone() };
    });

    // Auto-fit: scale the whole jar to ~2.4 units tall (matches the bag's
    // rendered height so both models frame similarly in the camera).
    const bbox = new THREE.Box3().setFromObject(cloned);
    const height = bbox.max.y - bbox.min.y;
    const targetScale = height > 0 ? 2.4 / height : 1000;
    const groupY = -1.28 - bbox.min.y * targetScale;

    // Developer hint: log the recommended wrap ratio so the modeller knows
    // what aspect to hand us for user-uploaded artwork.
    const maxRadius = Math.max(
      Math.abs(bbox.min.x),
      Math.abs(bbox.max.x),
      Math.abs(bbox.min.z),
      Math.abs(bbox.max.z)
    );
    const labelHeight = yMaxL - yMinL;
    const circumference = 2 * Math.PI * maxRadius;
    console.log(
      `[SupplementJar] model bbox: ` +
        `${(bbox.max.x - bbox.min.x).toFixed(4)} × ${height.toFixed(4)} × ${(bbox.max.z - bbox.min.z).toFixed(4)} m — ` +
        `autoscale ${targetScale.toFixed(1)}×`
    );
    console.log(
      `[SupplementJar] label: height ${labelHeight.toFixed(4)} m, ` +
        `radius ${maxRadius.toFixed(4)} m, circumference ${circumference.toFixed(4)} m`
    );
    console.log(
      `[SupplementJar] recommended artwork aspect ratio: ` +
        `${(circumference / labelHeight).toFixed(2)} : 1 (width : height)`
    );

    return { jarScene: cloned, labelMeshes, targetScale, groupY };
  }, [scene, plasticMat]);

  return (
    <group
      scale={[targetScale, targetScale, targetScale]}
      position={[0, groupY, 0]}
    >
      <primitive object={jarScene} />
      {labelTex &&
        labelMeshes.map((lm, i) => (
          <mesh
            key={i}
            geometry={lm.geometry}
            material={labelMat}
            matrixAutoUpdate={false}
            matrix={lm.matrix}
            renderOrder={1}
          />
        ))}
    </group>
  );
}
