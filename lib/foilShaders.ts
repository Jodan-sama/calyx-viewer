/**
 * Shared shader-injection helpers for the foil family of finishes
 * (holographic, prismatic, multi-chrome). Each injection patches
 * `onBeforeCompile` on a MeshPhysicalMaterial — the base PBR shading
 * still runs, then our code overrides the final colour in
 * `<dithering_fragment>`.
 *
 * Currently only the prismatic injection is extracted; holographic
 * foil and multi-chrome still live inline in the mesh components
 * because their duplication is lower (two copies each vs four for
 * prismatic) and they don't share a tuning-knob story yet. If we
 * tweak either in the future, pull them here too.
 */

import type * as THREE from "three";

// ── Vertex injection ────────────────────────────────────────────────────────
// Exposes world-space position as `vWorldPos` so the fragment shader can
// sample view-dependent and position-dependent effects (grating lines,
// rainbow hue rotation, etc.). Structurally identical across every foil
// finish, so it lives here as a single source of truth.
const VERTEX_VARYING_DECL = `varying vec3 vWorldPos;\n`;
const VERTEX_WORLDPOS_TOKEN = "#include <worldpos_vertex>";
const VERTEX_WORLDPOS_INJECT = `#include <worldpos_vertex>
    vWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`;

/** Build the pastel-prismatic fragment shader body.
 *
 *  - `mixStrength`: how aggressively the foil colour replaces the
 *    material's own PBR result. ~0.60 for base-material use (a
 *    subtle tint overlay on top of full PBR), ~0.85 for masked-
 *    variant use (mostly replace the base colour — the per-pixel
 *    alphaMap still cuts out the artwork shape, so the PBR colour
 *    was mostly noise anyway).
 *  - `preserveAlpha`: when true, leaves `gl_FragColor.a` alone so
 *    the alphaMap chain still drives transparency (needed for the
 *    masked Layer 2 / Layer 3 variants). When false, forces alpha
 *    to 1.0 (opaque base mylar). */
function prismaticFragmentInject({
  mixStrength,
  preserveAlpha,
}: {
  mixStrength: number;
  preserveAlpha: boolean;
}): string {
  const alphaLine = preserveAlpha
    ? `// gl_FragColor.a left alone — alphaMap chain handles the cutout.`
    : `gl_FragColor.a = 1.0;`;
  return `#include <dithering_fragment>
    vec3 wN = normalize(vNormal);
    vec3 vd = normalize(cameraPosition - vWorldPos);
    float ndv = clamp(dot(wN, vd), 0.0, 1.0);
    // Rotate world XY by ~37° so the grating runs diagonally and
    // catches highlights regardless of surface orientation.
    float ca = 0.7986; // cos(0.64)
    float sa = 0.6018; // sin(0.64)
    vec2 rot = vec2(vWorldPos.x * ca - vWorldPos.y * sa,
                    vWorldPos.x * sa + vWorldPos.y * ca);
    // Fine parallel grating along the rotated X axis.
    float grating = sin(rot.x * 220.0) * 0.5 + 0.5;
    // Hue shifts along the streak direction + with view angle + normal
    // wobble so rotation reveals colour flow.
    float hue = fract(
      rot.y * 4.5 + ndv * 1.4 + wN.x * 0.35 + wN.y * 0.25
    );
    vec3 rainbow = clamp(abs(mod(hue * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
    // Lift saturated hues into a 0.72–1.0 band so each peak reads as
    // a powdered pastel (pink, peach, butter, mint, sky, lavender)
    // rather than primary rainbow.
    vec3 pastel = rainbow * 0.28 + 0.72;
    vec3 chrome = vec3(0.92, 0.94, 0.98);
    vec3 prismBand = mix(chrome, pastel, 0.72);
    // Grating modulates how strongly the pastel reads — peaks show
    // full tint, troughs pull toward off-white chrome.
    vec3 finalColor = mix(chrome * 0.95, prismBand, 0.55 + grating * 0.45);
    gl_FragColor.rgb = mix(gl_FragColor.rgb, finalColor, ${mixStrength.toFixed(2)});
    ${alphaLine}`;
}

/** Attach the pastel-prismatic shader to a MeshPhysicalMaterial via
 *  `onBeforeCompile`. Safe to call on a fresh material before it's
 *  been added to the scene; three.js compiles the shader lazily on
 *  first render.
 *
 *  Callers should still set `metalness: 1`, `roughness: 0`, and a
 *  colour scheme (chrome-ish) on the material — the shader blends
 *  into the material's PBR result rather than replacing it. */
export function applyPrismaticShader(
  mat: THREE.MeshPhysicalMaterial,
  opts: { mixStrength: number; preserveAlpha: boolean }
): void {
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = VERTEX_VARYING_DECL + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace(
      VERTEX_WORLDPOS_TOKEN,
      VERTEX_WORLDPOS_INJECT
    );
    shader.fragmentShader = VERTEX_VARYING_DECL + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <dithering_fragment>",
      prismaticFragmentInject(opts)
    );
  };
}
