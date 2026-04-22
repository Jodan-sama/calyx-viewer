"use client";

/**
 * Action pill that reshuffles the mosaic finish on a slot's 3D asset —
 * new zoom, new mirror flip, new per-layer crop offsets — without
 * triggering a texture refetch. Rendered only on slots whose material
 * has a mosaic source image (see `hasMosaicLayer` in
 * lib/bagMaterial.ts); slots without one would show the same image
 * regardless of seed, so the affordance is hidden.
 *
 * Two visual variants, mirroring `UVToggleButton`:
 *   - `variant="overlay"` — compact pill floated over the bottom-right
 *     of a 3D slot card. Bottom placement keeps the top chrome
 *     (Expand / UV) clear.
 *   - `variant="bar"` — tighter chrome treatment for the FullscreenSlot
 *     top bar so it sits naturally next to the title + close button.
 */

interface Props {
  onClick: () => void;
  variant?: "overlay" | "bar";
  className?: string;
}

export default function MosaicCycleButton({
  onClick,
  variant = "overlay",
  className = "",
}: Props) {
  const baseOverlay =
    "absolute bottom-3 right-3 z-10 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[10px] font-semibold tracking-[0.14em] uppercase shadow-sm transition backdrop-blur-sm bg-white/90 text-[#272724] hover:bg-white active:scale-95";
  const baseBar =
    "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[10px] font-semibold tracking-[0.16em] uppercase transition bg-white/10 text-white/85 hover:bg-white/20 ring-1 ring-white/20 active:scale-95";

  return (
    <button
      type="button"
      onClick={(e) => {
        // Clicks must not bubble up: the FullscreenSlot top-bar closes
        // the modal on bg-click, and slot cards may gain parent click
        // handlers later.
        e.stopPropagation();
        onClick();
      }}
      title="Shuffle mosaic crop"
      aria-label="Shuffle mosaic crop"
      className={`${variant === "overlay" ? baseOverlay : baseBar} ${className}`}
    >
      {/* Circular arrow glyph — a single unclosed loop with a small
          arrowhead so it reads unambiguously as "reshuffle" rather
          than "refresh the page". */}
      <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden>
        <path
          d="M10 6a4 4 0 1 1-1.2-2.85"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M10.2 1.6v2.4H7.8"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      Mosaic
    </button>
  );
}
