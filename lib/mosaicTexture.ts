/**
 * Mosaic-material helpers.
 *
 * The "mosaic" finish treats an uploaded square-ish source image as a tile
 * library: whenever the finish is applied (or re-randomised), a random
 * sub-rectangle of the source is mapped onto the target surface. To keep
 * the imagery from distorting, the crop's aspect ratio is chosen to match
 * the target surface's world-space aspect ratio, so a 2:1-wide bag panel
 * gets a 2:1-wide crop and a 1:2-tall jar label gets a 1:2-tall crop.
 *
 * Implementation: we lean on THREE.Texture.offset + THREE.Texture.repeat
 * rather than writing a custom shader, so the mosaic variant is just a
 * standard PBR material (MeshPhysicalMaterial with map = mosaicTex). Each
 * consuming material needs its own Texture clone because offset/repeat
 * live on the Texture object — sharing one Texture across four meshes
 * would stomp each other's crop windows.
 */

import * as THREE from "three";

/** Load an image URL into a CanvasTexture tuned for colour use (sRGB,
 *  anisotropy 16) and configured for RepeatWrapping so offset/repeat
 *  sampling stays clean at edges. Returns null if the fetch/decode fails
 *  (the caller should skip mosaic rendering in that case). */
export async function loadMosaicTexture(
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
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(bitmap, 0, 0);

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 16;
    // RepeatWrapping lets numerical edge-cases (offset + repeat ≈ 1 + epsilon)
    // fall back to a wrap rather than hitting the clamped-edge pixel band.
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    return tex;
  } catch (e) {
    console.error("Mosaic texture load failed:", e);
    return null;
  }
}

/** Shallow-clone a mosaic texture so a consumer can set its own
 *  offset/repeat without stomping siblings that share the same source
 *  image. The clone shares the underlying canvas pixel buffer, so this is
 *  cheap and memory-safe. */
export function cloneMosaicTexture(src: THREE.Texture): THREE.Texture {
  const clone = src.clone();
  clone.needsUpdate = true;
  return clone;
}

/** Build a greyscale CanvasTexture whose brightness equals the source
 *  artwork's alpha channel — suitable for MeshPhysicalMaterial.alphaMap
 *  so a mosaic-coloured material can be cut out by the artwork shape.
 *  Mirrors buildAlphaBumpTexture in BagMesh/SupplementJarMesh but with
 *  NoColorSpace so three.js treats the red channel as a pure mask
 *  sample rather than applying sRGB decode. */
export function buildArtworkAlphaMap(
  src: THREE.Texture
): THREE.CanvasTexture | null {
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
  return tex;
}

/** Resolve the UV transform (repeat, offset, center) that samples an
 *  aspect-correct crop of the source image onto a target surface whose
 *  UVs run 0–1 over a rectangle with the given world aspect (width /
 *  height).
 *
 *  The crop is the largest rectangle inside the 0–1 source with the
 *  target aspect, scaled by `zoom`:
 *  - zoom = 1 → full-fit aspect-correct crop of the source
 *  - zoom < 1 → zoomed-in, smaller window
 *  - zoom > 1 → zoomed-out, tiles the source across the surface via
 *    RepeatWrapping (the only way to "zoom out" past full fit on a
 *    bounded 1×1 source image)
 *
 *  Per-layer randomness is provided by two kinds of knobs:
 *  - `offsetU`, `offsetV` ∈ [0, 1] — pan the crop centre inside the
 *    source. At zoom ≤ 1 the seed always lands inside [0, 1]; at
 *    zoom > 1 the source tiles and offset just shifts the tiling.
 *  - `flipX`, `flipY` — mirror the crop along either axis. Flipping
 *    preserves aspect (no axis-swap), so unlike a free rotation it
 *    never distorts when the target aspect is not 1:1 (critical for
 *    cylindrical jar labels where circumference/height ≠ 1).
 *
 *  `aspect === null` (unknown UV layout) falls back to a square crop. */
export function resolveMosaicCrop(params: {
  aspect: number | null;
  zoom: number;
  offsetU: number;
  offsetV: number;
  flipX: boolean;
  flipY: boolean;
}): {
  repeatX: number;
  repeatY: number;
  offsetX: number;
  offsetY: number;
  centerX: number;
  centerY: number;
} {
  // Zoom clamp: allow tiling up to 3x for a pronounced zoom-out without
  // pixelated repeats. Lower bound stays tiny so users can zoom into a
  // single grain of the source if they want.
  const z = Math.max(0.02, Math.min(3, params.zoom));
  let magX: number;
  let magY: number;
  if (params.aspect == null || !isFinite(params.aspect) || params.aspect <= 0) {
    magX = z;
    magY = z;
  } else if (params.aspect >= 1) {
    magX = z;
    magY = z / params.aspect;
  } else {
    magY = z;
    magX = z * params.aspect;
  }

  // Tile around the centre of the crop window. Offset math uses |repeat|
  // so the valid seed band remains [-(1-|r|)/2, (1-|r|)/2] regardless
  // of flip — a negative repeat still spans |r| in source UV, just
  // sampled right-to-left or top-to-bottom.
  const seedU = Math.max(0, Math.min(1, params.offsetU));
  const seedV = Math.max(0, Math.min(1, params.offsetV));
  const offsetX = (seedU - 0.5) * (1 - magX);
  const offsetY = (seedV - 0.5) * (1 - magY);

  return {
    // Negative repeat flips the axis via three.js' UV matrix
    // (sample = repeat * (uv - center) + center + offset). No axis-swap,
    // so the crop's aspect stays matched to the target.
    repeatX: params.flipX ? -magX : magX,
    repeatY: params.flipY ? -magY : magY,
    offsetX,
    offsetY,
    centerX: 0.5,
    centerY: 0.5,
  };
}

/** Apply a resolved mosaic crop to a THREE.Texture in place. Call
 *  `tex.needsUpdate = true` after if the caller hasn't already flagged
 *  it; three.js picks up offset/repeat changes without re-uploading
 *  pixel data, but the material's shader program needs the uniform
 *  refresh on the next render. */
export function applyMosaicCrop(
  tex: THREE.Texture,
  crop: {
    repeatX: number;
    repeatY: number;
    offsetX: number;
    offsetY: number;
    centerX: number;
    centerY: number;
  }
): void {
  tex.center.set(crop.centerX, crop.centerY);
  tex.rotation = 0;
  tex.offset.set(crop.offsetX, crop.offsetY);
  tex.repeat.set(crop.repeatX, crop.repeatY);
}
