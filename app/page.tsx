"use client";

import Image from "next/image";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useEffect, useRef } from "react";

// Lazy 3D bag preview — client-only (three.js)
const OutreachBagViewer = dynamic(
  () => import("@/components/OutreachBagViewer"),
  {
    ssr: false,
    loading: () => (
      <div className="w-full h-full flex items-center justify-center bg-[#eef1f8]">
        <div className="w-8 h-8 border-2 border-[#0033A1] border-t-transparent rounded-full animate-spin" />
      </div>
    ),
  }
);

/* ───────────────────────────────────────────────────────────────
   Wiggling-lines background (canvas)
   Multiple overlapping black squiggles that slowly drift and
   wobble inside each card. Uses perlin-ish sinusoidal offsets
   instead of actual noise to stay dependency-free.
   ─────────────────────────────────────────────────────────────── */
function WigglyLines({ seed = 0 }: { seed?: number }) {
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

    const LINES = 9;
    const lines = Array.from({ length: LINES }, (_, i) => ({
      y0: rand(i * 3) * 0.9 + 0.05,          // base vertical position (0..1)
      amp: 0.05 + rand(i * 3 + 1) * 0.12,    // wobble amplitude
      freq: 1 + rand(i * 3 + 2) * 2.5,       // spatial frequency
      speed: 0.15 + rand(i * 5) * 0.35,      // temporal speed
      phase: rand(i * 7) * Math.PI * 2,
      slant: (rand(i * 11) - 0.5) * 0.25,    // slight tilt
    }));

    const draw = (t: number) => {
      ctx.clearRect(0, 0, w, h);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.strokeStyle = "rgba(20,20,20,0.82)";
      ctx.lineWidth = 1.3;

      const time = t * 0.001;

      for (const L of lines) {
        ctx.beginPath();
        const steps = 64;
        for (let i = 0; i <= steps; i++) {
          const u = i / steps;
          const x = u * w;
          // combine two sinusoids for a wandering squiggle
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
  }, [seed]);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 w-full h-full"
      style={{ display: "block" }}
    />
  );
}

/* ───────────────────────────────────────────────────────────────
   Card
   ─────────────────────────────────────────────────────────────── */
function Card({
  href,
  label,
  seed,
  children,
  flush = false,
}: {
  href: string;
  label: string;
  seed: number;
  children: React.ReactNode;
  flush?: boolean;
}) {
  return (
    <Link
      href={href}
      className="group flex flex-col items-center gap-6 select-none"
    >
      <div
        className="
          relative aspect-square w-full max-w-[500px]
          rounded-[32px] overflow-hidden
          bg-[#f5f3ee]
          border border-[#272724]/10
          shadow-[0_1px_2px_rgba(0,0,0,0.04),0_12px_40px_-12px_rgba(0,0,0,0.12)]
          transition-all duration-300
          group-hover:-translate-y-1
          group-hover:shadow-[0_2px_4px_rgba(0,0,0,0.06),0_24px_60px_-12px_rgba(0,0,0,0.18)]
          group-hover:border-[#0033A1]/30
        "
      >
        {/* animated squiggles */}
        <WigglyLines seed={seed} />

        {/* foreground content */}
        <div
          className={
            flush
              ? "relative z-10 w-full h-full"
              : "relative z-10 w-full h-full flex items-center justify-center p-8"
          }
        >
          {children}
        </div>
      </div>

      <span className="text-[#272724] text-[13px] font-semibold tracking-[0.3em] uppercase group-hover:text-[#0033A1] transition-colors">
        {label}
      </span>
    </Link>
  );
}

/* 3D mylar-bag preview for the Calyx Preview card. Non-interactive so the
   click bubbles to the parent Link, auto-rotates for visual interest. */
function LandingBagPreview() {
  return (
    <div className="w-full h-full">
      <OutreachBagViewer
        textureUrl={null}
        interactive={false}
        autoRotate
      />
    </div>
  );
}

/* ───────────────────────────────────────────────────────────────
   Supplement jar illustration for the Outreach card
   ─────────────────────────────────────────────────────────────── */
function SupplementJarIllustration() {
  return (
    <svg
      viewBox="0 0 220 260"
      className="w-[70%] h-auto drop-shadow-[0_10px_24px_rgba(0,0,0,0.18)]"
    >
      <defs>
        <linearGradient id="jarBody" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#2a2d33" />
          <stop offset="50%" stopColor="#5a5f6b" />
          <stop offset="100%" stopColor="#2a2d33" />
        </linearGradient>
        <linearGradient id="jarLid" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#1a1d22" />
          <stop offset="100%" stopColor="#0d0f12" />
        </linearGradient>
        <linearGradient id="jarLabel" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#f8f5ee" />
          <stop offset="100%" stopColor="#e6e1d4" />
        </linearGradient>
      </defs>
      {/* lid */}
      <rect x="46" y="20" width="128" height="38" rx="6" fill="url(#jarLid)" />
      <rect x="46" y="52" width="128" height="4" fill="#000" opacity="0.3" />
      {/* body */}
      <rect x="38" y="58" width="144" height="180" rx="12" fill="url(#jarBody)" />
      {/* label */}
      <rect x="46" y="88" width="128" height="120" rx="2" fill="url(#jarLabel)" />
      {/* label content */}
      <rect x="64" y="104" width="92" height="3" rx="1.5" fill="#272724" opacity="0.6" />
      <circle cx="110" cy="142" r="22" fill="none" stroke="#0033A1" strokeWidth="2" />
      <path
        d="M100 142 l7 7 l14 -14"
        stroke="#0033A1"
        strokeWidth="2.4"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <rect x="72" y="178" width="76" height="4" rx="2" fill="#272724" opacity="0.5" />
      <rect x="82" y="190" width="56" height="3" rx="1.5" fill="#272724" opacity="0.35" />
    </svg>
  );
}

/* ───────────────────────────────────────────────────────────────
   Landing page
   ─────────────────────────────────────────────────────────────── */
export default function Landing() {
  return (
    <div className="relative w-full h-screen overflow-hidden bg-white flex flex-col">
      {/* Header */}
      <header className="flex-shrink-0 flex items-center justify-center px-8 h-[64px] border-b border-[#e8ecf2]">
        <Image
          src="/calyx-logo.svg"
          alt="Calyx Containers"
          width={140}
          height={37}
          priority
          style={{ height: 38, width: "auto" }}
        />
      </header>

      {/* Body */}
      <main className="flex-1 min-h-0 flex flex-col items-center justify-center px-8 py-10 overflow-y-auto">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-12 sm:gap-20 w-full max-w-[1100px]">
          <Card href="/calyx-preview" label="Calyx Preview" seed={1} flush>
            <LandingBagPreview />
          </Card>

          <Card href="/outreach" label="Outreach" seed={7}>
            <SupplementJarIllustration />
          </Card>
        </div>
      </main>

      {/* Footer */}
      <div className="flex-shrink-0 text-center pb-5 text-[10px] font-light tracking-[0.24em] uppercase text-[#272724]/25 select-none">
        Calyx Containers · Internal
      </div>
    </div>
  );
}
