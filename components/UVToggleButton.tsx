"use client";

/**
 * Toggle pill that swaps the 3D viewer's lighting into the UV Blacklight
 * preset and restores the slot's saved lighting when flipped off. Rendered
 * only on slots whose material has at least one UV-tagged layer (see
 * `hasUVLayer` in lib/bagMaterial.ts) — designs without a fluorescent
 * layer would show as dark blobs under UV, so the affordance is hidden.
 *
 * Two visual variants:
 *   - `variant="overlay"` — compact pill floated over the top-left of a
 *     3D slot card, with a glass pastel look that reads against either
 *     a bright environment or the dark UV scene itself.
 *   - `variant="bar"` — tighter chrome treatment for the FullscreenSlot
 *     top bar so it sits naturally next to the title + close button.
 */

interface Props {
  active: boolean;
  onClick: () => void;
  variant?: "overlay" | "bar";
  className?: string;
}

export default function UVToggleButton({
  active,
  onClick,
  variant = "overlay",
  className = "",
}: Props) {
  const baseOverlay =
    "absolute top-3 left-3 z-10 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[10px] font-semibold tracking-[0.14em] uppercase shadow-sm transition backdrop-blur-sm";
  const baseBar =
    "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[10px] font-semibold tracking-[0.16em] uppercase transition";

  // Active state leans into the UV glow palette (#b6ff00 on a deep violet
  // backdrop) so it reads as "the scene is currently under blacklight".
  const overlayActive =
    "bg-[#1a0b33]/90 text-[#d9ff5a] ring-1 ring-[#b6ff00]/60";
  const overlayIdle =
    "bg-white/90 text-[#2a0a5c] hover:bg-white";
  const barActive =
    "bg-[#b6ff00] text-[#1a0b33] hover:bg-[#cfff4d]";
  const barIdle =
    "bg-white/10 text-white/85 hover:bg-white/20 ring-1 ring-white/20";

  const stateCls =
    variant === "overlay"
      ? active
        ? overlayActive
        : overlayIdle
      : active
        ? barActive
        : barIdle;

  return (
    <button
      type="button"
      onClick={(e) => {
        // Prevent clicks from bubbling up to parent handlers (e.g. the
        // FullscreenSlot top-bar's "click anywhere on chrome to close"
        // behaviour, or any future slot-level click target).
        e.stopPropagation();
        onClick();
      }}
      aria-pressed={active}
      title={active ? "Exit UV Blacklight view" : "View under UV Blacklight"}
      aria-label={active ? "Exit UV Blacklight view" : "View under UV Blacklight"}
      className={`${variant === "overlay" ? baseOverlay : baseBar} ${stateCls} ${className}`}
    >
      {/* Lightbulb glyph — filled when active (glowing) and outline when
          idle. Kept tiny so it doesn't crowd the label. */}
      <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden>
        {active ? (
          <>
            <path
              d="M6 1.2c-2 0-3.4 1.5-3.4 3.3 0 1.1.5 1.9 1.1 2.5.4.4.7.8.7 1.3v.5h3.2v-.5c0-.5.3-.9.7-1.3.6-.6 1.1-1.4 1.1-2.5 0-1.8-1.4-3.3-3.4-3.3z"
              fill="currentColor"
            />
            <path
              d="M4.8 10h2.4M4.9 11h2.2"
              stroke="currentColor"
              strokeWidth="1.2"
              strokeLinecap="round"
            />
          </>
        ) : (
          <>
            <path
              d="M6 1.7c-1.7 0-3 1.3-3 2.9 0 1 .4 1.6.9 2.1.4.4.8.9.8 1.5v.4h2.6v-.4c0-.6.4-1.1.8-1.5.5-.5.9-1.1.9-2.1 0-1.6-1.3-2.9-3-2.9z"
              stroke="currentColor"
              strokeWidth="1.2"
              strokeLinejoin="round"
            />
            <path
              d="M4.8 10h2.4M4.9 11h2.2"
              stroke="currentColor"
              strokeWidth="1.2"
              strokeLinecap="round"
            />
          </>
        )}
      </svg>
      UV
    </button>
  );
}
