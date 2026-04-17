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
import WigglyLines from "@/components/WigglyLines";

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
        <Image
          src="/calyx-logo.svg"
          alt="Calyx Containers"
          width={160}
          height={42}
          priority
          style={{ height: 42, width: "auto" }}
        />
      </header>

      {/* Body */}
      <main className="relative z-10 flex-1 min-h-0 overflow-y-auto px-6 sm:px-10 py-12">
        {/* Wider container: hero slots are intentionally near full-width on
            desktop. The 1480px cap keeps very wide monitors from blowing the
            slots up to mural-size while still letting them dominate at typical
            laptop widths. */}
        <div className="max-w-[1480px] mx-auto">
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <div
                className="w-8 h-8 border-2 border-t-transparent rounded-full animate-spin"
                style={{ borderColor: "var(--brand-secondary)", borderTopColor: "transparent" }}
              />
            </div>
          ) : err ? (
            <p className="text-[12px] text-red-500 bg-red-50 rounded-lg p-4">
              {err}
            </p>
          ) : (
            <>
              {/* Centered brand-logo slot. Always reserves vertical space so
                  the layout is stable while a logo is being uploaded; renders
                  a subtle dashed placeholder when no logo is set. The image
                  uses object-contain + auto-width so the original aspect
                  ratio is always preserved — never stretches to fill. */}
              <div className="mb-12 flex items-center justify-center min-h-[120px]">
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

              {/* 3D slots row — full-width on desktop, stacks to 2-up on
                  tablets, 1-up on phones. Slot tiles intrinsically size to
                  the available column, so they shrink with the screen. */}
              <section className="mb-16">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 lg:gap-8">
                  {[1, 2, 3].map((i) => (
                    <ProductSlot
                      key={i}
                      index={i}
                      set={heroBySlot.get(i)}
                      onOpenImage={(src, alt) => setPreview({ src, alt })}
                    />
                  ))}
                </div>
              </section>

              {/* Digital Previews grid — fewer columns at each breakpoint so
                  each square is bigger. Caps at 4 columns on widest screens. */}
              <section className="pb-10">
                <p className="text-[9px] font-medium tracking-[0.24em] uppercase text-[#272724]/35 mb-4">
                  Digital Previews
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
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
    </div>
  );
}
