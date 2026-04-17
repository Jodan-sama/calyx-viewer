"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import WigglyLines from "./WigglyLines";

/**
 * Full-screen intro cover shown on the client site (`/client/[slug]`)
 * while brand + sets hydrate from Supabase. Fixed blue palette so
 * every client site opens on the same Calyx-branded moment of
 * recognition before per-brand theming takes over.
 *
 * Visual: a centered Calyx logo on top of the wavy ribbon pattern used
 * across the site's permanent backdrop, painted on an opaque blue
 * gradient so the page underneath is fully covered while loading.
 *
 * Timing:
 *   minimum — overlay stays up ≥ 3000ms even if loading finishes
 *             faster, so assets behind it have a predictable decode
 *             window. Prevents a jarring snap when the Supabase round
 *             trip is cached.
 *   exit    — 900ms scale + opacity fade, then unmount so the overlay
 *             stops swallowing pointer events.
 */

// Backdrop gradient — pale Nordic blue into the brand's deep primary.
// Keeps the black logo readable across the gradient axis.
const BLUE_BACKDROP_GRADIENT =
  "linear-gradient(135deg, #eef3fb 0%, #c9d9f1 45%, #6e93d1 100%)";

// Wavy-line stroke — Calyx primary at moderate opacity. Matches the
// permanent page backdrop's shape family so the overlay reads as a
// continuation of the site's visual identity rather than a separate
// chrome layer on top.
const WAVE_STROKE = "rgba(0, 51, 161, 0.28)";

// Minimum time the overlay stays up regardless of how fast the
// network finishes. Three seconds per the user's ask.
const MIN_DISPLAY_MS = 3000;

// Exit transition duration. Matches the opacity + transform transitions
// below; we unmount one frame after this fires so nothing snaps.
const EXIT_DURATION_MS = 950;

interface Props {
  /** True while the client page is still fetching brand + sets. */
  loading: boolean;
}

export default function LoadingOverlay({ loading }: Props) {
  // Two latches:
  //   minElapsed — turns true after MIN_DISPLAY_MS so we can't exit
  //                before the 3-second floor.
  //   exiting    — true once we've started the fade-out; prevents the
  //                exit effect from being re-triggered on re-render.
  const [mounted, setMounted] = useState(true);
  const [exiting, setExiting] = useState(false);
  const [minElapsed, setMinElapsed] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setMinElapsed(true), MIN_DISPLAY_MS);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (loading) return;
    if (!minElapsed) return;
    if (exiting) return;
    setExiting(true);
    const t = setTimeout(() => setMounted(false), EXIT_DURATION_MS);
    return () => clearTimeout(t);
  }, [loading, minElapsed, exiting]);

  if (!mounted) return null;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center pointer-events-none"
      aria-hidden="true"
      style={{
        background: BLUE_BACKDROP_GRADIENT,
        opacity: exiting ? 0 : 1,
        transition: "opacity 850ms cubic-bezier(0.4, 0, 0.2, 1)",
      }}
    >
      {/* Wavy ribbon backdrop — same pattern as the permanent page
          background. Sits on the overlay so the wavy motion stays
          visible during the 3-second hold (the page's own WigglyLines
          are covered by the opaque gradient until exit). */}
      <div className="absolute inset-0">
        <WigglyLines
          seed={9}
          color={WAVE_STROKE}
          lineCount={16}
          logoRiders={3}
          logoSize={32}
        />
      </div>

      {/* Calyx logo — centred, breathes subtly while idle, fades on
          exit. Sits above the wave layer so it always reads cleanly. */}
      <div
        className="relative z-10"
        style={{
          transform: exiting ? "scale(1.04)" : "scale(1)",
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

      {/* Keyframes scoped to the overlay so we don't touch globals.css. */}
      <style jsx>{`
        @keyframes calyxLoaderPulse {
          0%, 100% {
            transform: scale(1);
            opacity: 0.94;
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
