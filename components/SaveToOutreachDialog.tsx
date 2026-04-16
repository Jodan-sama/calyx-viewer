"use client";

import { useCallback, useEffect, useState } from "react";
import {
  getOrCreateBrand,
  listBrands,
  saveSet,
} from "@/lib/brands";
import { uploadLabel, supabaseConfigured } from "@/lib/supabase";
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
      material: BagMaterial;
      productType?: ProductSet["product_type"];
      environment?: SceneEnvironment;
    }
  | { kind: "flat-image"; blob: Blob; filename: string };

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

  const kind: ProductSetKind = source?.kind ?? "bag-3d";
  const section: "hero" | "gallery" =
    kind === "flat-image" ? "gallery" : "hero";
  const maxSlot = section === "hero" ? 3 : 8;

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

        const set = await saveSet({
          brand_id: brand.id,
          section,
          slot,
          kind: source.kind,
          title: title.trim(),
          product_type: productType,
          label_image_url,
          material: source.kind === "bag-3d" ? source.material : null,
          environment: source.kind === "bag-3d" ? source.environment ?? "default" : "default",
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

        {/* Slot */}
        <div className="space-y-2">
          <label className="text-[10px] font-medium tracking-[0.18em] uppercase text-[#272724]/55">
            {section === "hero" ? "Hero slot (1–3)" : "Digital Previews slot (1–8)"}
          </label>
          <div
            className={`grid gap-2 ${
              section === "hero" ? "grid-cols-3" : "grid-cols-4"
            }`}
          >
            {Array.from({ length: maxSlot }, (_, i) => i + 1).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setSlot(s)}
                className={`h-10 rounded-lg text-[12px] font-semibold border transition ${
                  slot === s
                    ? "bg-[#0033A1] text-white border-[#0033A1]"
                    : "bg-white text-[#272724]/60 border-[#e8ecf2] hover:border-[#0033A1]/40"
                }`}
              >
                {s}
              </button>
            ))}
          </div>
          <p className="text-[10px] text-[#272724]/40">
            Saving to an occupied slot will replace what&apos;s there.
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
