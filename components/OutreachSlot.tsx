"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ProductSet } from "@/lib/types";

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
  isAdmin = false,
  onTitleChange,
}: {
  index: number;
  set?: ProductSet;
  onOpenImage: (src: string, alt: string) => void;
  /** Outreach-only — turns on the inline title editor + "Open in Preview"
   *  action button. Absent on the client site so the slot reads as a
   *  read-only showcase. */
  isAdmin?: boolean;
  /** Called after a successful title save. Parent updates local state so
   *  the bottom title bar reflects the new title without a refetch. */
  onTitleChange?: (setId: string, nextTitle: string) => Promise<void>;
}) {
  if (set) {
    const isFlat = set.kind === "flat-image";
    return (
      <div className="relative aspect-square rounded-[20px] overflow-hidden border border-[#272724]/10 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_28px_-10px_rgba(0,0,0,0.1)] bg-[#eef1f8] group">
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
            material={set.material}
            environment={set.environment}
            autoRotate
          />
        ) : (
          <OutreachBagViewer
            textureUrl={set.label_image_url}
            material={set.material}
            environment={set.environment}
            autoRotate
          />
        )}
        {isFlat && (
          <span className="absolute top-3 left-3 text-[9px] font-semibold tracking-[0.18em] uppercase px-2 py-1 rounded-full bg-white/85 text-purple-700 pointer-events-none">
            ✦ Magic
          </span>
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

        {/* Bottom title bar. In admin mode the pencil icon swaps the static
            title for an inline <input> that commits on blur/Enter. */}
        <TitleBar
          title={set.title}
          isAdmin={isAdmin}
          onSave={
            onTitleChange
              ? (next) => onTitleChange(set.id, next)
              : undefined
          }
        />
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
