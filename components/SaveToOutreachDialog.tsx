"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  getOrCreateBrand,
  listBrands,
  listSetsForBrand,
  saveSet,
} from "@/lib/brands";
import { uploadLabel, uploadPreview, supabaseConfigured } from "@/lib/supabase";
import type { Brand, ProductSet, ProductSetKind, SceneEnvironment } from "@/lib/types";
import type { BagMaterial } from "@/lib/bagMaterial";

/**
 * The dialog accepts a polymorphic "source":
 *  - bag-3d: a raw label image File — rendered on the 3D model in Outreach.
 *    `productType` hints which model (mylar bag vs supplement jar) was being
 *    previewed when the user clicked save, so the slot can render the right
 *    geometry. Carries the current material/lighting config so Outreach can
 *    faithfully reproduce the look at save time.
 *  - flat-image: a pre-rendered image blob (e.g. Make Magic output) — shown flat.
 */
export type SaveSource =
  | {
      kind: "bag-3d";
      file: File;
      /** Layer 2 back (bag) or Layer 3 (jar). Uploaded alongside the
       *  primary front image; resulting URL lands in
       *  `material.backImageUrl`. */
      backFile?: File | null;
      /** Bag Layer 3 front — ignored for jar saves. Resulting URL lands
       *  in `material.layer3FrontImageUrl`. */
      layer3FrontFile?: File | null;
      /** Bag Layer 3 back — ignored for jar saves. Resulting URL lands
       *  in `material.layer3BackImageUrl`. */
      layer3BackFile?: File | null;
      material: BagMaterial;
      productType?: ProductSet["product_type"];
      environment?: SceneEnvironment;
      /** Data URL of the current 3D viewer screenshot (PNG). When
       *  provided the dialog downscales it to ~400px JPEG and saves it
       *  as the slot's `preview_image_url`, so the slot picker thereafter
       *  shows the rendered packaging (materials + lighting + env)
       *  instead of the raw label artwork. Optional — absent → the
       *  label image doubles as the thumbnail, same as before. */
      previewDataUrl?: string;
    }
  | { kind: "flat-image"; blob: Blob; filename: string };

/** Downscale a PNG data URL to a small JPEG blob suitable for use as a
 *  slot-picker thumbnail. Caps the longest edge at `maxDim` and
 *  re-encodes at `quality` — typically lands well under 50KB. Runs in
 *  the browser; no-op (returns null) in environments without a DOM. */
async function downsampleToJpegBlob(
  dataUrl: string,
  maxDim = 400,
  quality = 0.78
): Promise<Blob | null> {
  if (typeof document === "undefined") return null;
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = reject;
    el.src = dataUrl;
  });
  const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, w, h);
  return new Promise<Blob | null>((resolve) => {
    canvas.toBlob((b) => resolve(b), "image/jpeg", quality);
  });
}

type Props = {
  source: SaveSource | null;
  onClose: () => void;
  onSaved?: (set: ProductSet) => void;
};

export default function SaveToOutreachDialog({
  source,
  onClose,
  onSaved,
}: Props) {
  const [brands, setBrands] = useState<Brand[]>([]);
  const [loadingBrands, setLoadingBrands] = useState(true);
  const [brandMode, setBrandMode] = useState<"existing" | "new">("existing");
  const [selectedBrandId, setSelectedBrandId] = useState<string>("");
  const [newBrandName, setNewBrandName] = useState("");
  const [title, setTitle] = useState("");
  const [slot, setSlot] = useState<number>(1);
  const [productType, setProductType] = useState<ProductSet["product_type"]>(
    source?.kind === "bag-3d" && source.productType
      ? source.productType
      : "mylar-bag"
  );

  // Keep productType in sync if the source changes while the dialog is mounted
  // (e.g. user reopens it for a different model without unmounting first).
  useEffect(() => {
    if (source?.kind === "bag-3d" && source.productType) {
      setProductType(source.productType);
    }
  }, [source]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Existing sets for the currently-selected brand, indexed by
  // "<section>:<slot>" so the slot grid can render each button with a
  // live thumbnail of whatever is already occupying that cell. Prevents
  // accidental overwrites by making "this slot is already taken" visible
  // before the save button is clicked.
  const [existingSets, setExistingSets] = useState<ProductSet[]>([]);

  const kind: ProductSetKind = source?.kind ?? "bag-3d";
  const section: "hero" | "gallery" =
    kind === "flat-image" ? "gallery" : "hero";
  const maxSlot = section === "hero" ? 3 : 8;

  // Map existing sets in the active section to their slot number so the
  // grid can look them up in O(1). Keyed inside the dialog by section so
  // flat-image vs 3D slots never collide.
  const occupiedBySlot = useMemo(() => {
    const map = new Map<number, ProductSet>();
    for (const s of existingSets) {
      if (s.section === section) map.set(s.slot, s);
    }
    return map;
  }, [existingSets, section]);

  useEffect(() => {
    if (!supabaseConfigured) {
      setLoadingBrands(false);
      return;
    }
    listBrands()
      .then((list) => {
        setBrands(list);
        if (list.length > 0) setSelectedBrandId(list[0].id);
        else setBrandMode("new");
      })
      .catch((e) => setErr(e.message))
      .finally(() => setLoadingBrands(false));
  }, []);

  // Re-fetch the selected brand's existing sets whenever the active brand
  // (or mode) changes, so the slot grid's thumbnails always reflect the
  // live state of that brand's Outreach page. `cancelled` prevents races
  // if the user flips brands quickly. We deliberately skip the fetch
  // when the user is creating a new brand — a brand-new brand can't
  // have any existing sets.
  useEffect(() => {
    if (!supabaseConfigured) return;
    if (brandMode !== "existing" || !selectedBrandId) {
      setExistingSets([]);
      return;
    }
    let cancelled = false;
    listSetsForBrand(selectedBrandId)
      .then((sets) => {
        if (!cancelled) setExistingSets(sets);
      })
      .catch(() => {
        // Swallow — showing the dialog without thumbnails is still useful.
        if (!cancelled) setExistingSets([]);
      });
    return () => {
      cancelled = true;
    };
  }, [brandMode, selectedBrandId]);

  const canSubmit =
    !!source &&
    !!title.trim() &&
    (brandMode === "existing" ? !!selectedBrandId : !!newBrandName.trim());

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!source || saving) return;
      setSaving(true);
      setErr(null);
      try {
        const brand =
          brandMode === "existing"
            ? brands.find((b) => b.id === selectedBrandId)!
            : await getOrCreateBrand(newBrandName.trim());

        const blob =
          source.kind === "bag-3d" ? source.file : source.blob;
        const filename =
          source.kind === "bag-3d" ? source.file.name : source.filename;

        const label_image_url = await uploadLabel(blob, brand.slug, filename);

        // Upload every secondary artwork the user configured so material
        // round-trips through the slot without losing textures. Each
        // upload is gated on a non-null File — the page only sets these
        // when the user actually uploads that layer. URLs land back on
        // a cloned material object so we don't mutate the page's ref.
        let persistedMaterial: BagMaterial | null = null;
        if (source.kind === "bag-3d") {
          persistedMaterial = { ...source.material };
          if (source.backFile) {
            persistedMaterial.backImageUrl = await uploadLabel(
              source.backFile,
              brand.slug,
              source.backFile.name
            );
          }
          if (source.layer3FrontFile) {
            persistedMaterial.layer3FrontImageUrl = await uploadLabel(
              source.layer3FrontFile,
              brand.slug,
              source.layer3FrontFile.name
            );
          }
          if (source.layer3BackFile) {
            persistedMaterial.layer3BackImageUrl = await uploadLabel(
              source.layer3BackFile,
              brand.slug,
              source.layer3BackFile.name
            );
          }
        }

        // Upload a downscaled 3D render preview when one was provided.
        // For flat-image sources there's nothing to downscale (the blob
        // IS the final image), and for 3D sources where the viewer
        // hasn't captured yet, we skip — saveSet falls back to using
        // the label image as the thumbnail. Any failure here is
        // non-fatal — the main save still succeeds without a preview.
        let preview_image_url: string | undefined = undefined;
        if (source.kind === "bag-3d" && source.previewDataUrl) {
          try {
            const previewBlob = await downsampleToJpegBlob(
              source.previewDataUrl
            );
            if (previewBlob) {
              preview_image_url = await uploadPreview(
                previewBlob,
                brand.slug,
                "render.jpg"
              );
            }
          } catch (pe) {
            // eslint-disable-next-line no-console
            console.warn("[calyx] preview upload failed — continuing without:", pe);
          }
        }

        const set = await saveSet({
          brand_id: brand.id,
          section,
          slot,
          kind: source.kind,
          title: title.trim(),
          product_type: productType,
          label_image_url,
          material: persistedMaterial,
          environment: source.kind === "bag-3d" ? source.environment ?? "default" : "default",
          preview_image_url,
        });
        onSaved?.(set);
        onClose();
      } catch (e: unknown) {
        setErr(e instanceof Error ? e.message : "Save failed");
      } finally {
        setSaving(false);
      }
    },
    [
      source,
      saving,
      brandMode,
      brands,
      selectedBrandId,
      newBrandName,
      section,
      slot,
      title,
      productType,
      onClose,
      onSaved,
    ]
  );

  // Reset slot when switching sections (hero max=3, gallery max=8)
  useEffect(() => {
    setSlot(1);
  }, [section]);

  const dialogTitle =
    kind === "flat-image" ? "Save Magic to Outreach" : "Save to Outreach";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <form
        onSubmit={handleSubmit}
        className="w-[420px] max-w-[92vw] bg-white rounded-2xl shadow-2xl border border-[#e8ecf2] p-7 space-y-5"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-[14px] font-semibold tracking-[0.2em] uppercase text-[#272724]">
            {dialogTitle}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-[#272724]/40 hover:text-[#272724] text-lg leading-none"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {!supabaseConfigured && (
          <p className="text-[11px] text-red-500 bg-red-50 rounded-lg p-3 leading-relaxed">
            Supabase env vars missing. Add <code>NEXT_PUBLIC_SUPABASE_URL</code>
            &nbsp;and <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> to{" "}
            <code>.env.local</code> and restart the dev server.
          </p>
        )}

        {!source && (
          <p className="text-[11px] text-amber-600 bg-amber-50 rounded-lg p-3 leading-relaxed">
            Nothing to save yet.
          </p>
        )}

        {/* Mode badge */}
        <div className="flex items-center gap-2">
          <span
            className={`text-[9px] font-semibold tracking-[0.18em] uppercase px-2 py-1 rounded-full ${
              kind === "flat-image"
                ? "bg-purple-50 text-purple-700"
                : "bg-blue-50 text-blue-700"
            }`}
          >
            {kind === "flat-image" ? "✦ Magic Image" : "3D Bag"}
          </span>
          <span className="text-[10px] text-[#272724]/45">
            {kind === "flat-image"
              ? "Saved into the digital previews row."
              : "Saved into a hero 3D slot."}
          </span>
        </div>

        {/* Brand */}
        <div className="space-y-2">
          <label className="text-[10px] font-medium tracking-[0.18em] uppercase text-[#272724]/55">
            Brand
          </label>
          <div className="flex gap-2 mb-2">
            <button
              type="button"
              onClick={() => setBrandMode("existing")}
              disabled={brands.length === 0}
              className={`flex-1 text-[11px] py-1.5 rounded-full border transition ${
                brandMode === "existing"
                  ? "bg-[#0033A1] text-white border-[#0033A1]"
                  : "bg-white text-[#272724]/60 border-[#e8ecf2] hover:border-[#0033A1]/40"
              } disabled:opacity-40 disabled:cursor-not-allowed`}
            >
              Existing
            </button>
            <button
              type="button"
              onClick={() => setBrandMode("new")}
              className={`flex-1 text-[11px] py-1.5 rounded-full border transition ${
                brandMode === "new"
                  ? "bg-[#0033A1] text-white border-[#0033A1]"
                  : "bg-white text-[#272724]/60 border-[#e8ecf2] hover:border-[#0033A1]/40"
              }`}
            >
              New
            </button>
          </div>

          {brandMode === "existing" ? (
            loadingBrands ? (
              <p className="text-[11px] text-[#272724]/40">Loading…</p>
            ) : (
              <select
                value={selectedBrandId}
                onChange={(e) => setSelectedBrandId(e.target.value)}
                className="w-full h-10 px-3 rounded-lg border border-[#e8ecf2] text-[12px] bg-white focus:outline-none focus:border-[#0033A1]"
              >
                {brands.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            )
          ) : (
            <input
              type="text"
              value={newBrandName}
              onChange={(e) => setNewBrandName(e.target.value)}
              placeholder="e.g. Prime Flower"
              className="w-full h-10 px-3 rounded-lg border border-[#e8ecf2] text-[12px] focus:outline-none focus:border-[#0033A1]"
            />
          )}
        </div>

        {/* Slot picker — each cell shows a live thumbnail of whatever is
            already in that slot so the user can see what they'd overwrite.
            For 3D (bag-3d) slots the stored `label_image_url` is the flat
            artwork that got mapped onto the model; for flat-image slots
            it's the final saved image. Empty cells show an unobtrusive
            dashed placeholder with the slot number. */}
        <div className="space-y-2">
          <label className="text-[10px] font-medium tracking-[0.18em] uppercase text-[#272724]/55">
            {section === "hero" ? "Hero slot (1–3)" : "Digital Previews slot (1–8)"}
          </label>
          <div
            className={`grid gap-2 ${
              section === "hero" ? "grid-cols-3" : "grid-cols-4"
            }`}
          >
            {Array.from({ length: maxSlot }, (_, i) => i + 1).map((s) => {
              const occupied = occupiedBySlot.get(s);
              const selected = slot === s;
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => setSlot(s)}
                  title={
                    occupied
                      ? `Slot ${s}: ${occupied.title} (will be replaced)`
                      : `Slot ${s} — empty`
                  }
                  className={`relative aspect-square rounded-lg overflow-hidden border transition ${
                    selected
                      ? "border-[#0033A1] ring-2 ring-[#0033A1]/30"
                      : "border-[#e8ecf2] hover:border-[#0033A1]/40"
                  } ${occupied ? "bg-[#f5f7fb]" : "bg-white"}`}
                >
                  {occupied ? (
                    <>
                      {/* Prefer the 3D-render preview so the user sees
                          the actual rendered packaging with materials,
                          lighting, and environment applied — not just
                          the flat label artwork. Older slots without a
                          preview fall back to the label image. */}
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={occupied.preview_image_url ?? occupied.label_image_url}
                        alt={occupied.title}
                        className="absolute inset-0 w-full h-full object-cover"
                        draggable={false}
                      />
                      {/* Slot number chip — sits on top of the thumbnail
                          so occupied slots still read their index at a
                          glance. The semi-opaque backdrop keeps the
                          number legible over bright artwork. */}
                      <span
                        className={`absolute top-1 left-1 text-[9px] font-bold px-1.5 py-0.5 rounded ${
                          selected
                            ? "bg-[#0033A1] text-white"
                            : "bg-white/85 text-[#272724]"
                        }`}
                      >
                        {s}
                      </span>
                      {selected && (
                        <span className="absolute inset-0 bg-[#0033A1]/20 pointer-events-none" />
                      )}
                    </>
                  ) : (
                    <span
                      className={`absolute inset-0 flex items-center justify-center text-[13px] font-semibold ${
                        selected ? "text-[#0033A1]" : "text-[#272724]/45"
                      }`}
                    >
                      {s}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          <p className="text-[10px] text-[#272724]/40">
            {occupiedBySlot.get(slot)
              ? `Slot ${slot} is taken — saving will replace “${occupiedBySlot.get(slot)!.title}”.`
              : "Saving to an occupied slot will replace what's there."}
          </p>
        </div>

        {/* Title */}
        <div className="space-y-2">
          <label className="text-[10px] font-medium tracking-[0.18em] uppercase text-[#272724]/55">
            Title
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Prime Flower – Hero Bag"
            className="w-full h-10 px-3 rounded-lg border border-[#e8ecf2] text-[12px] focus:outline-none focus:border-[#0033A1]"
          />
        </div>

        {/* Product type (only relevant for 3D) */}
        {kind === "bag-3d" && (
          <div className="space-y-2">
            <label className="text-[10px] font-medium tracking-[0.18em] uppercase text-[#272724]/55">
              Product type
            </label>
            <select
              value={productType}
              onChange={(e) =>
                setProductType(e.target.value as ProductSet["product_type"])
              }
              className="w-full h-10 px-3 rounded-lg border border-[#e8ecf2] text-[12px] bg-white focus:outline-none focus:border-[#0033A1]"
            >
              <option value="mylar-bag">Mylar Bag</option>
              <option value="supplement-jar">Supplement Jar</option>
            </select>
          </div>
        )}

        {err && (
          <p className="text-[11px] text-red-500 bg-red-50 rounded-lg p-3 leading-relaxed break-words">
            {err}
          </p>
        )}

        <div className="flex gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 h-10 rounded-full text-[11px] font-semibold uppercase tracking-[0.12em] text-[#272724]/60 border border-[#e8ecf2] hover:border-[#272724]/30 transition"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!canSubmit || saving || !supabaseConfigured}
            className="flex-1 h-10 rounded-full text-[11px] font-semibold uppercase tracking-[0.12em] text-white bg-[#0033A1] hover:bg-[#001F60] transition disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </div>
  );
}
