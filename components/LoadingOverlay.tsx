"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import WigglyLines from "./WigglyLines";

/**
 * Full-screen intro cover shown on the client site (`/client/[slug]`)
 * while brand + sets hydrate from Supabase. Visual is a large centered
 * Calyx logo with the same wavy-line pattern used in the page
 * backdrop. The pattern emanates outward from the logo via a radial
 * clip-path, then sweeps off on exit by scaling out + fading — "flows
 * naturally from the screen" once loading finishes.
 *
 * Renders its own `WigglyLines` instance (not the page's) so the entry
 * reveal animates without disturbing the permanent background layer.
 *
 * Timing tuned to feel intentional rather than blocking:
 *   enter — 1200ms clip-path grow (0% → 150% at logo center)
 *   exit  — 900ms scale-out + opacity fade
 *   unmount follows exit by a single tick so React doesn't reparent
 *   mid-animation.
 */

interface Props {
  /** True while the client page is still fetching brand + sets. */
  loading: boolean;
  /** Brand gradient applied to the overlay's backdrop so the cover
   *  matches the page underneath. Falls back to a neutral off-white. */
  backgroundGradient?: string;
  /** Accent hex used for the wavy strokes. Defaults to Calyx blue at
   *  moderate opacity so the pattern reads against the gradient. */
  accentColor?: string;
}

export default function LoadingOverlay({
  loading,
  backgroundGradient,
  accentColor = "rgba(0,51,161,0.28)",
}: Props) {
  // Three-phase mount lifecycle:
  //   "enter" — clip-path ring grows from logo center to full viewport
  //   "idle"  — overlay fully covers the page until `loading` flips off
  //   "exit"  — waves scale out + overlay fades; `mounted` is cleared
  //             after the exit transition completes.
  const [phase, setPhase] = useState<"enter" | "idle" | "exit">("enter");
  const [mounted, setMounted] = useState(true);

  // Kick the enter→idle transition one frame after mount so the browser
  // has a chance to paint the "enter" state with clip-path at 0%. Without
  // this rAF gap the transition from 0% → 150% gets collapsed and the
  // emanate effect never plays.
  useEffect(() => {
    const id = requestAnimationFrame(() => setPhase("idle"));
    return () => cancelAnimationFrame(id);
  }, []);

  // Watch the loading flag. Once data has arrived, flip to the exit
  // phase. The CSS transition on the overlay handles the visual sweep;
  // we unmount after it completes so the overlay doesn't swallow clicks
  // on the revealed page underneath.
  useEffect(() => {
    if (loading) return;
    if (phase === "exit") return;
    setPhase("exit");
    const t = setTimeout(() => setMounted(false), 950);
    return () => clearTimeout(t);
  }, [loading, phase]);

  if (!mounted) return null;

  // Clip-path values ordered by phase — "enter" starts the ring at 0
  // pixels wide so only the logo shows, then expands to 150% of the
  // viewport hypotenuse so the waves reach every corner. "exit" lets
  // the full pattern scale + fade instead of shrinking the clip, which
  // gives a softer drift-off than a closing iris would.
  const clipPath =
    phase === "enter"
      ? "circle(0% at 50% 50%)"
      : "circle(150% at 50% 50%)";

  const exiting = phase === "exit";

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center pointer-events-none"
      aria-hidden="true"
      style={{
        background:
          backgroundGradient ??
          "linear-gradient(135deg, #f6f3ec 0%, #eaeef5 100%)",
        opacity: exiting ? 0 : 1,
        transition: "opacity 850ms cubic-bezier(0.4, 0, 0.2, 1)",
      }}
    >
      {/* Wavy pattern layer. Entrance uses clip-path to radiate from
          the logo; exit relaxes the clip and scales the whole layer
          outward so the waves feel like they drift off the screen. */}
      <div
        className="absolute inset-0"
        style={{
          clipPath,
          WebkitClipPath: clipPath,
          transform: exiting ? "scale(1.25)" : "scale(1)",
          transformOrigin: "50% 50%",
          transition: [
            "clip-path 1200ms cubic-bezier(0.22, 1, 0.36, 1)",
            "-webkit-clip-path 1200ms cubic-bezier(0.22, 1, 0.36, 1)",
            "transform 900ms cubic-bezier(0.4, 0, 0.2, 1)",
          ].join(", "),
        }}
      >
        <WigglyLines
          seed={9}
          color={accentColor}
          lineCount={18}
          logoRiders={3}
          logoSize={32}
        />
      </div>

      {/* Calyx logo — breathes subtly while idle, fades/scales on exit.
          Sits above the wave layer so it always reads cleanly even as
          the pattern races outward from underneath it. */}
      <div
        className="relative z-10"
        style={{
          transform: exiting ? "scale(1.06)" : "scale(1)",
          opacity: exiting ? 0 : 1,
          transition:
            "transform 900ms cubic-bezier(0.4, 0, 0.2, 1), opacity 650ms ease-in",
        }}
      >
        <Image
          src="/calyx-logo.svg"
          alt="Calyx Containers"
          width={240}
          height={62}
          priority
          style={{
            height: 62,
            width: "auto",
            animation: exiting
              ? "none"
              : "calyxLoaderPulse 2.4s ease-in-out infinite",
          }}
        />
      </div>

      {/* Keyframes are scoped to the overlay instance so we don't need
          to touch globals.css. A gentle opacity + scale breath reads as
          "working" without drawing attention away from the wave reveal. */}
      <style jsx>{`
        @keyframes calyxLoaderPulse {
          0%, 100% {
            transform: scale(1);
            opacity: 0.92;
          }
          50% {
            transform: scale(1.04);
            opacity: 1;
          }
        }
      `}</style>
    </div>
  );
}
