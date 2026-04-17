"use client";

import { useCallback, useEffect } from "react";

type Props = {
  src: string;
  alt?: string;
  onClose: () => void;
};

export default function ImagePreviewModal({ src, alt = "", onClose }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Force-download via a blob URL so Supabase Storage's inline
  // Content-Disposition doesn't override the <a download> hint.
  // Falls back to opening the raw URL in a new tab when the fetch
  // is blocked (e.g. CORS on a misconfigured bucket) — degraded,
  // but still lets the user grab the file.
  const handleDownload = useCallback(async () => {
    try {
      const res = await fetch(src);
      const blob = await res.blob();
      const ext = (blob.type.split("/")[1] ?? "jpg").replace("jpeg", "jpg");
      const safe = (alt || "calyx-preview")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 40);
      const objUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objUrl;
      a.download = `${safe || "calyx-preview"}.${ext}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objUrl);
    } catch {
      window.open(src, "_blank", "noopener,noreferrer");
    }
  }, [src, alt]);

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/80 backdrop-blur-sm p-6"
      onClick={onClose}
    >
      <button
        type="button"
        onClick={onClose}
        className="absolute top-5 right-6 text-white/70 hover:text-white text-2xl leading-none"
        aria-label="Close"
      >
        ×
      </button>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        className="max-h-[calc(100%-60px)] max-w-full rounded-lg shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      />
      {/* Download action — only renders in the expanded preview, which
          is the only time the raw image file is actionable. Clicks stop
          propagating so the backdrop dismiss doesn't fire. */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          handleDownload();
        }}
        className="mt-5 inline-flex items-center gap-2 px-5 h-9 rounded-full text-[11px] font-semibold tracking-[0.14em] uppercase text-[#272724] bg-white/95 hover:bg-white transition"
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
        Download
      </button>
    </div>
  );
}
