"use client";

import { useRef, useMemo, useEffect, useState } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";

interface BagMeshProps {
  textureUrl: string | null;
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

function buildPlaceholderTexture(): THREE.CanvasTexture {
  const W = 512, H = 768;
  const canvas = document.createElement("canvas");
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d")!;

  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0.0, "#14302a");
  bg.addColorStop(0.55, "#0c1f18");
  bg.addColorStop(1.0, "#091510");
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);

  ctx.strokeStyle = "rgba(82,183,136,0.06)"; ctx.lineWidth = 1;
  for (let gy = 0; gy < H; gy += 32) {
    ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(W, gy); ctx.stroke();
  }

  const cx = W / 2, cy = H * 0.375, r = 82;
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i - Math.PI / 6;
    i === 0
      ? ctx.moveTo(cx + r * Math.cos(a), cy + r * Math.sin(a))
      : ctx.lineTo(cx + r * Math.cos(a), cy + r * Math.sin(a));
  }
  ctx.closePath();
  ctx.strokeStyle = "#52b788"; ctx.lineWidth = 2.5; ctx.stroke();

  ctx.fillStyle = "#52b788"; ctx.font = "500 19px Arial";
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText("CONTAINERS", cx, H * 0.638);

  ctx.strokeStyle = "rgba(82,183,136,0.28)"; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(cx - 68, H * 0.697); ctx.lineTo(cx + 68, H * 0.697); ctx.stroke();
  ctx.fillStyle = "rgba(255,255,255,0.22)"; ctx.font = "13px Arial";
  ctx.fillText("Upload your artwork above", cx, H * 0.755);

  ctx.globalCompositeOperation = "destination-out"; ctx.fillStyle = "rgba(0,0,0,1)";
  ctx.beginPath(); ctx.arc(cx, cy, r - 5, 0, Math.PI * 2); ctx.fill();
  ctx.font = "bold 74px Arial"; ctx.fillText("CALYX", cx, H * 0.564);
  ctx.globalCompositeOperation = "source-over";

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

useGLTF.preload("/mylar_bag.glb");


export default function BagMesh({
  textureUrl, metalness, roughness, color, labelMetalness, labelRoughness,
  iridescence = 0, iridescenceIOR = 1.5, iridescenceThicknessRange = [100, 800],
  finish = "",
}: BagMeshProps) {
  // ── Refs (declared first so closures below can reference them) ────────────
  const groupRef     = useRef<THREE.Group>(null);
  const imgDimsRef   = useRef({ w: 512, h: 768 }); // updated when image loads
  const decalDirty   = useRef(true);                // triggers decal rebuild in useFrame

  // ── Scene ─────────────────────────────────────────────────────────────────
  const { scene } = useGLTF("/mylar_bag.glb") as { scene: THREE.Group };

  const placeholderTex  = useMemo(() => buildPlaceholderTexture(), []);
  const holographicTex  = useMemo(() => buildHolographicTexture(), []);

  // ── Holographic Foil shader ───────────────────────────────────────────────
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

  // ── Multi-chrome shader ───────────────────────────────────────────────────
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

  // ── Texture loading ───────────────────────────────────────────────────────
  const [uploadedTex, setUploadedTex] = useState<THREE.Texture | null>(null);

  useEffect(() => {
    if (!textureUrl) {
      setUploadedTex(null);
      imgDimsRef.current = { w: 512, h: 768 };
      decalDirty.current = true;
      return;
    }
    let cancelled = false;

    (async () => {
      try {
        const blob = await fetch(textureUrl).then(r => r.blob());
        const bitmap = await createImageBitmap(blob, { premultiplyAlpha: "none" });
        if (cancelled) return;

        imgDimsRef.current = { w: bitmap.width, h: bitmap.height };
        decalDirty.current = true;

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
        setUploadedTex(tex);
      } catch (e) {
        console.error("Texture load failed:", e);
      }
    })();

    return () => { cancelled = true; };
  }, [textureUrl]);

  const labelTex = uploadedTex ?? placeholderTex;

  // ── Bag scene + materials ─────────────────────────────────────────────────
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

  // ── Label material with view-space normal fade ────────────────────────────
  // Uses onBeforeCompile to fade alpha on gusset/side faces using the
  // view-space normal Z component: front panel (Z≈1) → opaque, gussets (Z≈0) → transparent
  const labelMat = useMemo(() => {
    const mat = new THREE.MeshStandardMaterial({
      metalness: labelMetalness,
      roughness: labelRoughness,
      envMapIntensity: 0.5,
      transparent: true,
      alphaTest: 0.01,
      side: THREE.FrontSide,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    mat.onBeforeCompile = (shader) => {
      // After alphamap_fragment (which sets diffuseColor.a from map),
      // fade alpha by view-space normal Z before alphatest_fragment
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <alphatest_fragment>',
        `// Gusset edge fade: triangles whose normals face away from camera
        // get alpha reduced so only the flat front panel shows the label
        float vsFacing = max(0.0, normalize(vNormal).z);
        float edgeFade = smoothstep(0.18, 0.55, vsFacing);
        diffuseColor.a *= edgeFade;
        #include <alphatest_fragment>`
      );
    };
    mat.customProgramCacheKey = () => 'label-edge-fade-v1';
    return mat;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync label material props when they change
  useEffect(() => {
    labelMat.map = labelTex;
    labelMat.metalness = labelMetalness;
    labelMat.roughness = labelRoughness;
    labelMat.needsUpdate = true;
  }, [labelTex, labelMetalness, labelRoughness, labelMat]);

  // ── Front-face label geometry (full front panel coverage) ─────────────────
  const [frontLabelGeo, setFrontLabelGeo] = useState<THREE.BufferGeometry | null>(null);

  // Dispose old geometry when replaced
  useEffect(() => () => { frontLabelGeo?.dispose(); }, [frontLabelGeo]);

  // ── Animation loop: float + decal rebuild ─────────────────────────────────
  const BASE_Y = -1.1;

  useFrame(({ clock }) => {
    if (!groupRef.current) return;

    // Float animation
    groupRef.current.position.y = BASE_Y + Math.sin(clock.elapsedTime * 0.6) * 0.02;

    // Rebuild decal once per dirty flag (runs the frame after state settles)
    if (!decalDirty.current) return;
    decalDirty.current = false;

    // Ensure world matrices are current for every node in the sub-tree
    groupRef.current.updateMatrixWorld(true);

    // Pick the mesh whose average world-space normal points most toward +Z (front face)
    let frontMesh: THREE.Mesh | null = null;
    let bestZ = -Infinity;
    groupRef.current.traverse((obj) => {
      const m = obj as THREE.Mesh;
      if (!m.isMesh) return;
      const normals = m.geometry.attributes.normal;
      if (!normals) return;
      // Sample every 64th normal to keep it fast
      const normalMat = new THREE.Matrix3().getNormalMatrix(m.matrixWorld);
      let sumZ = 0, count = 0;
      const tmp = new THREE.Vector3();
      for (let i = 0; i < normals.count; i += 64) {
        tmp.fromBufferAttribute(normals, i).applyMatrix3(normalMat).normalize();
        sumZ += tmp.z;
        count++;
      }
      const avgZ = sumZ / count;
      if (avgZ > bestZ) { bestZ = avgZ; frontMesh = m; }
    });
    if (!frontMesh) return;

    // ── Bake the mesh's nested transforms into group-local space ─────────────
    const groupInv    = new THREE.Matrix4().copy(groupRef.current.matrixWorld).invert();
    const meshToGroup = new THREE.Matrix4().multiplyMatrices(groupInv, (frontMesh as THREE.Mesh).matrixWorld);
    const geo = (frontMesh as THREE.Mesh).geometry.clone();
    geo.applyMatrix4(meshToGroup);

    // ── Recompute UVs from vertex XY position (correct orientation guaranteed) ─
    const posAttr = geo.attributes.position as THREE.BufferAttribute;
    const uvAttr  = geo.attributes.uv as THREE.BufferAttribute;
    let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity;
    for (let i = 0; i < posAttr.count; i++) {
      const x = posAttr.getX(i), y = posAttr.getY(i);
      if (x < xMin) xMin = x; if (x > xMax) xMax = x;
      if (y < yMin) yMin = y; if (y > yMax) yMax = y;
    }
    const xRange = xMax - xMin, yRange = yMax - yMin;
    for (let i = 0; i < uvAttr.count; i++) {
      uvAttr.setXY(
        i,
        (posAttr.getX(i) - xMin) / xRange,
        (posAttr.getY(i) - yMin) / yRange
      );
    }
    uvAttr.needsUpdate = true;

    // ── Remove definitively back-facing triangles (cross product nz ≤ 0) ──────
    // Gusset/side triangles are NOT filtered here — the label material's
    // onBeforeCompile shader fades them via view-space normal Z smoothstep.
    // This keeps full front-panel coverage (no chrome gaps at edges) while
    // the shader handles the natural gusset fade.
    const idx = geo.index;
    if (idx) {
      const pos = geo.attributes.position as THREE.BufferAttribute;
      const keep: number[] = [];
      for (let i = 0; i < idx.count; i += 3) {
        const ia = idx.getX(i), ib = idx.getX(i + 1), ic = idx.getX(i + 2);
        const ax=pos.getX(ia),ay=pos.getY(ia);
        const bx=pos.getX(ib),by=pos.getY(ib);
        const cx=pos.getX(ic),cy=pos.getY(ic);
        // nz > 0 → winding faces toward +Z (camera direction), keep it
        const nz = (bx-ax)*(cy-ay) - (by-ay)*(cx-ax);
        if (nz > 0) keep.push(ia, ib, ic);
      }
      geo.setIndex(keep);
    }
    // computeVertexNormals so per-vertex normals are correct in view space
    // (used by the edge-fade shader to determine facing angle)
    geo.computeVertexNormals();

    setFrontLabelGeo(geo);
  });

  return (
    <group ref={groupRef} position={[0, BASE_Y, 0]} scale={[5.5, 5.5, 5.5]}>
      {/* Bag */}
      <primitive object={bagScene} />

      {/* Label — front mesh geometry with position-based UVs.
           Material uses onBeforeCompile shader to fade alpha on gusset faces
           via view-space normal Z, so only the flat front panel shows the label. */}
      {frontLabelGeo && (
        <mesh geometry={frontLabelGeo} material={labelMat} renderOrder={1} />
      )}
    </group>
  );
}
