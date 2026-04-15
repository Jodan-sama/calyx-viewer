"use client";

import dynamic from "next/dynamic";
import type { ProductSet } from "@/lib/types";

const OutreachBagViewer = dynamic(
  () => import("@/components/OutreachBagViewer"),
  {
    ssr: false,
    loading: () => (
      <div className="w-full h-full flex items-center justify-center bg-[#f0f2f7]">
        <div className="w-7 h-7 border-2 border-[#0033A1] border-t-transparent rounded-full animate-spin" />
      </div>
    ),
  }
);

/* ───────── Hero slot (big card, 3D or flat) ───────── */
export function ProductSlot({
  index,
  set,
  onOpenImage,
}: {
  index: number;
  set?: ProductSet;
  onOpenImage: (src: string, alt: string) => void;
}) {
  if (set) {
    const isFlat = set.kind === "flat-image";
    return (
      <div className="relative aspect-square rounded-[20px] overflow-hidden border border-[#272724]/10 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_28px_-10px_rgba(0,0,0,0.1)] bg-[#eef1f8] group">
        {isFlat ? (
          <button
            type="button"
            onClick={() => onOpenImage(set.label_image_url, set.title)}
            className="block w-full h-full"
            title="Click to preview"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={set.label_image_url}
              alt={set.title}
              className="w-full h-full object-cover"
              draggable={false}
            />
          </button>
        ) : (
          <OutreachBagViewer
            textureUrl={set.label_image_url}
            material={set.material}
          />
        )}
        {isFlat && (
          <span className="absolute top-3 left-3 text-[9px] font-semibold tracking-[0.18em] uppercase px-2 py-1 rounded-full bg-white/85 text-purple-700 pointer-events-none">
            ✦ Magic
          </span>
        )}
        <div className="absolute bottom-0 left-0 right-0 p-3 bg-gradient-to-t from-black/50 to-transparent pointer-events-none">
          <p className="text-white text-[11px] font-semibold tracking-wide truncate">
            {set.title}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative aspect-square rounded-[20px] overflow-hidden bg-gradient-to-br from-[#f5f3ee] to-[#e7e3d8] border border-[#272724]/10 flex items-center justify-center shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_28px_-10px_rgba(0,0,0,0.1)]">
      <div className="flex flex-col items-center gap-3 text-center px-6">
        <div className="w-12 h-12 rounded-full border border-dashed border-[#272724]/30 flex items-center justify-center">
          <span className="text-[#272724]/40 text-[14px] font-light">
            {index}
          </span>
        </div>
        <p className="text-[10px] text-[#272724]/45 tracking-[0.2em] uppercase font-medium">
          Slot {index}
        </p>
        <p className="text-[9px] text-[#272724]/35 max-w-[180px] font-light leading-relaxed">
          Save a configured set from Calyx Preview to this slot.
        </p>
      </div>
    </div>
  );
}

/* ───────── Gallery tile (smaller, flat image from DB or placeholder) ───────── */
export function GallerySlot({
  index,
  set,
  onOpenImage,
}: {
  index: number;
  set?: ProductSet;
  onOpenImage: (src: string, alt: string) => void;
}) {
  if (set) {
    return (
      <button
        type="button"
        onClick={() => onOpenImage(set.label_image_url, set.title)}
        className="relative aspect-square rounded-2xl overflow-hidden border border-[#272724]/10 bg-[#f5f3ee] transition-all duration-200 hover:-translate-y-0.5 hover:border-[#0033A1]/40 group"
        title={set.title}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={set.label_image_url}
          alt={set.title}
          className="w-full h-full object-cover"
          draggable={false}
        />
        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
          <span className="text-white text-[9px] font-semibold tracking-[0.2em] uppercase">
            Preview
          </span>
        </div>
      </button>
    );
  }

  return (
    <div className="relative aspect-square rounded-2xl overflow-hidden bg-[#f5f3ee] border border-[#272724]/10 flex items-center justify-center">
      <span className="text-[#272724]/20 text-[11px] tracking-[0.2em] uppercase font-medium">
        Img {index}
      </span>
    </div>
  );
}
