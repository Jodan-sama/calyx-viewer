"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { listBrands, listSetsForBrand } from "@/lib/brands";
import { supabaseConfigured } from "@/lib/supabase";
import type { Brand, ProductSet } from "@/lib/types";
import ImagePreviewModal from "@/components/ImagePreviewModal";
import { ProductSlot, GallerySlot } from "@/components/OutreachSlot";

/* ───────── Page ───────── */

export default function Outreach() {
  const [brands, setBrands] = useState<Brand[]>([]);
  const [selectedBrandId, setSelectedBrandId] = useState<string>("");
  const [sets, setSets] = useState<ProductSet[]>([]);
  const [preview, setPreview] = useState<{ src: string; alt: string } | null>(
    null
  );
  const [loading, setLoading] = useState<boolean>(supabaseConfigured);
  const [err, setErr] = useState<string | null>(
    supabaseConfigured
      ? null
      : "Supabase not configured. Add NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_ANON_KEY to .env.local."
  );
  const [clientSiteOpen, setClientSiteOpen] = useState(false);
  const [clientVersion, setClientVersion] = useState(0);
  const [copied, setCopied] = useState(false);

  // Initial brand fetch
  useEffect(() => {
    if (!supabaseConfigured) return;
    let cancelled = false;
    listBrands()
      .then((list) => {
        if (cancelled) return;
        setBrands(list);
        if (list.length > 0) setSelectedBrandId(list[0].id);
      })
      .catch((e) => {
        if (!cancelled) setErr(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // When selected brand changes, load its sets
  useEffect(() => {
    if (!selectedBrandId) return;
    let cancelled = false;
    listSetsForBrand(selectedBrandId)
      .then((s) => {
        if (!cancelled) setSets(s);
      })
      .catch((e) => {
        if (!cancelled) setErr(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedBrandId]);

  const handleBrandChange = useCallback((id: string) => {
    setSelectedBrandId(id);
    // Reset client-site reveal state when the selection changes
    setClientSiteOpen(false);
    setClientVersion(0);
    setCopied(false);
  }, []);

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

  const selectedBrand = useMemo(
    () => brands.find((b) => b.id === selectedBrandId) ?? null,
    [brands, selectedBrandId]
  );

  const clientOrigin =
    typeof window !== "undefined" ? window.location.origin : "";
  const clientUrl = selectedBrand
    ? `${clientOrigin}/client/${selectedBrand.slug}${
        clientVersion > 0 ? `?v=${clientVersion}` : ""
      }`
    : "";

  const handleGenerateOrUpdate = useCallback(async () => {
    if (!selectedBrandId) return;
    // Always re-fetch assets so the admin mirrors what the live client site shows
    try {
      const fresh = await listSetsForBrand(selectedBrandId);
      setSets(fresh);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Refresh failed");
    }
    setClientSiteOpen(true);
    setClientVersion((v) => v + 1);
    setCopied(false);
  }, [selectedBrandId]);

  const handleCopyUrl = useCallback(async () => {
    if (!clientUrl) return;
    try {
      await navigator.clipboard.writeText(clientUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore — user can still copy manually
    }
  }, [clientUrl]);

  return (
    <div className="relative w-full h-screen overflow-hidden bg-white flex flex-col">
      {/* Header */}
      <header className="flex-shrink-0 flex items-center justify-between px-8 h-[64px] border-b border-[#e8ecf2]">
        <Link href="/" className="flex items-center gap-3 group">
          <svg
            width="14"
            height="14"
            viewBox="0 0 14 14"
            fill="none"
            className="text-[#272724]/50 group-hover:text-[#0033A1] transition-colors"
          >
            <path
              d="M9 2L4 7l5 5"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <Image
            src="/calyx-logo.svg"
            alt="Calyx Containers"
            width={140}
            height={37}
            priority
            style={{ height: 38, width: "auto" }}
          />
        </Link>
        <span className="text-[#272724]/40 text-[11px] font-medium tracking-[0.24em] uppercase select-none">
          Outreach
        </span>
        <div className="w-[140px]" />
      </header>

      {/* Body */}
      <main className="flex-1 min-h-0 overflow-y-auto px-8 py-10">
        <div className="max-w-[1100px] mx-auto">
          {/* Brand selector + Client-site generator */}
          <div className="mb-10 flex items-end justify-between flex-wrap gap-6">
            <div>
              <p className="text-[9px] font-medium tracking-[0.24em] uppercase text-[#272724]/35 mb-2">
                Brand
              </p>
              {loading ? (
                <p className="text-[13px] text-[#272724]/40">Loading…</p>
              ) : brands.length === 0 ? (
                <p className="text-[13px] text-[#272724]/50">
                  No brands yet — save one from{" "}
                  <Link
                    href="/calyx-preview"
                    className="text-[#0033A1] hover:underline"
                  >
                    Calyx Preview
                  </Link>
                  .
                </p>
              ) : (
                <select
                  value={selectedBrandId}
                  onChange={(e) => handleBrandChange(e.target.value)}
                  className="h-10 pl-3 pr-8 rounded-lg border border-[#e8ecf2] text-[13px] bg-white focus:outline-none focus:border-[#0033A1] min-w-[220px]"
                >
                  {brands.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              )}
            </div>

            {/* Client site */}
            {selectedBrand && (
              <div className="flex flex-col items-end gap-2">
                {clientSiteOpen && (
                  <div className="flex items-center gap-2 text-[11px]">
                    <a
                      href={clientUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="font-mono text-[#0033A1] hover:text-[#001F60] underline underline-offset-4 decoration-dotted max-w-[420px] truncate"
                      title={clientUrl}
                    >
                      {clientUrl}
                    </a>
                    <button
                      type="button"
                      onClick={handleCopyUrl}
                      className="text-[10px] font-semibold tracking-[0.14em] uppercase text-[#272724]/55 hover:text-[#0033A1] transition"
                    >
                      {copied ? "Copied!" : "Copy"}
                    </button>
                  </div>
                )}
                <button
                  type="button"
                  onClick={handleGenerateOrUpdate}
                  className="h-10 px-5 rounded-full text-[11px] font-semibold tracking-[0.14em] uppercase text-white bg-[#0033A1] hover:bg-[#001F60] transition-all active:scale-95"
                >
                  {clientSiteOpen ? "Update Client URL" : "Generate Client Site"}
                </button>
              </div>
            )}
          </div>

          {err && (
            <p className="text-[11px] text-red-500 bg-red-50 rounded-lg p-3 mb-6">
              {err}
            </p>
          )}

          {/* Hero slots (3D / Magic) */}
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

          {/* Gallery */}
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
        </div>
      </main>

      {/* Footer */}
      <div className="flex-shrink-0 text-center pb-5 text-[10px] font-light tracking-[0.24em] uppercase text-[#272724]/25 select-none">
        Calyx Containers · Outreach
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
