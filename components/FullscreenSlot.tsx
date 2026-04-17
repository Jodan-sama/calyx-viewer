"use client";

import { useCallback, useEffect } from "react";
import dynamic from "next/dynamic";
import type { ProductSet } from "@/lib/types";

const OutreachBagViewer = dynamic(() => import("./OutreachBagViewer"), {
  ssr: false,
});
const OutreachJarViewer = dynamic(() => import("./OutreachJarViewer"), {
  ssr: false,
});

/**
 * Full-viewport modal that reopens an Outreach slot's 3D asset at
 * screen size so the viewer can inspect it closely. Mounted on top of
 * the client site (outside the scrolling page) via a fixed
 * positioning wrapper; closes on the × button, Escape key, or a click
 * on the top/bottom chrome (the canvas itself is click-through to
 * OrbitControls so drag-to-rotate still works).
 *
 * The bottom bar carries a Download action that fetches
 * `preview_image_url` (the saved 3D render thumbnail) — or falls
 * back to `label_image_url` if no preview exists — and triggers a
 * browser save dialog via a blob URL so cross-origin Supabase
 * Storage responses still download reliably instead of opening
 * inline.
 */
export default function FullscreenSlot({
  set,
  onClose,
}: {
  set: ProductSet;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const transparent = set.material?.backgroundMode === "transparent";

  const downloadHref = set.preview_image_url ?? set.label_image_url;

  const handleDownload = useCallback(async () => {
    try {
      const res = await fetch(downloadHref);
      const blob = await res.blob();
      const ext = (blob.type.split("/")[1] ?? "jpg").replace("jpeg", "jpg");
      const safeTitle = (set.title || "calyx")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 40);
      const objUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objUrl;
      a.download = `${safeTitle || "calyx-preview"}.${ext}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objUrl);
    } catch {
      // Cross-origin block or 404 — fall through to opening the raw
      // URL in a new tab so the user still has *some* path to the
      // file. Browser save dialog is graceful degradation only.
      window.open(downloadHref, "_blank", "noopener,noreferrer");
    }
  }, [downloadHref, set.title]);

  const viewer = set.product_type === "supplement-jar" ? (
    <OutreachJarViewer
      textureUrl={set.label_image_url}
      backTextureUrl={set.material?.backImageUrl ?? null}
      material={set.material}
      environment={set.environment}
      transparent={transparent}
    />
  ) : (
    <OutreachBagViewer
      textureUrl={set.label_image_url}
      backTextureUrl={set.material?.backImageUrl ?? null}
      layer3FrontTextureUrl={set.material?.layer3FrontImageUrl ?? null}
      layer3BackTextureUrl={set.material?.layer3BackImageUrl ?? null}
      material={set.material}
      environment={set.environment}
      transparent={transparent}
    />
  );

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/90 backdrop-blur-md">
      {/* Top bar — slot title + close. Stays above the canvas so the
          close affordance is always reachable without competing with
          OrbitControls' drag handling. */}
      <div
        className="flex-shrink-0 h-14 flex items-center justify-between px-6 bg-black/40 cursor-pointer"
        onClick={onClose}
      >
        <span className="text-white text-[12px] font-semibold tracking-[0.2em] uppercase select-none">
          {set.title}
        </span>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          className="text-white/70 hover:text-white text-2xl leading-none"
          aria-label="Close fullscreen preview"
        >
          ×
        </button>
      </div>

      {/* 3D canvas — fills the remaining viewport. Relative so the
          dynamic-imported viewer can position its own absolute wrapper
          (gradient backgrounds) correctly inside it. */}
      <div className="flex-1 min-h-0 relative">{viewer}</div>

      {/* Bottom bar — download preview image. Doubles as another
          click-to-close surface so users don't have to chase the
          top-right × on large screens. */}
      <div
        className="flex-shrink-0 flex items-center justify-center py-4 bg-black/40 cursor-pointer"
        onClick={onClose}
      >
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            handleDownload();
          }}
          className="inline-flex items-center gap-2 px-5 h-9 rounded-full text-[11px] font-semibold tracking-[0.14em] uppercase text-[#272724] bg-white/95 hover:bg-white transition"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
            <path
              d="M6 1v7M3 6l3 3 3-3M2 10h8"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          Download Preview
        </button>
      </div>
    </div>
  );
}
