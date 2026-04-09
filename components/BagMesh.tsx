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
}: BagMeshProps) {
  const groupRef = useRef<THREE.Group>(null);
  const labelGroupRef = useRef<THREE.Group>(null);
  const { scene } = useGLTF("/mylar_bag.glb") as { scene: THREE.Group };

  const placeholderTex = useMemo(() => buildPlaceholderTexture(), []);
  const [uploadedTex, setUploadedTex] = useState<THREE.Texture | null>(null);

  useEffect(() => {
    if (!textureUrl) { setUploadedTex(null); return; }
    let cancelled = false;
    const img = new Image();
    img.onload = () => {
      if (cancelled) return;
      // Draw onto a canvas so RGBA/transparency is preserved correctly
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d")!;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 16;
      setUploadedTex(tex);
    };
    img.src = textureUrl;
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
    mylarMat.needsUpdate = true;
  }, [color, metalness, roughness, iridescence, iridescenceIOR, iridescenceThicknessRange, mylarMat]);

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
      m.material = mylarMat;
      m.castShadow = true;
      m.receiveShadow = true;
      m.renderOrder = 0;
    });
  }, [bagScene, mylarMat]);

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
