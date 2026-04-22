"use client";

import { useEffect } from "react";
import { useThree } from "@react-three/fiber";

/**
 * Walks the entire scene and pre-compiles every material's WebGL
 * shader program in one batch instead of letting them compile
 * lazily on first render. Three.js's `renderer.compile(scene, camera)`
 * is a single call that builds all programs the scene currently
 * contains.
 *
 * Without this the user sees a cascade on mobile: plain mesh first,
 * then the foil / prismatic / multi-chrome shaders pop in one by one
 * as each compile finishes on the serial GL queue. One batched
 * compile still takes the same total time but the user only sees a
 * single "blank → fully-rendered" transition — no flicker through
 * intermediate appearances.
 *
 * Must be mounted INSIDE whatever `<Suspense>` boundary gates the
 * rest of the scene so that by the time our useEffect runs, all
 * `useGLTF` / `Environment` suspensions have resolved and the scene
 * actually contains the meshes + materials we want to compile.
 *
 * Kicks off on the first `requestAnimationFrame` after mount so
 * every peer `useEffect` in the scene (BagMesh's material-update
 * hooks, bump-map wiring, etc.) gets a chance to assign maps and
 * set `needsUpdate` before we compile. Compiling too early would
 * produce programs against a partially-initialised material state
 * and force a second compile on first use — defeating the point.
 */
export default function ShaderPrecompile() {
  const { gl, scene, camera } = useThree();

  useEffect(() => {
    let cancelled = false;
    const raf = requestAnimationFrame(() => {
      if (cancelled) return;
      // Safe to call repeatedly; three.js skips already-compiled
      // programs, so a duplicate invocation is effectively free if
      // the scene changes later.
      gl.compile(scene, camera);
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, [gl, scene, camera]);

  return null;
}
