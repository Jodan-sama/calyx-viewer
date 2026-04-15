"use client";

import Image from "next/image";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useState, useCallback, useRef } from "react";
import SaveToOutreachDialog, {
  type SaveSource,
} from "@/components/SaveToOutreachDialog";
import ImagePreviewModal from "@/components/ImagePreviewModal";
import {
  DEFAULT_BACK_TEXTURE,
  DEFAULT_FRONT_TEXTURE,
  DEFAULT_MATERIAL,
  type BagMaterial,
} from "@/lib/bagMaterial";

const BagViewer = dynamic(() => import("@/components/BagViewer"), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center w-full h-full bg-[#f0f2f7]">
      <div className="text-center space-y-3">
        <div className="w-9 h-9 border-2 border-[#0033A1] border-t-transparent rounded-full animate-spin mx-auto" />
        <p className="text-[#272724]/40 text-sm font-light">Loading viewer…</p>
      </div>
    </div>
  ),
});

const GEMINI_MODEL = "gemini-3.1-flash-image-preview"; // Nano Banana 2
const GEMINI_PROMPT = "Make a hyper realistic professional product photography shot of this packaging";

export default function CalyxPreview() {
  // Front artwork — defaults to the branded front asset, overridden by upload.
  const [frontTextureUrl, setFrontTextureUrl] = useState<string>(
    DEFAULT_FRONT_TEXTURE
  );
  const [frontFile, setFrontFile] = useState<File | null>(null);
  const [frontFileName, setFrontFileName] = useState<string | null>(null);

  // Back artwork — defaults to the branded back asset, overridden by upload.
  const [backTextureUrl, setBackTextureUrl] = useState<string>(
    DEFAULT_BACK_TEXTURE
  );
  const [backFileName, setBackFileName] = useState<string | null>(null);

  const [screenshotUrl, setScreenshotUrl] = useState<string | null>(null);
  const [magicImageUrl, setMagicImageUrl] = useState<string | null>(null);
  const [isMakingMagic, setIsMakingMagic] = useState(false);
  const [magicError, setMagicError] = useState<string | null>(null);
  const [saveSource, setSaveSource] = useState<SaveSource | null>(null);
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);
  const captureRef = useRef<(() => void) | null>(null);
  // Live material config — kept up to date by BagViewer's Leva controls
  const materialRef = useRef<BagMaterial>(DEFAULT_MATERIAL);
  const handleMaterialChange = useCallback((m: BagMaterial) => {
    materialRef.current = m;
  }, []);

  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_AI_API_KEY ?? "";

  // Shared helper: swap a blob-URL slot, revoking the previous URL if one was
  // created via URL.createObjectURL. Defaults (which are plain /images/…) are
  // left alone on revoke.
  const swapBlobUrl = useCallback(
    (prev: string, next: string) => {
      if (prev.startsWith("blob:")) URL.revokeObjectURL(prev);
      return next;
    },
    []
  );

  const handleFrontUpload = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      setFrontTextureUrl((prev) => swapBlobUrl(prev, URL.createObjectURL(file)));
      setFrontFile(file);
      setFrontFileName(file.name);
      setMagicImageUrl(null);
      setMagicError(null);
    },
    [swapBlobUrl]
  );

  const handleBackUpload = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      setBackTextureUrl((prev) => swapBlobUrl(prev, URL.createObjectURL(file)));
      setBackFileName(file.name);
      setMagicImageUrl(null);
      setMagicError(null);
    },
    [swapBlobUrl]
  );

  const handleUpdate = useCallback(() => {
    captureRef.current?.();
  }, []);

  const handleMakeMagic = useCallback(async () => {
    if (!screenshotUrl || !apiKey) return;
    setIsMakingMagic(true);
    setMagicError(null);
    setMagicImageUrl(null);

    try {
      // Strip data URL prefix — send raw base64 to the API
      const [header, base64Data] = screenshotUrl.split(",");
      const mimeType = header.match(/:(.*?);/)?.[1] ?? "image/png";

      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [
              {
                parts: [
                  { text: GEMINI_PROMPT },
                  { inline_data: { mime_type: mimeType, data: base64Data } },
                ],
              },
            ],
            generationConfig: {
              responseModalities: ["IMAGE", "TEXT"],
            },
          }),
        }
      );

      const data = await res.json();
      console.log("[Make Magic] API response:", JSON.stringify(data).slice(0, 500));

      if (!res.ok) {
        throw new Error(data?.error?.message ?? `HTTP ${res.status}`);
      }

      const parts: { text?: string; inlineData?: { mimeType: string; data: string }; inline_data?: { mime_type: string; data: string } }[] =
        data?.candidates?.[0]?.content?.parts ?? [];

      const imgPart = parts.find((p) => p.inlineData?.data || p.inline_data?.data);

      if (imgPart) {
        // API returns camelCase inlineData/mimeType
        const img = imgPart.inlineData ?? imgPart.inline_data!;
        const mimeOut = (img as { mimeType?: string; mime_type?: string }).mimeType
          ?? (img as { mimeType?: string; mime_type?: string }).mime_type
          ?? "image/jpeg";
        setMagicImageUrl(`data:${mimeOut};base64,${img.data}`);
      } else {
        const textPart = parts.find((p) => p.text);
        throw new Error(textPart?.text ?? "No image in response");
      }
    } catch (err: unknown) {
      setMagicError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setIsMakingMagic(false);
    }
  }, [screenshotUrl, apiKey]);

  return (
    <div className="relative w-full h-screen flex flex-col bg-white">

      {/* ── Header ── */}
      <header className="flex-shrink-0 flex items-center justify-between px-6 h-[58px] bg-white border-b border-[#e8ecf2] z-20">
        <Link href="/" className="flex items-center gap-3 group">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="text-[#272724]/50 group-hover:text-[#0033A1] transition-colors">
            <path d="M9 2L4 7l5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          <Image
            src="/calyx-logo.svg"
            alt="Calyx Containers"
            width={140}
            height={37}
            priority
            style={{ height: 37, width: "auto" }}
          />
        </Link>
        <span className="text-[#272724]/40 text-[11px] font-medium tracking-[0.2em] uppercase hidden sm:block select-none">
          Calyx Preview
        </span>
        <div className="w-[140px]" />
      </header>

      {/* ── Body ── */}
      <div className="flex flex-1 min-h-0">

        {/* Left panel */}
        <aside className="flex-shrink-0 w-[200px] bg-white border-r border-[#e8ecf2] flex flex-col items-center pt-5 pb-6 gap-4 z-10 overflow-y-auto">

          {/* Upload Bag Front */}
          <label
            className="cursor-pointer w-[160px] flex items-center justify-center gap-2 px-4 py-2.5 rounded-full text-white text-[11px] font-semibold uppercase tracking-[0.08em] transition-all active:scale-95 select-none"
            style={{ background: "#0033A1" }}
            onMouseEnter={e => (e.currentTarget.style.background = "#001F60")}
            onMouseLeave={e => (e.currentTarget.style.background = "#0033A1")}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M6 1v6.5M3.5 3.5L6 1l2.5 2.5M1 8.5v1.5a1 1 0 001 1h8a1 1 0 001-1V8.5"
                stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            Upload Bag Front
            <input type="file" accept="image/*" className="hidden" onChange={handleFrontUpload} />
          </label>

          {frontFileName && (
            <p className="text-[9px] text-[#272724]/40 text-center px-2 leading-tight break-all select-none">
              {frontFileName.length > 22 ? frontFileName.slice(0, 20) + "…" : frontFileName}
            </p>
          )}

          {/* Upload Bag Back */}
          <label
            className="cursor-pointer w-[160px] flex items-center justify-center gap-2 px-4 py-2.5 rounded-full text-white text-[11px] font-semibold uppercase tracking-[0.08em] transition-all active:scale-95 select-none"
            style={{ background: "#272724" }}
            onMouseEnter={e => (e.currentTarget.style.background = "#0033A1")}
            onMouseLeave={e => (e.currentTarget.style.background = "#272724")}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M6 1v6.5M3.5 3.5L6 1l2.5 2.5M1 8.5v1.5a1 1 0 001 1h8a1 1 0 001-1V8.5"
                stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            Upload Bag Back
            <input type="file" accept="image/*" className="hidden" onChange={handleBackUpload} />
          </label>

          {backFileName && (
            <p className="text-[9px] text-[#272724]/40 text-center px-2 leading-tight break-all select-none">
              {backFileName.length > 22 ? backFileName.slice(0, 20) + "…" : backFileName}
            </p>
          )}

          <div className="w-[140px] h-px bg-[#e8ecf2]" />

          <p className="text-[9px] font-medium tracking-[0.14em] uppercase text-[#272724]/30 select-none">
            Label Preview
          </p>

          {/* Preview image with Update overlay */}
          {screenshotUrl ? (
            <div
              className="relative w-[160px] rounded-lg overflow-hidden border border-[#e8ecf2] shadow-sm group cursor-pointer"
              onClick={handleUpdate}
              title="Click to update"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={screenshotUrl} alt="Label preview" className="w-full h-auto block" />
              <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                <span className="text-white text-[10px] font-semibold uppercase tracking-[0.18em]">Update</span>
              </div>
            </div>
          ) : (
            <div className="w-[160px] h-[120px] rounded-lg border border-dashed border-[#d0d8ef] flex items-center justify-center">
              <p className="text-[9px] text-[#272724]/25 text-center px-3 leading-relaxed select-none">
                Preview renders<br/>after load…
              </p>
            </div>
          )}

          {/* Make Magic button */}
          {screenshotUrl && (
            <button
              onClick={handleMakeMagic}
              disabled={isMakingMagic}
              className="w-[160px] h-7 rounded-full text-[10px] font-semibold uppercase tracking-[0.12em] transition-all active:scale-95 select-none disabled:opacity-50 disabled:cursor-not-allowed text-white"
              style={{ background: "linear-gradient(135deg, #7c3aed, #db2777)" }}
            >
              {isMakingMagic ? "Generating…" : "✦ Make Magic"}
            </button>
          )}

          {/* Save label as 3D bag — always visible, disabled until a front upload */}
          <button
            onClick={() =>
              frontFile &&
              setSaveSource({
                kind: "bag-3d",
                file: frontFile,
                material: materialRef.current,
              })
            }
            disabled={!frontFile}
            title={
              frontFile
                ? "Save this label as a 3D bag slot on Outreach"
                : "Upload a bag front first"
            }
            className="w-[160px] h-7 rounded-full text-[10px] font-semibold uppercase tracking-[0.12em] transition-all active:scale-95 select-none text-white bg-[#272724] hover:bg-[#0033A1] disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-[#272724]"
          >
            Save to Outreach
          </button>

          {/* Error */}
          {magicError && (
            <p className="text-[9px] text-red-400 text-center px-2 leading-tight break-all">
              {magicError}
            </p>
          )}

          {/* Loading spinner */}
          {isMakingMagic && (
            <div className="w-9 h-9 border-2 border-purple-400 border-t-transparent rounded-full animate-spin" />
          )}

          {/* AI result */}
          {magicImageUrl && (
            <>
              <div className="w-[140px] h-px bg-[#e8ecf2]" />
              <a
                href={magicImageUrl}
                download="calyx-magic.jpg"
                className="relative w-[160px] rounded-lg overflow-hidden border border-[#e8ecf2] shadow-sm group block cursor-pointer"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={magicImageUrl} alt="AI generated product shot" className="w-full h-auto block" />
                <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                  <span className="text-white text-[10px] font-semibold uppercase tracking-[0.18em]">Download</span>
                </div>
              </a>

              {/* Preview — open larger */}
              <button
                onClick={() => setPreviewSrc(magicImageUrl)}
                className="w-[160px] h-7 rounded-full text-[10px] font-semibold uppercase tracking-[0.12em] transition-all active:scale-95 select-none text-[#272724] bg-white border border-[#e8ecf2] hover:border-[#0033A1]/40 hover:text-[#0033A1]"
              >
                Preview
              </button>

              {/* Save magic image to Outreach */}
              <button
                onClick={async () => {
                  const res = await fetch(magicImageUrl);
                  const blob = await res.blob();
                  const ext = (blob.type.split("/")[1] ?? "jpg").replace(
                    "jpeg",
                    "jpg"
                  );
                  setSaveSource({
                    kind: "flat-image",
                    blob,
                    filename: `magic-${Date.now()}.${ext}`,
                  });
                }}
                className="w-[160px] h-7 rounded-full text-[10px] font-semibold uppercase tracking-[0.12em] transition-all active:scale-95 select-none text-white"
                style={{
                  background:
                    "linear-gradient(135deg, #7c3aed, #db2777)",
                }}
              >
                ✦ Save to Outreach
              </button>
            </>
          )}
        </aside>

        {/* 3D Canvas */}
        <div className="flex-1 min-w-0 h-full">
          <BagViewer
            textureUrl={frontTextureUrl}
            backTextureUrl={backTextureUrl}
            onScreenshot={setScreenshotUrl}
            captureRef={captureRef}
            onMaterialChange={handleMaterialChange}
          />
        </div>
      </div>

      {/* Bottom hint */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 text-[10px] font-light tracking-[0.18em] uppercase pointer-events-none select-none text-[#272724]/25">
        Drag to rotate · Scroll to zoom
      </div>

      {saveSource && (
        <SaveToOutreachDialog
          source={saveSource}
          onClose={() => setSaveSource(null)}
        />
      )}

      {previewSrc && (
        <ImagePreviewModal
          src={previewSrc}
          alt="Magic preview"
          onClose={() => setPreviewSrc(null)}
        />
      )}
    </div>
  );
}
