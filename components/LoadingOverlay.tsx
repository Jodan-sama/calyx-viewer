"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import WigglyLines from "./WigglyLines";

/**
 * Full-screen intro cover shown on the client site (`/client/[slug]`)
 * while brand + sets hydrate from Supabase. Fixed blue palette so
 * every client site opens on the same Calyx-branded moment of
 * recognition before per-brand theming takes over.
 *
 * Visual: a centered Calyx logo with concentric hexagons radiating
 * outward from it on a continuous loop, drawn on a full-viewport
 * canvas. New hexagons spawn at a steady cadence and grow to the
 * screen edge before fading out, so there are always several in
 * flight at once — the effect reads as "the logo is emitting these
 * shapes" rather than a single pulse.
 *
 * Timing:
 *   minimum — overlay stays up ≥ 3000ms even if loading finishes
 *             faster, matching the user's ask ("keep it there for 3
 *             seconds so assets can load"). Prevents a jarring snap
 *             when the Supabase round-trip is cached.
 *   exit    — 900ms scale + opacity fade, then unmount so the
 *             overlay stops swallowing pointer events.
 */

// Backdrop gradient — pale Nordic blue into the brand's deep primary.
// Keeps the black logo readable across the gradient axis.
const BLUE_BACKDROP_GRADIENT =
  "linear-gradient(135deg, #eef3fb 0%, #c9d9f1 45%, #6e93d1 100%)";

// Hexagon stroke — Calyx primary at moderate opacity. Each shape
// reads as ambient texture rather than a hard overlay, so overlapping
// hexes blend softly without crushing the logo in the middle.
const HEX_STROKE = "rgba(0, 51, 161, 0.42)";

// Wavy-line stroke — paler blue so the wavy ribbon backdrop reads
// beneath the hexagons without competing with them. Same shape/family
// as the permanent page backdrop so the overlay's motion feels like a
// continuation of the site's visual identity.
const WAVE_STROKE = "rgba(0, 51, 161, 0.22)";

// Minimum time the overlay stays up regardless of how fast the
// network finishes. Three seconds per the user's ask.
const MIN_DISPLAY_MS = 3000;

// Exit transition duration. Matches the opacity + transform transitions
// below; we unmount one frame after this fires so nothing snaps.
const EXIT_DURATION_MS = 950;

// Per-hexagon animation knobs.
const HEX_LIFETIME_MS = 2600;
const HEX_SPAWN_INTERVAL_MS = 380;
const HEX_START_RADIUS = 54;        // CSS px — roughly hugs the logo edge
const HEX_RADIUS_COVERAGE = 0.72;   // fraction of viewport diagonal

/**
 * Canvas animation: concentric hexagons emanate outward from the
 * centre of the viewport at a steady rhythm. Each spawns with a
 * random rotation, grows from HEX_START_RADIUS to a fraction of the
 * viewport diagonal over its lifetime, and fades out as it nears the
 * edge. Keeps stroke width constant in CSS pixels by inverse-scaling.
 */
function HexEmanations({ color }: { color: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    let w = 0;
    let h = 0;
    const dpr = Math.max(1, window.devicePixelRatio || 1);

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      w = rect.width;
      h = rect.height;
      canvas.width = Math.max(1, Math.round(w * dpr));
      canvas.height = Math.max(1, Math.round(h * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    // Pre-built unit-scale hexagon path. We scale it up per-draw so
    // the same Path2D serves every hexagon in flight — no per-frame
    // path allocation.
    const VERTICES = 6;
    const hexPath = new Path2D();
    for (let i = 0; i < VERTICES; i++) {
      const a = (i / VERTICES) * Math.PI * 2 - Math.PI / 2;
      const x = Math.cos(a);
      const y = Math.sin(a);
      if (i === 0) hexPath.moveTo(x, y);
      else hexPath.lineTo(x, y);
    }
    hexPath.closePath();

    // Active hexes ordered by spawn time (oldest first). Shift expired
    // ones off the head each frame; push new ones on the tail.
    type Hex = { spawn: number; rotation: number };
    const hexes: Hex[] = [];

    // Seed a few hexes already in flight so the overlay doesn't look
    // empty for the first half-second. Back-dating their spawn times
    // staggers them across the lifetime window.
    const startTime = performance.now();
    for (let k = 1; k <= 4; k++) {
      hexes.push({
        spawn: startTime - k * HEX_SPAWN_INTERVAL_MS,
        rotation: Math.random() * Math.PI * 2,
      });
    }
    let lastSpawn = startTime;

    const draw = (now: number) => {
      // Spawn on a fixed cadence so density stays constant regardless
      // of the display's frame rate.
      while (now - lastSpawn >= HEX_SPAWN_INTERVAL_MS) {
        lastSpawn += HEX_SPAWN_INTERVAL_MS;
        hexes.push({
          spawn: lastSpawn,
          rotation: Math.random() * Math.PI * 2,
        });
      }
      while (hexes.length && now - hexes[0].spawn > HEX_LIFETIME_MS) {
        hexes.shift();
      }

      ctx.clearRect(0, 0, w, h);

      const cx = w / 2;
      const cy = h / 2;
      const maxRadius = Math.hypot(w, h) * HEX_RADIUS_COVERAGE;

      for (const hex of hexes) {
        const age = (now - hex.spawn) / HEX_LIFETIME_MS;
        if (age < 0 || age > 1) continue;

        // Ease-out on radius so hexes race outward at first and
        // decelerate near the edge — feels like they're being emitted
        // rather than pushed uniformly.
        const eased = 1 - Math.pow(1 - age, 2.4);
        const r = HEX_START_RADIUS + (maxRadius - HEX_START_RADIUS) * eased;

        // Opacity: quick fade-in, plateau, linear fade-out. Keeps each
        // hex readable from just outside the logo through to when it
        // reaches the viewport edge.
        const fadeIn = 0.12;
        const opacity =
          age < fadeIn
            ? age / fadeIn
            : 1 - (age - fadeIn) / (1 - fadeIn);

        ctx.save();
        ctx.globalAlpha = Math.max(0, Math.min(1, opacity));
        ctx.translate(cx, cy);
        ctx.rotate(hex.rotation + age * 0.35);
        ctx.scale(r, r);
        // Unit path strokes at `lineWidth` world units — divide by `r`
        // so the rendered stroke is always ~1.6 CSS px regardless of
        // how far the hex has grown.
        ctx.lineWidth = 1.6 / r;
        ctx.strokeStyle = color;
        ctx.stroke(hexPath);
        ctx.restore();
      }

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [color]);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 w-full h-full"
      style={{ display: "block" }}
    />
  );
}

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
      {/* Wavy-line backdrop — same ribbon pattern used on the page's
          permanent background. Sits on the overlay so the wavy motion
          stays visible during the 3-second hold (the page's own
          WigglyLines are covered by the opaque overlay until exit). */}
      <div className="absolute inset-0">
        <WigglyLines
          seed={9}
          color={WAVE_STROKE}
          lineCount={16}
          logoRiders={3}
          logoSize={32}
        />
      </div>

      {/* Hexagon emanation layer — fills the overlay, paints on top of
          the wavy ribbons and under the logo so each new hex appears
          to burst out from behind the Calyx mark. */}
      <div
        className="absolute inset-0"
        style={{
          transform: exiting ? "scale(1.15)" : "scale(1)",
          transformOrigin: "50% 50%",
          transition: "transform 900ms cubic-bezier(0.4, 0, 0.2, 1)",
        }}
      >
        <HexEmanations color={HEX_STROKE} />
      </div>

      {/* Calyx logo — centred, breathes subtly while idle, fades on
          exit. Sits above the canvas so hexes always appear to come
          out from behind it. Size kept at normal ~240px wide so the
          hexes can comfortably radiate around it. */}
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
