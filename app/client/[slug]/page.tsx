"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import { use } from "react";
import { getBrandBySlug, listSetsForBrand } from "@/lib/brands";
import { supabaseConfigured } from "@/lib/supabase";
import type { Brand, ProductSet } from "@/lib/types";
import { ProductSlot, GallerySlot } from "@/components/OutreachSlot";
import ImagePreviewModal from "@/components/ImagePreviewModal";

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

  return (
    <div className="relative w-full h-screen overflow-hidden bg-white flex flex-col">
      {/* Centered logo header, no admin chrome */}
      <header className="flex-shrink-0 flex items-center justify-center px-8 h-[72px] border-b border-[#e8ecf2]">
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
      <main className="flex-1 min-h-0 overflow-y-auto px-8 py-12">
        <div className="max-w-[1100px] mx-auto">
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <div className="w-8 h-8 border-2 border-[#0033A1] border-t-transparent rounded-full animate-spin" />
            </div>
          ) : err ? (
            <p className="text-[12px] text-red-500 bg-red-50 rounded-lg p-4">
              {err}
            </p>
          ) : (
            <>
              {brand && (
                <div className="mb-10">
                  <p className="text-[9px] font-medium tracking-[0.24em] uppercase text-[#272724]/35 mb-2">
                    Presentation
                  </p>
                  <h1 className="text-[28px] leading-[1.15] font-light tracking-tight text-[#272724]">
                    {brand.name}
                  </h1>
                </div>
              )}

              {/* 3D slots row */}
              <section className="mb-14">
                <p className="text-[9px] font-medium tracking-[0.24em] uppercase text-[#272724]/35 mb-4">
                  Configured Products
                </p>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
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

              {/* Gallery grid */}
              <section className="pb-10">
                <p className="text-[9px] font-medium tracking-[0.24em] uppercase text-[#272724]/35 mb-4">
                  Gallery
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-4">
                  {Array.from({ length: 10 }, (_, i) => i + 1).map((i) => (
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
      <div className="flex-shrink-0 text-center pb-5 text-[10px] font-light tracking-[0.24em] uppercase text-[#272724]/35 select-none">
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
