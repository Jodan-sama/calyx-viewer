/**
 * Upload-time image compression helpers.
 *
 * Philosophy: never resample, never crop — the user's resolution is
 * sacred. We just re-encode to a more efficient container.
 *
 * WebP at quality 0.95 is visually indistinguishable from the source
 * PNG/JPEG but typically 30–50% smaller. Alpha channels are preserved
 * natively by every modern browser's `canvas.toBlob("image/webp", …)`
 * implementation. If the conversion doesn't produce a smaller file
 * (rare — happens with already-tiny PNGs), we return the original so
 * uploads never grow.
 */

/** Default WebP quality. 0.95 is "visually identical to source" in
 *  blind A/B tests but with the vast majority of the file-size win;
 *  pushing higher to 1.0 often doubles the size for no perceivable
 *  gain. */
export const DEFAULT_WEBP_QUALITY = 0.95;

/** Return a WebP File with identical pixel dimensions to the input —
 *  never downsized. The returned `File.name` has its extension rewritten
 *  to `.webp`. `lastModified` is carried over so it feels like the
 *  same file to the rest of the app.
 *
 *  Returns the original File untouched when:
 *    - The source is already WebP (nothing to gain).
 *    - We're not in a DOM environment.
 *    - `createImageBitmap` or `canvas.toBlob` fail (older browser,
 *      CORS-tainted source, etc.).
 *    - The re-encode produced a larger file than the source. */
export async function convertImageToWebP(
  file: File,
  quality: number = DEFAULT_WEBP_QUALITY
): Promise<File> {
  if (file.type === "image/webp") return file;
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

  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close();
    return file;
  }
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob((b) => resolve(b), "image/webp", quality);
  });
  if (!blob) return file;

  // Guard against the edge case where WebP actually makes the file
  // larger (tiny PNGs with flat colour already compress very well via
  // indexed palette; WebP doesn't always win on those). We keep the
  // smaller of the two so uploads never grow.
  if (blob.size >= file.size) return file;

  // Rewrite extension so Supabase Storage + downstream consumers see a
  // sensible filename. If the original had no extension we just append
  // `.webp` rather than leaving it bare.
  const base = file.name.replace(/\.(png|jpe?g|bmp|tiff?|webp)$/i, "");
  const newName = `${base}.webp`;

  return new File([blob], newName, {
    type: "image/webp",
    lastModified: file.lastModified,
  });
}

/** Convenience wrapper that logs the before/after sizes to the console
 *  so the developer can verify savings at a glance. Uses
 *  `console.info` with a uniform `[calyx:webp]` tag so the messages
 *  are easy to filter out in prod. Pass `label` to disambiguate when
 *  multiple uploads fire in sequence. */
export async function convertImageToWebPLogged(
  file: File,
  label: string,
  quality: number = DEFAULT_WEBP_QUALITY
): Promise<File> {
  const before = file.size;
  const out = await convertImageToWebP(file, quality);
  const after = out.size;
  if (out !== file) {
    const savedKB = ((before - after) / 1024).toFixed(1);
    const pct = ((1 - after / before) * 100).toFixed(0);
    // eslint-disable-next-line no-console
    console.info(
      `[calyx:webp] ${label}: ${(before / 1024).toFixed(1)}KB → ` +
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
