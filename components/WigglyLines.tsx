"use client";

import { useEffect, useRef } from "react";

/**
 * Animated wavy-line backdrop. A canvas of overlapping squiggles that drift
 * across whatever container it's placed in. The same component powers the
 * landing page (light-grey ambient texture) and the client site (brand
 * accent colour, full-screen).
 *
 * Uses sinusoidal offsets rather than real noise so it stays dependency-free,
 * and reads `seed` deterministically so repeated renders give the same
 * pattern instead of jittering between mounts.
 *
 * Optional `logoRiders` spawns that many Calyx diamond icons drifting
 * across specific waves, rotated to follow each wave's local tangent.
 * Useful on the brand client site to stitch the waves into the identity
 * — turned off (0) on the landing page so that stays purely abstract.
 */

// First `<path d="…">` from /Users/jodan/Downloads/calyx-logo.svg — the
// diamond icon only, no wordmark. Native SVG viewBox is 0..138 on both
// axes so the geometry is roughly square. We centre it on (69,69) when
// stamping into the canvas.
const CALYX_ICON_PATH_D =
  "M130.228,50.071L88.012,7.86c-5.068-5.068-11.806-7.86-18.974-7.86s-13.907,2.791-18.975,7.86L7.847,50.071c-10.463,10.462-10.463,27.483,0,37.945l42.216,42.212c5.231,5.231,12.103,7.845,18.974,7.845s13.743-2.615,18.975-7.845l42.216-42.212c10.462-10.462,10.462-27.483,0-37.945M126.698,53.6c3.623,3.623,5.689,8.214,6.23,12.949h-17.696c-.451-1.955-1.408-3.817-2.93-5.341l-7.922-7.921-3.517,3.516,7.535,7.536c2.599,2.598,2.599,6.812,0,9.41l-34.654,34.652c-2.599,2.598-6.814,2.598-9.412,0l-34.655-34.652c-2.599-2.598-2.599-6.812,0-9.41l34.655-34.652c2.599-2.598,6.813-2.598,9.412,0l7.535,7.534,3.516-3.517-7.922-7.921c-1.523-1.522-3.386-2.48-5.34-2.93V5.145c4.888.553,9.419,2.713,12.949,6.243l42.216,42.211ZM11.377,53.6L53.593,11.388c3.529-3.53,8.061-5.69,12.95-6.243v17.707c-1.955.451-3.818,1.408-5.342,2.93L25.772,61.208c-1.522,1.524-2.479,3.386-2.929,5.341H5.147c.54-4.735,2.606-9.326,6.23-12.949M11.377,84.488c-3.623-3.623-5.69-8.214-6.23-12.949h17.696c.451,1.955,1.408,3.817,2.929,5.339l35.429,35.428c1.524,1.524,3.387,2.48,5.342,2.93v17.693c-4.735-.54-9.328-2.606-12.95-6.23L11.377,84.488ZM126.698,84.488l-42.216,42.21c-3.623,3.624-8.214,5.69-12.949,6.23v-17.693c1.954-.451,3.817-1.408,5.34-2.93l35.429-35.428c1.523-1.522,2.48-3.384,2.93-5.339h17.696c-.541,4.735-2.607,9.326-6.23,12.949";

const CALYX_ICON_NATIVE = 138;
const CALYX_ICON_CENTER = CALYX_ICON_NATIVE / 2;

export default function WigglyLines({
  seed = 0,
  color = "rgba(160,160,160,0.55)",
  lineCount = 14,
  lineWidth = 1.3,
  logoRiders = 0,
  logoSize = 34,
}: {
  seed?: number;
  color?: string;
  lineCount?: number;
  lineWidth?: number;
  /** Number of waves that carry a drifting Calyx icon. The icons are
   *  painted in the same `color` as the waves so they read as part of
   *  the ambient motion rather than a separate layer. Default 0. */
  logoRiders?: number;
  /** Icon edge length in CSS pixels. Scaled uniformly. */
  logoSize?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let rafId = 0;
    let w = 0, h = 0;
    const dpr = Math.max(1, window.devicePixelRatio || 1);

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      w = rect.width;
      h = rect.height;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();

    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    // Pre-define a set of lines with randomized-but-seeded params
    const rand = (i: number) => {
      const x = Math.sin((seed + 1) * 999 + i * 17.31) * 10000;
      return x - Math.floor(x);
    };

    const lines = Array.from({ length: lineCount }, (_, i) => ({
      y0: rand(i * 3) * 0.9 + 0.05,        // base vertical position (0..1)
      amp: 0.05 + rand(i * 3 + 1) * 0.12,  // wobble amplitude
      freq: 1 + rand(i * 3 + 2) * 2.5,     // spatial frequency
      speed: 0.15 + rand(i * 5) * 0.35,    // temporal speed
      phase: rand(i * 7) * Math.PI * 2,
      slant: (rand(i * 11) - 0.5) * 0.25,  // slight tilt
    }));

    // Parsed SVG path for the Calyx diamond icon. Path2D accepts the
    // same mini-language as SVG's `d` attribute, so we can reuse the
    // path data verbatim. Guard on `typeof Path2D` for environments
    // without the constructor — SSR shouldn't hit this branch because
    // useEffect only runs client-side, but it's a cheap safeguard.
    const iconPath =
      typeof Path2D !== "undefined" ? new Path2D(CALYX_ICON_PATH_D) : null;

    // Pick which lines host logo riders. Deterministic from the seed
    // so repeat mounts get the same arrangement. We spread the chosen
    // indices across the full range so riders aren't bunched.
    const riderLineIdx = (() => {
      const clampedCount = Math.max(0, Math.min(logoRiders | 0, lineCount));
      if (clampedCount === 0) return new Set<number>();
      const stride = lineCount / clampedCount;
      const offset = Math.floor(rand(929) * stride);
      const set = new Set<number>();
      for (let k = 0; k < clampedCount; k++) {
        set.add(Math.min(lineCount - 1, Math.floor(offset + k * stride)));
      }
      return set;
    })();

    // Per-rider horizontal drift speed + starting u. Constructed once
    // per mount and re-used every frame.
    const riders = Array.from(riderLineIdx).map((idx) => ({
      idx,
      uStart: rand(idx * 31 + 53),
      uSpeed: 0.015 + rand(idx * 31 + 71) * 0.04, // u/sec
    }));

    const TAU = Math.PI * 2;

    const draw = (t: number) => {
      ctx.clearRect(0, 0, w, h);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.lineWidth = lineWidth;

      const time = t * 0.001;

      for (const L of lines) {
        ctx.beginPath();
        const steps = 96;
        for (let i = 0; i <= steps; i++) {
          const u = i / steps;
          const x = u * w;
          const wob =
            Math.sin(u * TAU * L.freq + time * L.speed * 2 + L.phase) *
              L.amp +
            Math.sin(u * TAU * L.freq * 0.43 + time * L.speed * 1.3) *
              L.amp * 0.4;
          const y = (L.y0 + L.slant * (u - 0.5) + wob * 0.25) * h;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }

      // Logo riders — drawn AFTER the lines so they paint on top of
      // the curve they ride. Each rider tracks one line's equation so
      // Y and tangent are sampled at the same instant as the ribbon
      // paints, keeping the icon visually glued to the wave.
      if (iconPath && riders.length > 0) {
        for (const rider of riders) {
          const L = lines[rider.idx];
          // Drift u horizontally, wrapping 0..1, so the icon "surfs"
          // across rather than sitting at a fixed spot. Speed is
          // per-rider so they don't all travel in lockstep.
          const u = (rider.uStart + time * rider.uSpeed) % 1.0;

          const phaseA = u * TAU * L.freq + time * L.speed * 2 + L.phase;
          const phaseB = u * TAU * L.freq * 0.43 + time * L.speed * 1.3;
          const wob =
            Math.sin(phaseA) * L.amp +
            Math.sin(phaseB) * L.amp * 0.4;
          const y = (L.y0 + L.slant * (u - 0.5) + wob * 0.25) * h;

          // d(y)/d(u) = (slant + 0.25 * d(wob)/d(u)) * h
          // d(wob)/d(u) = TAU*L.freq*L.amp*cos(phaseA)
          //             + TAU*L.freq*0.43*L.amp*0.4*cos(phaseB)
          const dwob =
            TAU * L.freq * L.amp * Math.cos(phaseA) +
            TAU * L.freq * 0.43 * L.amp * 0.4 * Math.cos(phaseB);
          const dy = (L.slant + 0.25 * dwob) * h;
          const dx = w; // x = u * w → dx/du = w
          const angle = Math.atan2(dy, dx);

          const x = u * w;
          const iconScale = logoSize / CALYX_ICON_NATIVE;

          ctx.save();
          ctx.translate(x, y);
          ctx.rotate(angle);
          ctx.scale(iconScale, iconScale);
          ctx.translate(-CALYX_ICON_CENTER, -CALYX_ICON_CENTER);
          ctx.fill(iconPath);
          ctx.restore();
        }
      }

      rafId = requestAnimationFrame(draw);
    };
    rafId = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(rafId);
      ro.disconnect();
    };
  }, [seed, color, lineCount, lineWidth, logoRiders, logoSize]);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 w-full h-full"
      style={{ display: "block" }}
    />
  );
}
