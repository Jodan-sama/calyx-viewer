"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import { use } from "react";
import { getBrandBySlug, listSetsForBrand } from "@/lib/brands";
import { supabaseConfigured } from "@/lib/supabase";
import type { Brand, ProductSet } from "@/lib/types";
import {
  brandThemeVars,
  hexToRgba,
  resolveBrandColors,
} from "@/lib/brandTheme";
import { ProductSlot, GallerySlot } from "@/components/OutreachSlot";
import ImagePreviewModal from "@/components/ImagePreviewModal";
import FullscreenSlot from "@/components/FullscreenSlot";
import WigglyLines from "@/components/WigglyLines";
import LoadingOverlay from "@/components/LoadingOverlay";
import { useIsMobile } from "@/lib/useIsMobile";

export default function ClientSite({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = use(params);

  const [brand, setBrand] = useState<Brand | null>(null);
  const [sets, setSets] = useState<ProductSet[]>([]);
  const [loading, setLoading] = useState<boolean>(supabaseConfigured);
  const [err, setErr] = useState<string | null>(
    supabaseConfigured ? null : "Supabase not configured."
  );
  const [preview, setPreview] = useState<{ src: string; alt: string } | null>(
    null
  );
  // Full-screen 3D slot preview — set when the user clicks the Expand
  // affordance on a 3D hero tile. Cleared via the modal's close button,
  // Escape, or a click on the top/bottom chrome.
  const [fullscreenSet, setFullscreenSet] = useState<ProductSet | null>(null);

  // Gate hero rendering between the desktop 3-up grid and the mobile
  // single-slot carousel. CSS-only hiding with `hidden md:grid`
  // wouldn't work here — React still mounts whatever's inside the
  // hidden branch, so the 3 desktop Canvases would still spin up
  // WebGL contexts on phones. Conditional rendering ensures only the
  // tree we actually want renders.
  const isMobile = useIsMobile();

  useEffect(() => {
    if (!supabaseConfigured) return;
    let cancelled = false;
    (async () => {
      try {
        const b = await getBrandBySlug(slug);
        if (cancelled) return;
        if (!b) {
          setErr("Brand not found.");
          setLoading(false);
          return;
        }
        setBrand(b);
        const s = await listSetsForBrand(b.id);
        if (!cancelled) setSets(s);
      } catch (e: unknown) {
        if (!cancelled)
          setErr(e instanceof Error ? e.message : "Failed to load");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [slug]);

  const heroBySlot = useMemo(() => {
    const map = new Map<number, ProductSet>();
    for (const s of sets) if (s.section === "hero") map.set(s.slot, s);
    return map;
  }, [sets]);

  const gallBySlot = useMemo(() => {
    const map = new Map<number, ProductSet>();
    for (const s of sets) if (s.section === "gallery") map.set(s.slot, s);
    return map;
  }, [sets]);

  // Brand-scoped theme (primary = page bg gradient, secondary = accents)
  const colors = resolveBrandColors(brand);
  const themeVars = brandThemeVars(colors);
  // Wavy-line backdrop colour: brand accent at low opacity so the lines read
  // as ambient texture against the gradient rather than a pattern overlay.
  const wavyColor = hexToRgba(colors.secondary, 0.22);

  return (
    <div
      className="relative w-full h-screen overflow-hidden flex flex-col"
      style={{ ...themeVars, background: "var(--brand-primary-gradient)" }}
    >
      {/* Page-wide accent-colour wavy backdrop. Sits behind every layer of
          chrome via z-0; pointer-events off so all clicks fall through to
          the slots and gallery underneath. Re-mounted on accent change so
          the canvas re-paints with the new stroke colour. */}
      <div className="absolute inset-0 z-0 pointer-events-none">
        {/* logoRiders paints ~4 Calyx diamond icons riding specific
            waves — filled in the same secondary accent colour as the
            lines so they read as part of the ambient motion rather
            than a separate layer on top. Only enabled here (not on
            the landing page) since it's a brand-identity flourish
            that belongs on the outbound client site. */}
        <WigglyLines
          key={colors.secondary}
          seed={5}
          color={wavyColor}
          logoRiders={4}
          logoSize={36}
        />
      </div>

      {/* Centered logo header, no admin chrome */}
      <header className="relative z-10 flex-shrink-0 flex items-center justify-center px-8 h-[72px] border-b border-[#e8ecf2] bg-white/70 backdrop-blur-sm">
        <a
          href="tel:+17243037481"
          className="absolute left-1/4 -translate-x-1/2 text-[#101820] text-[8px] sm:text-xs lg:text-sm font-light tracking-[0.04em] sm:tracking-[0.14em] lg:tracking-[0.18em] hover:opacity-60 transition-opacity whitespace-nowrap"
        >
          724-303-7481
        </a>
        <Image
          src="/calyx-logo.svg"
          alt="Calyx Containers"
          width={160}
          height={42}
          priority
          className="h-4 sm:h-7 lg:h-[42px] w-auto"
        />
        <a
          href="mailto:info@calyxcontainers.com"
          className="absolute left-3/4 -translate-x-1/2 text-[#101820] text-[8px] sm:text-xs lg:text-sm font-light tracking-[0.04em] sm:tracking-[0.14em] lg:tracking-[0.18em] hover:opacity-60 transition-opacity whitespace-nowrap"
        >
          info@calyxcontainers.com
        </a>
      </header>

      {/* Body */}
      <main className="relative z-10 flex-1 min-h-0 overflow-y-auto px-6 sm:px-10 py-12">
        {/* Wider container: hero slots are intentionally near full-width on
            desktop. The 1480px cap keeps very wide monitors from blowing the
            slots up to mural-size while still letting them dominate at typical
            laptop widths. */}
        <div className="max-w-[1480px] mx-auto">
          {loading ? (
            // Dedicated LoadingOverlay below covers the whole viewport
            // while brand + sets hydrate, so the in-main spacer just
            // reserves vertical space to keep the layout stable.
            <div className="py-20" />
          ) : err ? (
            <p className="text-[12px] text-red-500 bg-red-50 rounded-lg p-4">
              {err}
            </p>
          ) : (
            <>
              {/* Centred brand-logo header above the hero row on every
                  breakpoint. 120px is reserved so the layout stays
                  stable while the logo image decodes. */}
              <div className="mb-8 md:mb-12 flex items-center justify-center min-h-[120px]">
                {brand?.logo_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={brand.logo_url}
                    alt={brand.name}
                    className="max-h-[120px] w-auto object-contain select-none"
                    draggable={false}
                  />
                ) : (
                  <div className="h-[120px] aspect-[3/1] max-w-[360px] w-full rounded-xl border border-dashed border-[#272724]/15 flex items-center justify-center">
                    <span className="text-[10px] tracking-[0.24em] uppercase text-[#272724]/30 select-none">
                      Brand Logo
                    </span>
                  </div>
                )}
              </div>

              {/* Hero 3D slots.
                  Desktop (md+): 2-up grid on tablet, 3-up row on large.
                    Each slot mounts its own Canvas — desktop has the
                    memory headroom for all three to run live.
                  Mobile (<md): ONE slot at a time as a big card, with
                    arrow controls to cycle through the other two. Only
                    the active slot mounts a WebGL context, which is the
                    only reliable way to keep iOS Safari from OOM-ing on
                    a page full of 3D models.
                  Picked via a JS conditional (not CSS `hidden`) so the
                  un-shown tree never mounts and never spins up unused
                  WebGL contexts. */}
              <section className="mb-16">
                {isMobile ? (
                  <MobileHeroCarousel
                    heroBySlot={heroBySlot}
                    onOpenImage={(src, alt) => setPreview({ src, alt })}
                    onExpand={(s) => setFullscreenSet(s)}
                  />
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 lg:gap-8">
                    {[1, 2, 3].map((i) => (
                      <ProductSlot
                        key={i}
                        index={i}
                        set={heroBySlot.get(i)}
                        onOpenImage={(src, alt) => setPreview({ src, alt })}
                        onExpand={(s) => setFullscreenSet(s)}
                      />
                    ))}
                  </div>
                )}
              </section>

              {/* Digital Previews grid — 3 columns on mobile per the
                  brief (was 1); scales up to 4 on desktop. Each tile is
                  a flat image so no 3D cost per slot regardless of
                  column count. */}
              <section className="pb-10">
                <p className="text-[9px] font-medium tracking-[0.24em] uppercase text-[#272724]/35 mb-4">
                  Digital Previews
                </p>
                <div className="grid grid-cols-3 md:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4 md:gap-6">
                  {Array.from({ length: 8 }, (_, i) => i + 1).map((i) => (
                    <GallerySlot
                      key={i}
                      index={i}
                      set={gallBySlot.get(i)}
                      onOpenImage={(src, alt) => setPreview({ src, alt })}
                    />
                  ))}
                </div>
              </section>
            </>
          )}
        </div>
      </main>

      {/* Footer — brand name */}
      <div className="relative z-10 flex-shrink-0 text-center pb-5 text-[10px] font-light tracking-[0.24em] uppercase text-[#272724]/35 select-none">
        {brand ? brand.name : "Calyx Containers"}
      </div>

      {preview && (
        <ImagePreviewModal
          src={preview.src}
          alt={preview.alt}
          onClose={() => setPreview(null)}
        />
      )}

      {fullscreenSet && (
        <FullscreenSlot
          set={fullscreenSet}
          onClose={() => setFullscreenSet(null)}
        />
      )}

      {/* Intro cover — fixed Calyx-blue palette (not brand-derived) so
          every client site opens on the same moment of recognition
          before per-brand theming takes over. Stays up for at least 3
          seconds to give assets a predictable decode window. */}
      <LoadingOverlay loading={loading} />
    </div>
  );
}

/**
 * Mobile-only carousel for the client hero section. Renders ONE
 * ProductSlot at a time with left/right arrow controls and dot
 * indicators. The `key={current}` on the rendered ProductSlot forces
 * React to unmount the outgoing slot's Canvas when the user taps an
 * arrow — so only one live WebGL context exists at any moment, which
 * is the only layout that reliably survives iOS Safari's per-tab
 * memory ceiling on the client surface.
 *
 * Empty slots (no saved set) still cycle through the carousel so the
 * indicator reflects the page's three-slot structure; the empty-state
 * placeholder renders inside ProductSlot.
 */
function MobileHeroCarousel({
  heroBySlot,
  onOpenImage,
  onExpand,
}: {
  heroBySlot: Map<number, ProductSet>;
  onOpenImage: (src: string, alt: string) => void;
  onExpand: (set: ProductSet) => void;
}) {
  const [activeIndex, setActiveIndex] = useState(0);
  const SLOT_INDICES = [1, 2, 3] as const;
  const currentSlotNumber = SLOT_INDICES[activeIndex];
  const currentSet = heroBySlot.get(currentSlotNumber);

  const prev = () =>
    setActiveIndex((i) => (i - 1 + SLOT_INDICES.length) % SLOT_INDICES.length);
  const next = () =>
    setActiveIndex((i) => (i + 1) % SLOT_INDICES.length);

  return (
    <div className="relative w-full max-w-md mx-auto">
      {/* Active slot. `key` forces a remount when the index changes so
          the previous Canvas is torn down and its WebGL context
          released before the next one mounts. */}
      <ProductSlot
        key={currentSlotNumber}
        index={currentSlotNumber}
        set={currentSet}
        onOpenImage={onOpenImage}
        onExpand={onExpand}
      />

      {/* Left / right arrows — positioned at the tile edges so they're
          easy to thumb-tap without covering the product. z-index sits
          above the tile's group-hover overlays. */}
      <button
        type="button"
        onClick={prev}
        aria-label="Previous product"
        className="absolute left-2 top-1/2 -translate-y-1/2 z-20 w-10 h-10 rounded-full bg-white/85 backdrop-blur-sm text-[#272724] flex items-center justify-center shadow-[0_1px_4px_rgba(0,0,0,0.08)] active:scale-95 transition"
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
          <path d="M10.5 3L5 8l5.5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <button
        type="button"
        onClick={next}
        aria-label="Next product"
        className="absolute right-2 top-1/2 -translate-y-1/2 z-20 w-10 h-10 rounded-full bg-white/85 backdrop-blur-sm text-[#272724] flex items-center justify-center shadow-[0_1px_4px_rgba(0,0,0,0.08)] active:scale-95 transition"
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
          <path d="M5.5 3L11 8l-5.5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {/* Dot indicator below the tile — taps jump directly to that
          slot. Active dot is filled; inactives are faint so the
          active position reads at a glance. */}
      <div className="flex gap-2 justify-center mt-4">
        {SLOT_INDICES.map((slot, idx) => (
          <button
            key={slot}
            type="button"
            onClick={() => setActiveIndex(idx)}
            aria-label={`Go to product ${slot}`}
            className={`h-2 rounded-full transition-all ${
              idx === activeIndex
                ? "w-6 bg-[#272724]"
                : "w-2 bg-[#272724]/25 hover:bg-[#272724]/40"
            }`}
          />
        ))}
      </div>
    </div>
  );
}
