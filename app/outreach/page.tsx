"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  listBrands,
  listSetsForBrand,
  updateBrandColors,
  updateBrandLogo,
} from "@/lib/brands";
import { supabaseConfigured, uploadBrandLogo } from "@/lib/supabase";
import type { Brand, ProductSet } from "@/lib/types";
import {
  brandThemeVars,
  DEFAULT_PRIMARY,
  DEFAULT_SECONDARY,
  resolveBrandColors,
} from "@/lib/brandTheme";
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
      : "Supabase not configured. Add NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_ANON_KEY to your environment."
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

  // ── Brand theme (primary/secondary) ────────────────────────────────────────
  const colors = resolveBrandColors(selectedBrand);
  const themeVars = brandThemeVars(colors);

  // Debounced color save — optimistic UI update happens in handleColorChange
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  const handleColorChange = useCallback(
    (field: "primary_color" | "secondary_color", value: string) => {
      if (!selectedBrand) return;
      const brandId = selectedBrand.id;

      // Optimistic: patch the brand in local state so the UI previews
      // the color instantly without waiting for the round-trip.
      setBrands((prev) =>
        prev.map((b) => (b.id === brandId ? { ...b, [field]: value } : b))
      );

      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        updateBrandColors(brandId, { [field]: value }).catch((e) => {
          setErr(e instanceof Error ? e.message : "Color save failed");
        });
      }, 400);
    },
    [selectedBrand]
  );

  // ── Brand logo upload ─────────────────────────────────────────────────────
  const [logoUploading, setLogoUploading] = useState(false);

  const handleLogoUpload = useCallback(
    async (file: File) => {
      if (!selectedBrand) return;
      const brandId = selectedBrand.id;
      setLogoUploading(true);
      setErr(null);
      try {
        const url = await uploadBrandLogo(file, selectedBrand.slug, file.name);
        await updateBrandLogo(brandId, url);
        // Optimistically reflect the new logo locally so the preview swaps
        // immediately without a refetch.
        setBrands((prev) =>
          prev.map((b) => (b.id === brandId ? { ...b, logo_url: url } : b))
        );
      } catch (e: unknown) {
        setErr(e instanceof Error ? e.message : "Logo upload failed");
      } finally {
        setLogoUploading(false);
      }
    },
    [selectedBrand]
  );

  const handleLogoRemove = useCallback(async () => {
    if (!selectedBrand) return;
    const brandId = selectedBrand.id;
    try {
      await updateBrandLogo(brandId, null);
      setBrands((prev) =>
        prev.map((b) => (b.id === brandId ? { ...b, logo_url: null } : b))
      );
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Logo remove failed");
    }
  }, [selectedBrand]);

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
    <div
      className="relative w-full h-screen overflow-hidden flex flex-col"
      style={{ ...themeVars, background: "var(--brand-primary)" }}
    >
      {/* Header */}
      <header className="flex-shrink-0 flex items-center justify-between px-8 h-[64px] border-b border-[#e8ecf2] bg-white/70 backdrop-blur-sm">
        <Link href="/" className="flex items-center gap-3 group">
          <svg
            width="14"
            height="14"
            viewBox="0 0 14 14"
            fill="none"
            className="text-[#272724]/50 transition-colors"
            style={{ color: "var(--brand-secondary)" }}
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
      <main className="flex-1 min-h-0 overflow-y-auto px-6 sm:px-10 py-10">
        {/* Wider container so the admin preview matches the client-site
            scale — hero slots can stretch close to full-width on big monitors
            and shrink down with the viewport. */}
        <div className="max-w-[1480px] mx-auto">
          {/* Brand selector + theme pickers + client-site generator */}
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
                    className="hover:underline"
                    style={{ color: "var(--brand-secondary)" }}
                  >
                    Calyx Preview
                  </Link>
                  .
                </p>
              ) : (
                <select
                  value={selectedBrandId}
                  onChange={(e) => handleBrandChange(e.target.value)}
                  className="h-10 pl-3 pr-8 rounded-lg border border-[#e8ecf2] text-[13px] bg-white focus:outline-none min-w-[220px]"
                  style={{ outlineColor: "var(--brand-secondary)" }}
                >
                  {brands.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              )}
            </div>

            {/* Theme pickers + brand logo */}
            {selectedBrand && (
              <div className="flex items-end gap-5">
                <BrandLogoField
                  logoUrl={selectedBrand.logo_url}
                  uploading={logoUploading}
                  onUpload={handleLogoUpload}
                  onRemove={handleLogoRemove}
                />
                <ColorPickerField
                  label="Primary"
                  value={selectedBrand.primary_color || DEFAULT_PRIMARY}
                  onChange={(v) => handleColorChange("primary_color", v)}
                />
                <ColorPickerField
                  label="Secondary"
                  value={selectedBrand.secondary_color || DEFAULT_SECONDARY}
                  onChange={(v) => handleColorChange("secondary_color", v)}
                />
              </div>
            )}

            {/* Client site */}
            {selectedBrand && (
              <div className="flex flex-col items-end gap-2">
                {clientSiteOpen && (
                  <div className="flex items-center gap-2 text-[11px]">
                    <a
                      href={clientUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="font-mono underline underline-offset-4 decoration-dotted max-w-[420px] truncate"
                      title={clientUrl}
                      style={{ color: "var(--brand-secondary)" }}
                    >
                      {clientUrl}
                    </a>
                    <button
                      type="button"
                      onClick={handleCopyUrl}
                      className="text-[10px] font-semibold tracking-[0.14em] uppercase text-[#272724]/55 transition hover:[color:var(--brand-secondary)]"
                    >
                      {copied ? "Copied!" : "Copy"}
                    </button>
                  </div>
                )}
                <button
                  type="button"
                  onClick={handleGenerateOrUpdate}
                  className="h-10 px-5 rounded-full text-[11px] font-semibold tracking-[0.14em] uppercase text-white transition-all active:scale-95 hover:brightness-90"
                  style={{ backgroundColor: "var(--brand-secondary)" }}
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

          {/* Hero slots (3D / Magic) — full-width, 3-up on desktop, shrinks
              gracefully on smaller viewports. Mirrors the client-site layout
              so what the admin sees is what they ship. */}
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

          {/* Digital Previews — bigger tiles, fewer columns at each breakpoint. */}
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

/* ───────── Brand-logo upload field ─────────
   Sits next to the colour pickers in the brand row. Acts as a drop-in for a
   colour picker visually (same height, same label cap) but shows the active
   logo as a thumbnail with `object-contain` so the original aspect ratio is
   always preserved — never stretched. */
function BrandLogoField({
  logoUrl,
  uploading,
  onUpload,
  onRemove,
}: {
  logoUrl: string | null;
  uploading: boolean;
  onUpload: (file: File) => void;
  onRemove: () => void;
}) {
  return (
    <div className="flex flex-col gap-2 select-none">
      <span className="text-[9px] font-medium tracking-[0.24em] uppercase text-[#272724]/35">
        Logo
      </span>
      <div className="flex items-center gap-2 h-10 pl-2 pr-2 rounded-lg border border-[#e8ecf2] bg-white">
        {/* Thumbnail / placeholder. Square frame so a wide or tall logo both
            sit centered without stretching; object-contain keeps the natural
            aspect ratio inside the box. */}
        <div className="w-7 h-7 rounded-md border border-[#e8ecf2] bg-[#f5f7fb] overflow-hidden flex items-center justify-center">
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={logoUrl}
              alt="Brand logo"
              className="w-full h-full object-contain"
              draggable={false}
            />
          ) : (
            <span className="text-[#272724]/30 text-[10px] font-semibold">
              ?
            </span>
          )}
        </div>

        {/* Upload trigger — file input is hidden, label is the click target.
            Uses key={logoUrl} on the input so re-uploading the same filename
            still fires onChange. */}
        <label className="cursor-pointer text-[10px] font-semibold tracking-[0.14em] uppercase text-[#272724]/55 hover:[color:var(--brand-secondary)] transition">
          {uploading ? "Uploading…" : logoUrl ? "Replace" : "Upload"}
          <input
            key={logoUrl ?? "empty"}
            type="file"
            accept="image/png,image/jpeg,image/svg+xml,image/webp"
            className="hidden"
            disabled={uploading}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onUpload(f);
            }}
          />
        </label>

        {logoUrl && !uploading && (
          <button
            type="button"
            onClick={onRemove}
            className="text-[10px] font-semibold tracking-[0.14em] uppercase text-[#272724]/35 hover:text-red-500 transition"
            title="Remove logo"
          >
            ×
          </button>
        )}
      </div>
    </div>
  );
}

/* ───────── Compact color-picker field ───────── */
function ColorPickerField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex flex-col gap-2 select-none">
      <span className="text-[9px] font-medium tracking-[0.24em] uppercase text-[#272724]/35">
        {label}
      </span>
      <span className="flex items-center gap-2 h-10 pl-2 pr-3 rounded-lg border border-[#e8ecf2] bg-white">
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-7 h-7 rounded-md border border-[#e8ecf2] bg-transparent cursor-pointer appearance-none"
          style={{ padding: 0 }}
          aria-label={`${label} color`}
        />
        <span className="font-mono text-[11px] text-[#272724]/70 tracking-tight">
          {value.toUpperCase()}
        </span>
      </span>
    </label>
  );
}
