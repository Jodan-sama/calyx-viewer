"use client";

import Image from "next/image";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useState, useCallback, useRef, useEffect } from "react";
import { Leva, LevaPanel, useCreateStore } from "leva";
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
import { getSetById } from "@/lib/brands";
import { convertImageToWebPLogged } from "@/lib/image";
import RectLightMap from "@/components/RectLightMap";
import type { SceneEnvironment } from "@/lib/types";

// Shared theme for the docked Leva panel — matches the rest of the UI chrome.
const LEVA_THEME = {
  colors: {
    highlight1: "#0033A1",
    highlight2: "#001F60",
    accent1: "#0033A1",
    accent2: "#001F60",
    accent3: "#3d5fcf",
    elevation1: "#f5f7ff",
    elevation2: "#eef1fb",
    elevation3: "#DBE6FF",
    folderWidgetColor: "#0033A1",
    folderTextColor: "#272724",
    toolTipBackground: "#272724",
    toolTipText: "#ffffff",
  },
  radii: { xs: "3px", sm: "6px", lg: "8px" },
  fontSizes: { root: "11px" },
  sizes: { rootWidth: "100%" },
  fonts: { mono: "Poppins, sans-serif", sans: "Poppins, sans-serif" },
};

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
  const [backFile, setBackFile] = useState<File | null>(null);
  const [backFileName, setBackFileName] = useState<string | null>(null);

  // Bag-only Layer 3 artwork — stacks on top of Layer 2 (the existing
  // front/back decals). Starts empty; appears only when the user uploads.
  const [layer3FrontTextureUrl, setLayer3FrontTextureUrl] = useState<string | null>(null);
  const [layer3FrontFile, setLayer3FrontFile] = useState<File | null>(null);
  const [layer3FrontFileName, setLayer3FrontFileName] = useState<string | null>(null);
  const [layer3BackTextureUrl, setLayer3BackTextureUrl] = useState<string | null>(null);
  const [layer3BackFile, setLayer3BackFile] = useState<File | null>(null);
  const [layer3BackFileName, setLayer3BackFileName] = useState<string | null>(null);

  // Active model — driven by BagViewer's Leva dropdown, surfaced here so the
  // upload buttons can re-label themselves (Bag Front/Back → Layer 2/3 Art).
  const [currentModel, setCurrentModel] = useState<"bag" | "jar">("bag");

  // Two independent Leva stores — one for the Material controls, one for the
  // Lighting controls. Each backs its own right-side sidebar panel so the
  // user can collapse them independently. BagViewer receives both stores
  // and binds useControls calls to each, routing material-ish knobs to
  // matStore and lighting/scene knobs to lightStore.
  const matStore = useCreateStore();
  const lightStore = useCreateStore();

  // Lighting action handlers — populated by BagViewer every render
  // so the Save / Reset buttons rendered below the Lighting Leva
  // panel always call into the latest-state versions. Rendering the
  // buttons here (instead of as Leva button entries) keeps them
  // visually below every conditionally-rendered rect-light slider,
  // which Leva's own layout can't guarantee.
  const lightingOpsRef = useRef<{
    save: () => void;
    reset: () => void;
  } | null>(null);

  // Collapse state for each sidebar. Defaults to both open so the Leva
  // panels are visible on first load. Persisted to localStorage so the
  // layout survives reloads.
  const [matOpen, setMatOpen] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    const v = window.localStorage.getItem("calyx:sidebar:materials");
    return v === null ? true : v === "1";
  });
  const [lightOpen, setLightOpen] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    const v = window.localStorage.getItem("calyx:sidebar:lighting");
    return v === null ? true : v === "1";
  });
  useEffect(() => {
    window.localStorage.setItem(
      "calyx:sidebar:materials",
      matOpen ? "1" : "0"
    );
  }, [matOpen]);
  useEffect(() => {
    window.localStorage.setItem(
      "calyx:sidebar:lighting",
      lightOpen ? "1" : "0"
    );
  }, [lightOpen]);

  // Active environment — tracked so saves capture the scene layout at save time.
  const [currentEnvironment, setCurrentEnvironment] = useState<"default" | "smoke" | "dim">("default");

  // ── Hydration from a saved Outreach slot (`?open=<set-id>`) ───────────────
  // When the user clicks "Open in Preview" on an Outreach hero slot we
  // re-enter this page with the set id in the URL. We fetch the set,
  // seed texture URLs + material + environment + model state, then mount
  // BagViewer with those values baked into Leva's defaults.
  //
  // Leva only reads `value` at first mount, so we bump `hydrationKey`
  // when the fetch completes — that forces BagViewer to remount with
  // the new initial values. `hydrating` guards the viewer so it doesn't
  // flash with defaults before the server data arrives.
  // Pessimistic on SSR: we can't check `?open=` without window, and a
  // false-then-true flip would let BagViewer mount with defaults first —
  // polluting the shared Leva stores (matStore/lightStore) before
  // hydrated initialMaterial/initialModel arrive. Starting `true` delays
  // BagViewer mount by one effect tick for all page loads; the effect
  // below clears it immediately when there's no open param.
  const [hydrating, setHydrating] = useState<boolean>(true);
  const [hydrationKey, setHydrationKey] = useState(0);
  const [initialMaterial, setInitialMaterial] = useState<BagMaterial | undefined>(undefined);
  const [initialEnvironment, setInitialEnvironment] = useState<SceneEnvironment | undefined>(undefined);
  const [initialModel, setInitialModel] = useState<"bag" | "jar" | undefined>(undefined);

  const [screenshotUrl, setScreenshotUrl] = useState<string | null>(null);
  const [magicImageUrl, setMagicImageUrl] = useState<string | null>(null);
  const [isMakingMagic, setIsMakingMagic] = useState(false);
  const [magicError, setMagicError] = useState<string | null>(null);
  const [saveSource, setSaveSource] = useState<SaveSource | null>(null);
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);
  const captureRef = useRef<(() => string | null) | null>(null);
  // Live material config — kept up to date by BagViewer's Leva controls
  const materialRef = useRef<BagMaterial>(DEFAULT_MATERIAL);
  const handleMaterialChange = useCallback((m: BagMaterial) => {
    materialRef.current = m;
  }, []);

  // Read `?open=<set-id>` once on mount and hydrate state from the saved
  // slot. Everything here is optional — if the param isn't present, the
  // page boots with the hard-coded defaults, same as before. `cancelled`
  // guards against the tab closing mid-fetch.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const openId = params.get("open");
    if (!openId) {
      setHydrating(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const set = await getSetById(openId);
        if (cancelled || !set) {
          setHydrating(false);
          return;
        }
        // Seed every artwork URL that was saved so the studio rehydrates
        // the full decal stack — front, back, and bag Layer 3 front/back.
        // The three secondary URLs live on `set.material.*ImageUrl`
        // (saveSet stashes them there to avoid a schema migration).
        setFrontTextureUrl(set.label_image_url);
        setFrontFileName(set.title);

        // Fetch each saved URL into a File so the Save button stays
        // enabled on reopen without requiring the user to re-upload.
        // Runs in parallel and tolerates individual failures so one
        // bad URL doesn't prevent the others from rehydrating.
        const fetchFile = async (
          url: string,
          fallbackName: string
        ): Promise<File | null> => {
          try {
            const res = await fetch(url);
            const blob = await res.blob();
            return new File([blob], fallbackName, {
              type: blob.type || "image/png",
            });
          } catch {
            return null;
          }
        };
        const [
          frontFileResult,
          backFileResult,
          l3FrontFileResult,
          l3BackFileResult,
        ] = await Promise.all([
          fetchFile(set.label_image_url, set.title || "artwork.png"),
          set.material?.backImageUrl
            ? fetchFile(set.material.backImageUrl, "back.png")
            : Promise.resolve(null),
          set.material?.layer3FrontImageUrl
            ? fetchFile(set.material.layer3FrontImageUrl, "layer3-front.png")
            : Promise.resolve(null),
          set.material?.layer3BackImageUrl
            ? fetchFile(set.material.layer3BackImageUrl, "layer3-back.png")
            : Promise.resolve(null),
        ]);
        if (cancelled) return;
        if (frontFileResult) setFrontFile(frontFileResult);

        if (set.material?.backImageUrl) {
          setBackTextureUrl(set.material.backImageUrl);
          setBackFileName("back.png");
          if (backFileResult) setBackFile(backFileResult);
        }
        if (set.material?.layer3FrontImageUrl) {
          setLayer3FrontTextureUrl(set.material.layer3FrontImageUrl);
          setLayer3FrontFileName("layer3-front.png");
          if (l3FrontFileResult) setLayer3FrontFile(l3FrontFileResult);
        }
        if (set.material?.layer3BackImageUrl) {
          setLayer3BackTextureUrl(set.material.layer3BackImageUrl);
          setLayer3BackFileName("layer3-back.png");
          if (l3BackFileResult) setLayer3BackFile(l3BackFileResult);
        }

        // Push resolved state into Leva defaults via BagViewer props, then
        // bump the key so the viewer remounts and Leva picks them up.
        setInitialMaterial(set.material ?? undefined);
        setInitialEnvironment(set.environment ?? "default");
        setInitialModel(
          set.product_type === "supplement-jar" ? "jar" : "bag"
        );
        setCurrentModel(
          set.product_type === "supplement-jar" ? "jar" : "bag"
        );
        setCurrentEnvironment(set.environment ?? "default");
        setHydrationKey((k) => k + 1);
        setHydrating(false);
      } catch {
        if (!cancelled) setHydrating(false);
      }
    })();
    return () => {
      cancelled = true;
    };
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

  // Every upload handler runs the picked file through
  // `convertImageToWebPLogged` before it hits state. Resolution is
  // preserved exactly; only the container changes (PNG/JPEG → WebP at
  // quality 0.95, which is visually identical but typically 30–50%
  // smaller). The File we store in state is the converted one, so
  // everything downstream — the blob URL handed to three.js, the
  // `frontFile` used by Save-to-Outreach, the Supabase upload — sees
  // WebP bytes without any further wiring.
  const handleFrontUpload = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const raw = e.target.files?.[0];
      if (!raw) return;
      const file = await convertImageToWebPLogged(raw, "front");
      setFrontTextureUrl((prev) => swapBlobUrl(prev, URL.createObjectURL(file)));
      setFrontFile(file);
      setFrontFileName(file.name);
      setMagicImageUrl(null);
      setMagicError(null);
    },
    [swapBlobUrl]
  );

  const handleBackUpload = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const raw = e.target.files?.[0];
      if (!raw) return;
      const file = await convertImageToWebPLogged(raw, "back");
      setBackTextureUrl((prev) => swapBlobUrl(prev, URL.createObjectURL(file)));
      setBackFile(file);
      setBackFileName(file.name);
      setMagicImageUrl(null);
      setMagicError(null);
    },
    [swapBlobUrl]
  );

  // Layer 3 uploaders — only shown in bag mode. Start null so the mesh
  // skips the Layer 3 decals until a texture is provided.
  const handleLayer3FrontUpload = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const raw = e.target.files?.[0];
      if (!raw) return;
      const file = await convertImageToWebPLogged(raw, "layer3-front");
      setLayer3FrontTextureUrl((prev) => {
        if (prev?.startsWith("blob:")) URL.revokeObjectURL(prev);
        return URL.createObjectURL(file);
      });
      setLayer3FrontFile(file);
      setLayer3FrontFileName(file.name);
    },
    []
  );

  const handleLayer3BackUpload = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const raw = e.target.files?.[0];
      if (!raw) return;
      const file = await convertImageToWebPLogged(raw, "layer3-back");
      setLayer3BackTextureUrl((prev) => {
        if (prev?.startsWith("blob:")) URL.revokeObjectURL(prev);
        return URL.createObjectURL(file);
      });
      setLayer3BackFile(file);
      setLayer3BackFileName(file.name);
    },
    []
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
      {/* Hidden Leva root suppresses the auto-floating panel Leva
          otherwise mounts to <body> when it sees no explicit <Leva />
          in the tree. Our visible UI uses two dedicated <LevaPanel>s
          bound to matStore/lightStore, so the default panel would
          just be noise. */}
      <Leva hidden />

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

          {/* Upload — slot A. In bag mode this is Layer 2 (front panel); in
              jar mode it's Layer 2 artwork wrapped around the cylinder. */}
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
            {currentModel === "jar" ? "Layer 2 Art" : "Layer 2 Front"}
            <input type="file" accept="image/*" className="hidden" onChange={handleFrontUpload} />
          </label>

          {frontFileName && (
            <p className="text-[9px] text-[#272724]/40 text-center px-2 leading-tight break-all select-none">
              {frontFileName.length > 22 ? frontFileName.slice(0, 20) + "…" : frontFileName}
            </p>
          )}

          {/* Upload — slot B. In bag mode this is Layer 2 (back panel); in
              jar mode it's Layer 3 artwork around the cylinder. */}
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
            {currentModel === "jar" ? "Layer 3 Art" : "Layer 2 Back"}
            <input type="file" accept="image/*" className="hidden" onChange={handleBackUpload} />
          </label>

          {backFileName && (
            <p className="text-[9px] text-[#272724]/40 text-center px-2 leading-tight break-all select-none">
              {backFileName.length > 22 ? backFileName.slice(0, 20) + "…" : backFileName}
            </p>
          )}

          {/* Bag-only Layer 3 upload slots — a second artwork layer that
              stacks on top of Layer 2. Hidden in jar mode because the jar
              already maps its Layer 3 to the second upload slot above. */}
          {currentModel === "bag" && (
            <>
              <label
                className="cursor-pointer w-[160px] flex items-center justify-center gap-2 px-4 py-2.5 rounded-full text-white text-[11px] font-semibold uppercase tracking-[0.08em] transition-all active:scale-95 select-none"
                style={{ background: "#4a4a48" }}
                onMouseEnter={e => (e.currentTarget.style.background = "#0033A1")}
                onMouseLeave={e => (e.currentTarget.style.background = "#4a4a48")}
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <path d="M6 1v6.5M3.5 3.5L6 1l2.5 2.5M1 8.5v1.5a1 1 0 001 1h8a1 1 0 001-1V8.5"
                    stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                Layer 3 Front
                <input type="file" accept="image/*" className="hidden" onChange={handleLayer3FrontUpload} />
              </label>

              {layer3FrontFileName && (
                <p className="text-[9px] text-[#272724]/40 text-center px-2 leading-tight break-all select-none">
                  {layer3FrontFileName.length > 22 ? layer3FrontFileName.slice(0, 20) + "…" : layer3FrontFileName}
                </p>
              )}

              <label
                className="cursor-pointer w-[160px] flex items-center justify-center gap-2 px-4 py-2.5 rounded-full text-white text-[11px] font-semibold uppercase tracking-[0.08em] transition-all active:scale-95 select-none"
                style={{ background: "#4a4a48" }}
                onMouseEnter={e => (e.currentTarget.style.background = "#0033A1")}
                onMouseLeave={e => (e.currentTarget.style.background = "#4a4a48")}
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <path d="M6 1v6.5M3.5 3.5L6 1l2.5 2.5M1 8.5v1.5a1 1 0 001 1h8a1 1 0 001-1V8.5"
                    stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                Layer 3 Back
                <input type="file" accept="image/*" className="hidden" onChange={handleLayer3BackUpload} />
              </label>

              {layer3BackFileName && (
                <p className="text-[9px] text-[#272724]/40 text-center px-2 leading-tight break-all select-none">
                  {layer3BackFileName.length > 22 ? layer3BackFileName.slice(0, 20) + "…" : layer3BackFileName}
                </p>
              )}
            </>
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
            onClick={() => {
              if (!frontFile) return;
              // Trigger a fresh canvas capture so the thumbnail reflects
              // the latest Leva changes, not a stale auto-capture from
              // the initial mount. The capture function returns the
              // data URL synchronously (setState hasn't flushed yet),
              // so we prefer that over `screenshotUrl` which might
              // still hold an older frame.
              const fresh = captureRef.current?.() ?? null;
              setSaveSource({
                kind: "bag-3d",
                file: frontFile,
                // Secondary artwork layers — uploaded alongside the primary
                // front image so every decal the user configured round-trips
                // through the outreach slot. Bag can use all three; jar only
                // reads `backFile` (which becomes its Layer 3 texture).
                backFile,
                layer3FrontFile,
                layer3BackFile,
                material: materialRef.current,
                productType:
                  currentModel === "jar" ? "supplement-jar" : "mylar-bag",
                environment: currentEnvironment,
                // Pass the rendered screenshot so the save dialog can
                // stash a downscaled thumbnail alongside the slot. The
                // dialog is tolerant of undefined here (skips preview
                // upload gracefully).
                previewDataUrl: fresh ?? screenshotUrl ?? undefined,
              });
            }}
            disabled={!frontFile}
            title={
              frontFile
                ? currentModel === "jar"
                  ? "Save this label as a 3D jar slot on Outreach"
                  : "Save this label as a 3D bag slot on Outreach"
                : currentModel === "jar"
                  ? "Upload Layer 2 art first"
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
                  const rawBlob = await res.blob();
                  // Route the Magic image through the same WebP encoder
                  // the uploads use so Supabase only ever stores the
                  // smaller format. Gemini returns JPEG; converting at
                  // quality 0.95 is visually indistinguishable and
                  // usually trims another ~25–40% off the file size.
                  const rawFile = new File([rawBlob], `magic.${(rawBlob.type.split("/")[1] ?? "jpg").replace("jpeg", "jpg")}`, {
                    type: rawBlob.type || "image/jpeg",
                  });
                  const converted = await convertImageToWebPLogged(rawFile, "magic");
                  const ext = converted.type === "image/webp"
                    ? "webp"
                    : (converted.type.split("/")[1] ?? "jpg").replace("jpeg", "jpg");
                  setSaveSource({
                    kind: "flat-image",
                    blob: converted,
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
        <div className="flex-1 min-w-0 h-full relative">
          {hydrating ? (
            <div className="flex items-center justify-center w-full h-full bg-[#f0f2f7]">
              <div className="text-center space-y-3">
                <div className="w-9 h-9 border-2 border-[#0033A1] border-t-transparent rounded-full animate-spin mx-auto" />
                <p className="text-[#272724]/40 text-sm font-light">Loading saved slot…</p>
              </div>
            </div>
          ) : (
            <BagViewer
              // Remount whenever hydration fires so Leva picks up the
              // freshly-seeded initial values. For the default path
              // (hydrationKey stays 0) this is a stable key and behaves
              // exactly like before.
              key={hydrationKey}
              textureUrl={frontTextureUrl}
              backTextureUrl={backTextureUrl}
              layer3FrontTextureUrl={layer3FrontTextureUrl}
              layer3BackTextureUrl={layer3BackTextureUrl}
              onScreenshot={setScreenshotUrl}
              captureRef={captureRef}
              onMaterialChange={handleMaterialChange}
              onModelChange={setCurrentModel}
              onEnvironmentChange={setCurrentEnvironment}
              initialMaterial={initialMaterial}
              initialEnvironment={initialEnvironment}
              initialModel={initialModel}
              matStore={matStore}
              lightStore={lightStore}
              lightingOpsRef={lightingOpsRef}
            />
          )}
          {/* Bottom hint sits over the canvas */}
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 text-[10px] font-light tracking-[0.18em] uppercase pointer-events-none select-none text-[#272724]/25">
            Drag to rotate · Scroll to zoom
          </div>
        </div>

        {/* ── Materials sidebar (collapsible) ─────────────────────────── */}
        <CollapsibleSidebar
          title="Materials"
          open={matOpen}
          onToggle={() => setMatOpen((v) => !v)}
        >
          <div className="flex-1 min-h-0 overflow-y-auto calyx-leva">
            <LevaPanel
              store={matStore}
              fill
              flat
              titleBar={false}
              theme={LEVA_THEME}
            />
          </div>
        </CollapsibleSidebar>

        {/* ── Lighting sidebar (collapsible) ──────────────────────────── */}
        <CollapsibleSidebar
          title="Lighting"
          open={lightOpen}
          onToggle={() => setLightOpen((v) => !v)}
        >
          {/* Scrollable Leva panel on top … */}
          <div className="flex-1 min-h-0 overflow-y-auto calyx-leva">
            <LevaPanel
              store={lightStore}
              fill
              flat
              titleBar={false}
              theme={LEVA_THEME}
            />
          </div>
          {/* … then the draggable XY map as a fixed-height footer that
              always sits at the bottom of the sidebar, outside the
              scrollable region. Prevents the map from colliding with
              or overlapping the Leva rect-light sliders when the
              panel gets tall enough to scroll. */}
          <div className="flex-shrink-0 border-t border-[#e8ecf2]">
            <RectLightMap store={lightStore} />
          </div>
          {/* Save / Reset lighting — rendered as plain buttons beneath
              the rect-light map so they can't collide with Leva's
              conditional rect-light sliders. Handlers are routed
              through `lightingOpsRef`, which BagViewer populates on
              every render with up-to-date save/reset closures. */}
          <div className="flex-shrink-0 border-t border-[#e8ecf2] px-4 py-3 flex flex-col gap-2">
            <button
              type="button"
              onClick={() => lightingOpsRef.current?.save()}
              className="h-8 rounded-full text-[11px] font-semibold tracking-[0.12em] uppercase text-white bg-[#0033A1] hover:bg-[#001F60] transition-colors select-none"
            >
              Save Lighting for Environment
            </button>
            <button
              type="button"
              onClick={() => lightingOpsRef.current?.reset()}
              className="h-8 rounded-full text-[11px] font-semibold tracking-[0.12em] uppercase text-[#272724] bg-white border border-[#e8ecf2] hover:border-[#0033A1]/50 hover:text-[#0033A1] transition-colors select-none"
            >
              Reset Lighting to Defaults
            </button>
          </div>
        </CollapsibleSidebar>
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

/* ───────── Collapsible right-side panel ─────────
   Standard dock-aside with a header row and a content area. The header
   has a chevron toggle that collapses the whole panel to a thin rail
   showing just the (rotated) title; a second click expands it back to
   full width. Works in both directions so both Materials and Lighting
   can be collapsed independently. Width transitions are animated so
   the canvas resize reads naturally. */
function CollapsibleSidebar({
  title,
  open,
  onToggle,
  children,
}: {
  title: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <aside
      className={`flex-shrink-0 bg-white border-l border-[#e8ecf2] flex flex-col overflow-hidden z-10 transition-[width] duration-200 ease-out ${
        open ? "w-[280px]" : "w-[36px]"
      }`}
    >
      <header
        className={`flex-shrink-0 h-[38px] flex items-center border-b border-[#e8ecf2] select-none ${
          open ? "px-4 justify-between" : "justify-center"
        }`}
      >
        {open && (
          <span className="text-[10px] font-semibold tracking-[0.22em] uppercase text-[#272724]/60">
            {title}
          </span>
        )}
        <button
          type="button"
          onClick={onToggle}
          title={open ? `Collapse ${title}` : `Expand ${title}`}
          aria-label={open ? `Collapse ${title}` : `Expand ${title}`}
          className="p-1 rounded hover:bg-[#e8ecf2]/60 text-[#272724]/60 hover:text-[#272724] transition-colors"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path
              d={open ? "M4 2l4 4-4 4" : "M8 2l-4 4 4 4"}
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </header>
      {open ? (
        children
      ) : (
        // Thin collapsed rail — rotate the title so the label is still
        // visible without any horizontal space spent on it.
        <div className="flex-1 flex items-start justify-center pt-4">
          <span
            className="text-[10px] font-semibold tracking-[0.22em] uppercase text-[#272724]/40 select-none"
            style={{
              writingMode: "vertical-rl",
              transform: "rotate(180deg)",
            }}
          >
            {title}
          </span>
        </div>
      )}
    </aside>
  );
}
