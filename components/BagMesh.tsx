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

// Converts hue [0–1] to RGB — used to build the holographic color map
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
  // Spatially varying rainbow — different UV positions = different hues simultaneously.
  // When metalness=1.0 this becomes the reflective tint, so the bag shows
  // multiple colors at once like real holographic diffraction foil.
  const W = 512, H = 512;
  const canvas = document.createElement("canvas");
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  const imgData = ctx.createImageData(W, H);
  const d = imgData.data;

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const u = x / W;
      const v = y / H;

      // Diagonal bands + swirl — mimics real diffraction grating pattern
      const hue = (
        (u * 2.1 + v * 1.3) +            // diagonal bands
        Math.sin(u * 18 + v * 12) * 0.18 + // wave distortion
        Math.sin((u - v) * 24)    * 0.12   // interference ripple
      ) % 1.0;

      const [r, g, b] = hsvToRgb((hue + 1) % 1);
      const i = (y * W + x) * 4;
      d[i]     = Math.floor(r * 255);
      d[i + 1] = Math.floor(g * 255);
      d[i + 2] = Math.floor(b * 255);
      d[i + 3] = 255;
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
  ctx.closePath(); ctx.strokeStyle = "#52b788"; ctx.lineWidth = 2.5; ctx.stroke();

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
  const groupRef = useRef<THREE.Group>(null);
  const labelGroupRef = useRef<THREE.Group>(null);
  const { scene } = useGLTF("/mylar_bag.glb") as { scene: THREE.Group };

  const placeholderTex = useMemo(() => buildPlaceholderTexture(), []);
  const holographicTex = useMemo(() => buildHolographicTexture(), []);

  // Holographic Foil shader — small repeating circle dot pattern with full rainbow + heavy chrome
  const holographicFoilMat = useMemo(() => {
    const mat = new THREE.MeshPhysicalMaterial({
      metalness: 1.0,
      roughness: 0.0,
      envMapIntensity: 0.6,
      side: THREE.DoubleSide,
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
        // Holographic foil: circle dot grid with full rainbow + chrome
        vec3 wN = normalize(vNormal);
        vec3 vd = normalize(cameraPosition - vWorldPos);
        float ndv = clamp(dot(wN, vd), 0.0, 1.0);

        // Tight dot grid in world space
        float scale = 28.0;
        vec2 cell = fract(vec2(vWorldPos.x, vWorldPos.y) * scale) - 0.5;
        float dist = length(cell);
        // Soft circle edge
        float circle = 1.0 - smoothstep(0.28, 0.42, dist);

        // Each cell shifts through the full rainbow as view angle changes.
        // Cell index adds a tiny staggered offset so adjacent dots are slightly different hues.
        vec2 cellId = floor(vec2(vWorldPos.x, vWorldPos.y) * scale);
        float cellOffset = fract(sin(cellId.x * 127.1 + cellId.y * 311.7) * 0.12);
        float cellHue = fract(
          ndv * 1.8 +           // primary driver — full spectrum sweep as you rotate
          wN.x * 0.5 +          // surface normal contributes so it follows geometry too
          wN.y * 0.3 +
          cellOffset            // small stagger so dots aren't all identical
        );

        // Full rainbow spectrum, pulled toward chrome (desaturated)
        vec3 rainbow = clamp(
          abs(mod(cellHue * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0,
          0.0, 1.0
        );
        vec3 chrome = vec3(0.85, 0.90, 0.95);
        // Blend rainbow toward chrome so dots are tinted, not saturated
        vec3 dotColor = mix(chrome, rainbow, 0.55);
        // In gaps: pure chrome. In dots: tinted chrome.
        vec3 foilColor = mix(chrome, dotColor, circle * 0.80);

        // Chrome dominant but dots clearly visible
        gl_FragColor.rgb = mix(gl_FragColor.rgb, foilColor, 0.52);
        gl_FragColor.a = 1.0;`
      );
    };
    return mat;
  }, []);

  // Custom shader material — bypasses PBR and computes rainbow directly in GLSL.
  // Combines world-position spatial banding + view-angle shift so multiple colors
  // appear simultaneously across the bag surface like real holographic mylar.
  const multiChromeMat = useMemo(() => {
    const mat = new THREE.MeshPhysicalMaterial({
      metalness: 1.0,
      roughness: 0.0,
      envMapIntensity: 0.25,
      side: THREE.DoubleSide,
    });

    mat.onBeforeCompile = (shader) => {
      // Pass world position through to fragment shader
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
        // Holographic multi-chrome — normal-driven so color follows bag geometry
        vec3 wN = normalize(vNormal);
        vec3 vd = normalize(cameraPosition - vWorldPos);
        float ndv = clamp(dot(wN, vd), 0.0, 1.0);

        // Primary hue driver: surface normal direction in world space.
        // As the bag curves, normals rotate → colors shift organically with the shape.
        // Combine all three axes so both front/back/sides all shift.
        float normalHue =
          wN.x * 0.50 +
          wN.y * 0.30 +
          wN.z * 0.20;

        // Secondary: fine world-position detail — very low frequency, just enough
        // to break up uniformity without creating hard bands
        float detail =
          sin(vWorldPos.x * 2.2 + vWorldPos.y * 1.8) * 0.12 +
          sin(vWorldPos.y * 1.5 - vWorldPos.z * 2.0) * 0.08;

        // View-angle shift — makes color shimmer as camera moves
        float hue = fract(normalHue * 0.6 + detail + ndv * 0.35 + 0.15);

        // Custom palette: chrome → blue → purple → pink → chrome (no green, no red)
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

        // Subtle blend: chrome dominant, palette tints the highlights
        gl_FragColor.rgb = mix(gl_FragColor.rgb, palColor, 0.40);
        gl_FragColor.a = 1.0;`
      );
    };
    return mat;
  }, []);
  const [uploadedTex, setUploadedTex] = useState<THREE.Texture | null>(null);

  useEffect(() => {
    if (!textureUrl) { setUploadedTex(null); return; }
    let cancelled = false;

    (async () => {
      try {
        // premultiplyAlpha:'none' preserves the true alpha channel before canvas
        const blob = await fetch(textureUrl).then(r => r.blob());
        const bitmap = await createImageBitmap(blob, { premultiplyAlpha: "none" });
        if (cancelled) return;

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

  const bagScene = useMemo(() => scene.clone(true), [scene]);

  // Bag: MeshPhysicalMaterial (supports iridescence for multi-chrome)
  const mylarMat = useMemo(() => new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(color),
    metalness,
    roughness,
    envMapIntensity: 2.0,
    side: THREE.DoubleSide,
    iridescence,
    iridescenceIOR,
    iridescenceThicknessRange,
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), []);

  // Label: MeshStandardMaterial with canvas-converted texture for correct RGBA handling
  const labelMat = useMemo(() => {
    const mat = new THREE.MeshStandardMaterial({
      map: placeholderTex,
      metalness: labelMetalness,
      roughness: labelRoughness,
      envMapIntensity: 0.5,
      transparent: true,
      alphaTest: 0.05,
      side: THREE.FrontSide,
    });
    mat.depthTest = false;
    mat.depthWrite = false;
    return mat;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placeholderTex]);

  useEffect(() => {
    mylarMat.color.set(color);
    mylarMat.metalness = metalness;
    mylarMat.roughness = roughness;
    mylarMat.iridescence = iridescence;
    mylarMat.iridescenceIOR = iridescenceIOR;
    mylarMat.iridescenceThicknessRange = iridescenceThicknessRange;
    // Multi-chrome: use the texture as an iridescenceThicknessMap.
    // Different UV positions = different optical film thickness = different interference color.
    // This is physically how real holographic mylar produces simultaneous multi-color.
    if (iridescence && iridescence > 0) {
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
    labelMat.map = labelTex;
    labelMat.metalness = labelMetalness;
    labelMat.roughness = labelRoughness;
    labelMat.needsUpdate = true;
  }, [labelTex, labelMetalness, labelRoughness, labelMat]);

  useEffect(() => {
    bagScene.traverse((obj) => {
      const m = obj as THREE.Mesh;
      if (!m.isMesh) return;
      if (finish === "foil") m.material = holographicFoilMat;
      else if (iridescence > 0) m.material = multiChromeMat;
      else m.material = mylarMat;
      m.castShadow = true;
      m.receiveShadow = true;
      m.renderOrder = 0;
    });
  }, [bagScene, mylarMat, multiChromeMat, holographicFoilMat, iridescence, finish]);

  useFrame(({ clock }) => {
    const t = clock.elapsedTime * 0.6;
    const float = Math.sin(t) * 0.02;
    if (groupRef.current) groupRef.current.position.y = BASE_POS[1] + float;
    if (labelGroupRef.current) labelGroupRef.current.position.y = BASE_POS[1] + float;
  });

  // The label lives in a SEPARATE group (not a child of the bag group)
  // so it is never affected by the bag group's renderOrder or depth state.
  // Both groups share the same position/scale transform.
  const SCALE: [number, number, number] = [5.5, 5.5, 5.5];
  const BASE_POS: [number, number, number] = [0, -1.1, 0];

  return (
    <>
      {/* Bag */}
      <group ref={groupRef} position={BASE_POS} scale={SCALE}>
        <primitive object={bagScene} />
      </group>

      {/* Label — separate group so renderOrder is independent of bag group */}
      <group ref={labelGroupRef} position={BASE_POS} scale={SCALE}>
        <mesh
          renderOrder={999}
          position={[0, 0.168, 0.025]}
          material={labelMat}
        >
          <planeGeometry args={[0.195, 0.268]} />
        </mesh>
      </group>
    </>
  );
}
