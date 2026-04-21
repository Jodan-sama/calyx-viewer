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

/** Build a horizontally-symmetric version of a source texture by drawing
 *  the left half of the image, then drawing a horizontally-flipped copy
 *  of that same left half into the right half. Result has the same
 *  dimensions and aspect ratio as the source, but is mirrored about its
 *  vertical centre — any crop taken from it inherits that symmetry.
 *
 *  Used by BagMesh for its own "Mirror" toggle. The cylindrical jar
 *  label has stricter needs (one mirror axis dead-centre, no distortion)
 *  and uses `buildMirroredLabelTexture` below instead. */
export function buildMirroredSourceTexture(
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
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  const halfW = Math.floor(w / 2);

  // Left half — the source's own left half at 1:1.
  ctx.drawImage(
    img as CanvasImageSource,
    0, 0, halfW, h,
    0, 0, halfW, h
  );

  // Right half — the same left half, horizontally flipped. Translate
  // the drawing origin to the image's right edge and scale negatively
  // on X so the subsequent drawImage paints right-to-left.
  ctx.save();
  ctx.translate(w, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(
    img as CanvasImageSource,
    0, 0, halfW, h,
    0, 0, halfW, h
  );
  ctx.restore();

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 16;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

/** Build a canvas texture that fills the jar's cylindrical label in one
 *  wrap with a single centre-mirror axis. The first iteration of the
 *  mirror toggle mirrored the whole source into a 1:1 canvas and then
 *  let aspect-correct tiling wrap it 3–4× around the label, so users
 *  saw 3–4 mirror axes. This builds a canvas at the label's physical
 *  aspect directly: a half-label-aspect crop from the source, doubled
 *  into a label-aspect canvas with a single horizontal mirror at
 *  canvas-centre. The consuming material applies it with
 *  offset = (0, 0) and repeat = (1, 1) — no tiling, no distortion,
 *  one mirror axis dead-centre on the label.
 *
 *  Per-layer: each layer's offsetU/offsetV/zoom selects a different
 *  half-label strip from the source, so Layer 1/2/3 stay visually
 *  distinct even when all three use mirror mode. */
export function buildMirroredLabelTexture(params: {
  source: HTMLImageElement | HTMLCanvasElement | ImageBitmap;
  labelAspect: number;
  zoom: number;
  offsetU: number;
  offsetV: number;
  rotation: number;
}): THREE.CanvasTexture | null {
  const { source, labelAspect, zoom, offsetU, offsetV, rotation } = params;
  const srcW = (source as { width?: number }).width;
  const srcH = (source as { height?: number }).height;
  if (!srcW || !srcH) return null;
  if (!isFinite(labelAspect) || labelAspect <= 0) return null;

  // The crop that ends up on one half of the label has aspect
  // labelAspect / 2 — the other half is its mirror, and the two
  // concatenated produce the full label-aspect output. Zoom spans
  // (0, 5]: values < 1 pick a sub-region of the source (zoom in on
  // detail), values > 1 make the crop span multiple source tiles
  // (zoom out with repetition), so the user gets the "random chunk
  // of a big pattern" look of e.g. HP Hyper-Customisation rather than
  // always seeing the whole source shrunk to fit the label.
  const targetAspect = labelAspect / 2;
  const z = Math.max(0.02, Math.min(5, zoom));
  let cropUvW: number;
  let cropUvH: number;
  if (targetAspect >= 1) {
    cropUvW = z;
    cropUvH = z / targetAspect;
  } else {
    cropUvH = z;
    cropUvW = z * targetAspect;
  }

  const cropPxW = Math.max(1, Math.round(cropUvW * srcW));
  const cropPxH = Math.max(1, Math.round(cropUvH * srcH));
  // Offsets wrap — seeds ∈ ℝ map to any position in the infinitely
  // tiled source plane, so pan never runs out of room. Crop content
  // outside [0, 1] of the source pulls from the adjacent tile.
  const seedU = ((offsetU % 1) + 1) % 1;
  const seedV = ((offsetV % 1) + 1) % 1;
  const cropPxX = Math.round(seedU * srcW);
  const cropPxY = Math.round(seedV * srcH);

  const outW = cropPxW * 2;
  const outH = cropPxH;
  const canvas = document.createElement("canvas");
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  // To support rotation and wrapping without black corners, draw the
  // source in a 5×5 tile grid (centred on the crop origin). Any rotation
  // angle keeps the clipped crop rectangle fully inside drawn pixels.
  // 5× is overkill for small rotations but cheap and future-proof.
  const TILE_RADIUS = 2;
  const src = source as CanvasImageSource;

  const drawHalf = (mirrored: boolean) => {
    ctx.save();
    if (mirrored) {
      // Reflect about the right edge so the right half of the canvas
      // draws the same content as the left half, flipped.
      ctx.translate(outW, 0);
      ctx.scale(-1, 1);
    }
    // Clip to the "left half" rectangle in local coordinates; the
    // mirror above turns this into the right half in canvas coordinates.
    ctx.beginPath();
    ctx.rect(0, 0, cropPxW, cropPxH);
    ctx.clip();
    // Map crop centre (in source coords) to output centre, then rotate
    // around that centre. Each output pixel samples source at
    //   R⁻¹ * (out − outCentre) + cropOrigin + cropHalf.
    ctx.translate(cropPxW / 2, cropPxH / 2);
    ctx.rotate(rotation);
    ctx.translate(-cropPxX - cropPxW / 2, -cropPxY - cropPxH / 2);
    for (let i = -TILE_RADIUS; i <= TILE_RADIUS; i++) {
      for (let j = -TILE_RADIUS; j <= TILE_RADIUS; j++) {
        ctx.drawImage(src, i * srcW, j * srcH);
      }
    }
    ctx.restore();
  };

  drawHalf(false);
  drawHalf(true);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 16;
  // RepeatWrapping keeps sub-pixel sampling clean at the wrap seam; the
  // left and right edges of the canvas are identical (both show the
  // crop's left edge) so the wrap is invisible on the jar's back seam.
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
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
