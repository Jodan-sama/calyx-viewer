"use client";

import Image from "next/image";
import Link from "next/link";
import dynamic from "next/dynamic";
import WigglyLines from "@/components/WigglyLines";

// Lazy 3D previews — client-only (three.js)
const SPINNER = (
  <div className="w-full h-full flex items-center justify-center bg-[#eef1f8]">
    <div className="w-8 h-8 border-2 border-[#0033A1] border-t-transparent rounded-full animate-spin" />
  </div>
);

const OutreachBagViewer = dynamic(
  () => import("@/components/OutreachBagViewer"),
  { ssr: false, loading: () => SPINNER }
);

const OutreachJarViewer = dynamic(
  () => import("@/components/OutreachJarViewer"),
  { ssr: false, loading: () => SPINNER }
);

/* ───────────────────────────────────────────────────────────────
   Card — a translucent rounded panel that lets the page-wide wavy
   background read through. Cards are intentionally *not* given a
   solid fill so the squiggles flow continuously across the whole
   landing page rather than getting clipped by the card's bounds.
   ─────────────────────────────────────────────────────────────── */
function Card({
  href,
  label,
  children,
  flush = false,
}: {
  href: string;
  label: string;
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
          border border-[#272724]/10
          shadow-[0_1px_2px_rgba(0,0,0,0.04),0_12px_40px_-12px_rgba(0,0,0,0.12)]
          transition-all duration-300
          group-hover:-translate-y-1
          group-hover:shadow-[0_2px_4px_rgba(0,0,0,0.06),0_24px_60px_-12px_rgba(0,0,0,0.18)]
          group-hover:border-[#0033A1]/30
        "
      >
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
        transparent
      />
    </div>
  );
}

/* 3D supplement-jar preview for the Outreach card. Same posture as the bag
   preview — non-interactive (parent <Link> swallows clicks), auto-rotating
   for visual life. */
function LandingJarPreview() {
  return (
    <div className="w-full h-full">
      <OutreachJarViewer
        textureUrl={null}
        interactive={false}
        autoRotate
        transparent
      />
    </div>
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
      <main className="relative flex-1 min-h-0 flex flex-col items-center justify-center px-8 py-10 overflow-y-auto">
        {/* Page-wide squiggle background — spans the full main area, sits
            behind both option cards. Pointer events off so the cards stay
            clickable, and given a stable seed so the pattern doesn't shift
            between renders. */}
        <div className="absolute inset-0 pointer-events-none z-0">
          <WigglyLines seed={3} />
        </div>

        <div className="relative z-10 grid grid-cols-1 sm:grid-cols-2 gap-12 sm:gap-20 w-full max-w-[1100px]">
          <Card href="/calyx-preview" label="Calyx Preview" flush>
            <LandingBagPreview />
          </Card>

          <Card href="/outreach" label="Outreach" flush>
            <LandingJarPreview />
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
