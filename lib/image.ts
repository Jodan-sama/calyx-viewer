/**
 * Upload-time image compression helpers.
 *
 * Re-encodes to WebP and caps the longest edge at a max dimension
 * (default 2048 px). The cap is important: uploaded artwork at 4 K+
 * source resolution burns ~60 MB of GPU texture memory each when
 * displayed in the client surface — multiplied across three hero
 * slots that's enough to crash iOS Safari even on the 17 Pro Max.
 * At 2048 px the display is still crisp at retina for any tile size
 * we render (client tiles cap ~800 px, fullscreen modal ~1200 px)
 * while texture memory drops by ~8×.
 *
 * WebP at quality 0.95 is visually indistinguishable from the source
 * PNG/JPEG but typically 30–50% smaller. Alpha channels are preserved
 * natively by every modern browser's `canvas.toBlob("image/webp", …)`
 * implementation. If the conversion produces a larger file than the
 * original (rare, e.g. small palette PNGs), we keep the original so
 * uploads never grow.
 */

/** Default WebP quality. 0.95 is "visually identical to source" in
 *  blind A/B tests but with the vast majority of the file-size win;
 *  pushing higher to 1.0 often doubles the size for no perceivable
 *  gain. */
export const DEFAULT_WEBP_QUALITY = 0.95;

/** Default longest-edge cap applied to uploads. Tuned to match
 *  `MAX_LABEL_TEXTURE_DIMENSION` in BagMesh / SupplementJarMesh —
 *  going higher just bloats Supabase storage + bandwidth for no
 *  display benefit, and the runtime downsampler would shrink it to
 *  this size anyway on every page view. */
export const DEFAULT_UPLOAD_MAX_DIMENSION = 2048;

/** Return a WebP File sized so its longest edge is at most
 *  `maxDimension` pixels. Aspect ratio is preserved; images already
 *  smaller than the cap pass through at original dimensions. The
 *  returned `File.name` has its extension rewritten to `.webp` and
 *  `lastModified` is carried over so it feels like the same file.
 *
 *  Returns the original File untouched when:
 *    - The source is already WebP AND already within the size cap.
 *    - We're not in a DOM environment.
 *    - `createImageBitmap` or `canvas.toBlob` fail (older browser,
 *      CORS-tainted source, etc.).
 *    - The re-encode produced a larger file than the source AND no
 *      resize was needed (resizing alone is always a net win). */
export async function convertImageToWebP(
  file: File,
  quality: number = DEFAULT_WEBP_QUALITY,
  maxDimension: number = DEFAULT_UPLOAD_MAX_DIMENSION
): Promise<File> {
  if (typeof document === "undefined") return file;

  // ImageBitmap decode preserves full bit-depth and — importantly —
  // the alpha channel without the pre-multiply that <img> elements
  // sometimes apply. `premultiplyAlpha: "none"` keeps the RGB values
  // untouched wherever alpha < 1, so a PNG with soft edges round-trips
  // through the encoder without haloing.
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { premultiplyAlpha: "none" });
  } catch {
    return file;
  }

  const srcW = bitmap.width;
  const srcH = bitmap.height;
  const longest = Math.max(srcW, srcH);
  const needsResize = longest > maxDimension;

  // Short-circuit: if the file is already WebP AND within the size
  // cap, there's nothing to do — re-encoding would either be a no-op
  // or produce a slightly larger file thanks to encoder jitter.
  if (file.type === "image/webp" && !needsResize) {
    bitmap.close();
    return file;
  }

  let targetW = srcW;
  let targetH = srcH;
  if (needsResize) {
    const scale = maxDimension / longest;
    targetW = Math.max(1, Math.round(srcW * scale));
    targetH = Math.max(1, Math.round(srcH * scale));
  }

  const canvas = document.createElement("canvas");
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close();
    return file;
  }
  // drawImage scales during the blit — one pass, no intermediate
  // buffer. Browsers use a decent bilinear filter here; for display
  // at tile size the result is indistinguishable from offline tools.
  ctx.drawImage(bitmap, 0, 0, targetW, targetH);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob((b) => resolve(b), "image/webp", quality);
  });
  if (!blob) return file;

  // If we resized, we always return the WebP — even if it somehow
  // ended up larger than the original (it won't, at these sizes),
  // the GPU benefit is the point. If we DIDN'T resize, fall back to
  // the original when WebP doesn't win on size (tiny palette PNGs).
  if (!needsResize && blob.size >= file.size) return file;

  const base = file.name.replace(/\.(png|jpe?g|bmp|tiff?|webp)$/i, "");
  const newName = `${base}.webp`;

  const result = new File([blob], newName, {
    type: "image/webp",
    lastModified: file.lastModified,
  });
  // Stash source + target dims on the result for the logged wrapper.
  // We can't add real properties to a File, but we can encode them
  // in a symbol-keyed WeakMap keyed on the result reference.
  DIMS.set(result, { srcW, srcH, targetW, targetH });
  return result;
}

/** Attached dimensions for the most recent conversion result. The
 *  logged wrapper reads this to print source → target sizes in the
 *  console info line. */
const DIMS = new WeakMap<File, { srcW: number; srcH: number; targetW: number; targetH: number }>();

/** Convenience wrapper that logs the before/after sizes to the console
 *  so the developer can verify savings at a glance. Uses
 *  `console.info` with a uniform `[calyx:webp]` tag so the messages
 *  are easy to filter out in prod. Pass `label` to disambiguate when
 *  multiple uploads fire in sequence. */
export async function convertImageToWebPLogged(
  file: File,
  label: string,
  quality: number = DEFAULT_WEBP_QUALITY,
  maxDimension: number = DEFAULT_UPLOAD_MAX_DIMENSION
): Promise<File> {
  const before = file.size;
  const out = await convertImageToWebP(file, quality, maxDimension);
  const after = out.size;
  if (out !== file) {
    const savedKB = ((before - after) / 1024).toFixed(1);
    const pct = ((1 - after / before) * 100).toFixed(0);
    const dims = DIMS.get(out);
    const dimPart = dims
      ? ` ${dims.srcW}×${dims.srcH} → ${dims.targetW}×${dims.targetH}`
      : "";
    // eslint-disable-next-line no-console
    console.info(
      `[calyx:webp] ${label}:${dimPart} ${(before / 1024).toFixed(1)}KB → ` +
        `${(after / 1024).toFixed(1)}KB (saved ${savedKB}KB, ${pct}%)`
    );
  } else if (file.type !== "image/webp") {
    // eslint-disable-next-line no-console
    console.info(
      `[calyx:webp] ${label}: kept original ${(before / 1024).toFixed(1)}KB ` +
        `(WebP didn't reduce size)`
    );
  }
  return out;
}
