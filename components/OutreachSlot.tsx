"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ProductSet } from "@/lib/types";
import {
  hasMosaicLayer,
  hasUVLayer,
  randomizeMosaicSeeds,
  withUVLighting,
} from "@/lib/bagMaterial";
import UVToggleButton from "@/components/UVToggleButton";
import MosaicCycleButton from "@/components/MosaicCycleButton";

const SLOT_LOADER = (
  <div className="w-full h-full flex items-center justify-center bg-[#f0f2f7]">
    <div className="w-7 h-7 border-2 border-[#0033A1] border-t-transparent rounded-full animate-spin" />
  </div>
);

const OutreachBagViewer = dynamic(
  () => import("@/components/OutreachBagViewer"),
  { ssr: false, loading: () => SLOT_LOADER }
);

const OutreachJarViewer = dynamic(
  () => import("@/components/OutreachJarViewer"),
  { ssr: false, loading: () => SLOT_LOADER }
);

/* ───────── Hero slot (big card, 3D or flat) ───────── */

/**
 * Admin-only UI sits on top of the 3D canvas — a pencil icon that swaps the
 * title bar for an inline text input, and an "Open in Preview" button that
 * launches Calyx Preview with the slot's saved textures + material +
 * environment pre-loaded via `?open=<set-id>`.
 *
 * Both overlays are gated by the `isAdmin` prop: `/outreach` passes
 * `isAdmin={true}`, `/client/[slug]` doesn't pass it at all so the client
 * site stays chrome-free.
 */
export function ProductSlot({
  index,
  set,
  onOpenImage,
  onExpand,
  isAdmin = false,
  onTitleChange,
}: {
  index: number;
  set?: ProductSet;
  onOpenImage: (src: string, alt: string) => void;
  /** Called when the user clicks the expand affordance on a 3D slot.
   *  Only rendered when provided AND the slot is a 3D bag/jar AND
   *  `isAdmin` is off — the expand handler lives on the client site
   *  so admins don't trip over it when they meant to Edit. */
  onExpand?: (set: ProductSet) => void;
  /** Outreach-only — turns on the inline title editor + "Open in Preview"
   *  action button. Absent on the client site so the slot reads as a
   *  read-only showcase. */
  isAdmin?: boolean;
  /** Called after a successful title save. Parent updates local state so
   *  the bottom title bar reflects the new title without a refetch. */
  onTitleChange?: (setId: string, nextTitle: string) => Promise<void>;
}) {
  // UV Blacklight override — local to each slot card. When the user toggles
  // it on, we swap the displayed material's `lighting` field to "uv" so the
  // viewer rerenders under the blacklight preset. Turning it off reverts to
  // the slot's saved value untouched. Gated on hasUVLayer so the pill only
  // appears on designs with something that will actually glow.
  const [uvOn, setUvOn] = useState(false);

  // Mosaic Cycle override — bumped each time the user taps the MOSAIC pill
  // on a slot whose design uses the Mosaic finish. Each bump re-runs
  // randomizeMosaicSeeds to generate a fresh zoom + mirror + per-layer
  // offset/flip set, which the viewer picks up via its useEffect deps.
  // The source URL stays fixed so BagMesh's texture load does NOT refetch
  // — the cached THREE.Texture just gets a new offset/repeat matrix, which
  // is effectively free. Starts at 0 (saved seed untouched); the useMemo
  // below only regenerates once `cycleTick > 0`.
  const [cycleTick, setCycleTick] = useState(0);

  // Preload the mosaic source image the moment the slot mounts. BagMesh
  // will fetch it again when it finally runs, but by then the bytes are in
  // the HTTP cache so the first render is instant. Cheap on slots without
  // a mosaic source (early-return keeps it a no-op).
  const mosaicSourceUrl = set?.material?.mosaicSourceImageUrl;
  useEffect(() => {
    if (!mosaicSourceUrl) return;
    const img = new Image();
    img.src = mosaicSourceUrl;
  }, [mosaicSourceUrl]);

  // Compose the material fed to the viewer once per [set, uvOn, cycleTick]
  // rather than on every render. Must be memoised because
  // randomizeMosaicSeeds is non-pure (fresh random numbers each call) —
  // without memoisation every parent re-render would invalidate the mosaic
  // uniforms and thrash BagMesh's useEffect deps.
  const effectiveMaterial = useMemo(() => {
    if (!set) return null;
    const isFlat = set.kind === "flat-image";
    if (isFlat) return set.material;
    const canUV = hasUVLayer(set.material);
    const canCycle = hasMosaicLayer(set.material);
    // UV first: the toggle overrides saved `lighting`. Cycle second: its
    // mosaic* fields are independent, so compose order is irrelevant for
    // correctness and we keep UV-before-mosaic for readability.
    const uvMat = canUV ? withUVLighting(set.material, uvOn) : set.material;
    return canCycle && cycleTick > 0 ? randomizeMosaicSeeds(uvMat) : uvMat;
  }, [set, uvOn, cycleTick]);

  if (set) {
    const isFlat = set.kind === "flat-image";
    const canToggleUV = !isFlat && hasUVLayer(set.material);
    const canCycleMosaic = !isFlat && hasMosaicLayer(set.material);
    // When the slot was saved with Background → Transparent in the
    // studio, skip the slot-card's flat blue fill so the page
    // underneath (e.g. the client site's wavy lines) reads through
    // the alpha Canvas. Border + rounded corners stay so the card
    // still frames the 3D asset. UV override forces an opaque dark
    // canvas even if the saved background was transparent, since a
    // bright page behind a UV scene washes out the whole effect.
    const bgIsTransparent =
      !isFlat && !uvOn && set.material?.backgroundMode === "transparent";
    return (
      <div
        className={`relative aspect-square rounded-[20px] overflow-hidden border border-[#272724]/10 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_28px_-10px_rgba(0,0,0,0.1)] group ${
          bgIsTransparent ? "" : "bg-[#eef1f8]"
        }`}
      >
        {isFlat ? (
          <button
            type="button"
            onClick={() => onOpenImage(set.label_image_url, set.title)}
            className="block w-full h-full"
            title="Click to preview"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={set.label_image_url}
              alt={set.title}
              className="w-full h-full object-cover"
              draggable={false}
            />
          </button>
        ) : set.product_type === "supplement-jar" ? (
          <OutreachJarViewer
            textureUrl={set.label_image_url}
            backTextureUrl={set.material?.backImageUrl ?? null}
            material={effectiveMaterial}
            environment={set.environment}
            transparent={bgIsTransparent}
            autoRotate
          />
        ) : (
          <OutreachBagViewer
            textureUrl={set.label_image_url}
            backTextureUrl={set.material?.backImageUrl ?? null}
            layer3FrontTextureUrl={set.material?.layer3FrontImageUrl ?? null}
            layer3BackTextureUrl={set.material?.layer3BackImageUrl ?? null}
            material={effectiveMaterial}
            environment={set.environment}
            transparent={bgIsTransparent}
            autoRotate
          />
        )}

        {/* UV Blacklight toggle — top-left so it doesn't fight the
            top-right Edit/Expand affordances. Visible whenever the
            slot's design has a UV-tagged layer, on both the admin
            outreach view and the client site. */}
        {canToggleUV && (
          <UVToggleButton
            active={uvOn}
            onClick={() => setUvOn((v) => !v)}
            variant="overlay"
          />
        )}

        {/* Mosaic Cycle — bottom-right so it doesn't collide with the
            UV pill (top-left) or the Expand/Edit affordances (top-
            right). Client + admin both see it; admins benefit from a
            quick reshuffle preview when reviewing a slot before
            shipping it to the client surface. */}
        {canCycleMosaic && (
          <MosaicCycleButton onClick={() => setCycleTick((t) => t + 1)} />
        )}
        {isFlat && (
          <span className="absolute top-3 left-3 text-[9px] font-semibold tracking-[0.18em] uppercase px-2 py-1 rounded-full bg-white/85 text-purple-700 pointer-events-none">
            ✦ Magic
          </span>
        )}

        {/* Client-site only: expand to full-screen preview. Mirrors
            the admin "Edit" affordance's positioning + hover reveal
            but opens a fullscreen modal with a download button
            rather than navigating to the studio. */}
        {!isAdmin && !isFlat && onExpand && (
          <button
            type="button"
            onClick={() => onExpand(set)}
            title="Expand to full-screen preview"
            aria-label="Expand preview"
            className="absolute top-3 right-3 z-10 opacity-0 group-hover:opacity-100 transition-opacity duration-150 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/90 backdrop-blur-sm text-[#272724] text-[10px] font-semibold tracking-[0.14em] uppercase shadow-sm hover:bg-white"
          >
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden>
              <path
                d="M1 5V1h4M7 1h4v4M11 7v4H7M5 11H1V7"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            Expand
          </button>
        )}

        {/* Admin-only: "Open in Preview" launcher. Only makes sense for 3D
            slots — flat images are already rendered, there's nothing to
            edit in the 3D preview. Positioned in the top-right corner and
            revealed on hover so it doesn't distract from the showcase. */}
        {isAdmin && !isFlat && (
          <Link
            href={`/calyx-preview?open=${set.id}`}
            title="Open this slot in Calyx Preview"
            className="absolute top-3 right-3 z-10 opacity-0 group-hover:opacity-100 transition-opacity duration-150 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/90 backdrop-blur-sm text-[#272724] text-[10px] font-semibold tracking-[0.14em] uppercase shadow-sm hover:bg-white"
          >
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
              <path d="M4 2H2v8h8V8M7 2h3v3M10 2L5 7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Edit
          </Link>
        )}

        {/* Bottom title bar — only rendered on flat-image gallery tiles.
            For 3D slots both the gradient and the title are
            suppressed: they compete visually with the packaging and
            the user preferred a clean frame. Admin rename still works
            via Calyx Preview (Edit affordance top-right). */}
        {isFlat && (
          <TitleBar
            title={set.title}
            isAdmin={isAdmin}
            onSave={
              onTitleChange
                ? (next) => onTitleChange(set.id, next)
                : undefined
            }
          />
        )}
      </div>
    );
  }

  return (
    <div className="relative aspect-square rounded-[20px] overflow-hidden bg-gradient-to-br from-[#f5f3ee] to-[#e7e3d8] border border-[#272724]/10 flex items-center justify-center shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_28px_-10px_rgba(0,0,0,0.1)]">
      <div className="flex flex-col items-center gap-3 text-center px-6">
        <div className="w-12 h-12 rounded-full border border-dashed border-[#272724]/30 flex items-center justify-center">
          <span className="text-[#272724]/40 text-[14px] font-light">
            {index}
          </span>
        </div>
        <p className="text-[10px] text-[#272724]/45 tracking-[0.2em] uppercase font-medium">
          Slot {index}
        </p>
        <p className="text-[9px] text-[#272724]/35 max-w-[180px] font-light leading-relaxed">
          Save a configured set from Calyx Preview to this slot.
        </p>
      </div>
    </div>
  );
}

/* ───────── Editable title bar ─────────
   Admin mode: pencil icon on the right; click to enter edit mode. The
   input auto-focuses and auto-selects for quick rename. Commits on blur
   or Enter, reverts on Escape. While saving, the row shows a subtle
   disabled state so double-saves are impossible.

   Read mode (client site): just the static title over a gradient — the
   pencil icon isn't rendered at all so there's no admin affordance to
   notice. */
function TitleBar({
  title,
  isAdmin,
  onSave,
}: {
  title: string;
  isAdmin: boolean;
  onSave?: (next: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Keep the local draft in sync when the parent's title changes (e.g.
  // after a successful save refreshes `sets`).
  useEffect(() => {
    if (!editing) setDraft(title);
  }, [title, editing]);

  // Auto-focus + select on entering edit mode so the user can just start
  // typing to replace the title.
  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const commit = useCallback(async () => {
    const next = draft.trim();
    if (!onSave || saving) {
      setEditing(false);
      return;
    }
    if (!next || next === title) {
      // Empty or unchanged — back out without a network call.
      setDraft(title);
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      await onSave(next);
      setEditing(false);
    } catch {
      // Revert on failure so the UI reflects server truth; the parent
      // should surface any error via its own state.
      setDraft(title);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }, [draft, onSave, saving, title]);

  const cancel = useCallback(() => {
    setDraft(title);
    setEditing(false);
  }, [title]);

  return (
    <div className="absolute bottom-0 left-0 right-0 p-3 bg-gradient-to-t from-black/50 to-transparent">
      {editing ? (
        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            value={draft}
            disabled={saving}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commit();
              } else if (e.key === "Escape") {
                e.preventDefault();
                cancel();
              }
            }}
            className="flex-1 min-w-0 bg-white/95 text-[#272724] text-[11px] font-semibold tracking-wide px-2 py-1 rounded-md border border-white focus:outline-none focus:ring-2 focus:ring-[#0033A1]/40 disabled:opacity-60"
            aria-label="Edit slot title"
          />
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <p className="flex-1 min-w-0 text-white text-[11px] font-semibold tracking-wide truncate">
            {title}
          </p>
          {isAdmin && onSave && (
            <button
              type="button"
              onClick={() => setEditing(true)}
              title="Rename this slot"
              aria-label="Rename"
              className="flex-shrink-0 p-1 rounded-md text-white/70 hover:text-white hover:bg-white/15 transition"
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path d="M8.5 1.5l2 2-6 6-2.5.5.5-2.5 6-6z" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/* ───────── Gallery tile (smaller, flat image from DB or placeholder) ───────── */
export function GallerySlot({
  index,
  set,
  onOpenImage,
}: {
  index: number;
  set?: ProductSet;
  onOpenImage: (src: string, alt: string) => void;
}) {
  if (set) {
    return (
      <button
        type="button"
        onClick={() => onOpenImage(set.label_image_url, set.title)}
        className="relative aspect-square rounded-2xl overflow-hidden border border-[#272724]/10 bg-[#f5f3ee] transition-all duration-200 hover:-translate-y-0.5 hover:border-[#0033A1]/40 group"
        title={set.title}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={set.label_image_url}
          alt={set.title}
          className="w-full h-full object-cover"
          draggable={false}
        />
        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
          <span className="text-white text-[9px] font-semibold tracking-[0.2em] uppercase">
            Preview
          </span>
        </div>
      </button>
    );
  }

  return (
    <div className="relative aspect-square rounded-2xl overflow-hidden bg-[#f5f3ee] border border-[#272724]/10 flex items-center justify-center">
      <span className="text-[#272724]/20 text-[11px] tracking-[0.2em] uppercase font-medium">
        Img {index}
      </span>
    </div>
  );
}
