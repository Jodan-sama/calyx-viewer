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
 */
export default function WigglyLines({
  seed = 0,
  color = "rgba(160,160,160,0.55)",
  lineCount = 14,
  lineWidth = 1.3,
}: {
  seed?: number;
  color?: string;
  lineCount?: number;
  lineWidth?: number;
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

    const draw = (t: number) => {
      ctx.clearRect(0, 0, w, h);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.strokeStyle = color;
      ctx.lineWidth = lineWidth;

      const time = t * 0.001;

      for (const L of lines) {
        ctx.beginPath();
        const steps = 96;
        for (let i = 0; i <= steps; i++) {
          const u = i / steps;
          const x = u * w;
          const wob =
            Math.sin(u * Math.PI * 2 * L.freq + time * L.speed * 2 + L.phase) *
              L.amp +
            Math.sin(u * Math.PI * 2 * L.freq * 0.43 + time * L.speed * 1.3) *
              L.amp * 0.4;
          const y = (L.y0 + L.slant * (u - 0.5) + wob * 0.25) * h;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }

      rafId = requestAnimationFrame(draw);
    };
    rafId = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(rafId);
      ro.disconnect();
    };
  }, [seed, color, lineCount, lineWidth]);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 w-full h-full"
      style={{ display: "block" }}
    />
  );
}
