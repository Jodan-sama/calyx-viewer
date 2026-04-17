"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import type { ProductSet } from "@/lib/types";
import { hasUVLayer, withUVLighting } from "@/lib/bagMaterial";
import UVToggleButton from "./UVToggleButton";

const OutreachBagViewer = dynamic(() => import("./OutreachBagViewer"), {
  ssr: false,
});
const OutreachJarViewer = dynamic(() => import("./OutreachJarViewer"), {
  ssr: false,
});

/**
 * Full-viewport modal that reopens an Outreach slot's 3D asset at
 * screen size so the viewer can inspect it closely. Mounted on top of
 * the client site (outside the scrolling page) via a fixed
 * positioning wrapper; closes on the × button, Escape key, or a click
 * on the top/bottom chrome (the canvas itself is click-through to
 * OrbitControls so drag-to-rotate still works).
 */
export default function FullscreenSlot({
  set,
  onClose,
}: {
  set: ProductSet;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // UV Blacklight override — mirrors the pattern in OutreachSlot. Keeps
  // the original material untouched and just swaps the `lighting` field
  // when the toggle is on. Transparent bg is suppressed under UV so the
  // backdrop stays dark enough for the fluorescent glow to read.
  const [uvOn, setUvOn] = useState(false);
  const canToggleUV = hasUVLayer(set.material);
  const effectiveMaterial = canToggleUV
    ? withUVLighting(set.material, uvOn)
    : set.material;
  const transparent = !uvOn && set.material?.backgroundMode === "transparent";

  const viewer = set.product_type === "supplement-jar" ? (
    <OutreachJarViewer
      textureUrl={set.label_image_url}
      backTextureUrl={set.material?.backImageUrl ?? null}
      material={effectiveMaterial}
      environment={set.environment}
      transparent={transparent}
    />
  ) : (
    <OutreachBagViewer
      textureUrl={set.label_image_url}
      backTextureUrl={set.material?.backImageUrl ?? null}
      layer3FrontTextureUrl={set.material?.layer3FrontImageUrl ?? null}
      layer3BackTextureUrl={set.material?.layer3BackImageUrl ?? null}
      material={effectiveMaterial}
      environment={set.environment}
      transparent={transparent}
    />
  );

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/90 backdrop-blur-md">
      {/* Top bar — slot title + close. Stays above the canvas so the
          close affordance is always reachable without competing with
          OrbitControls' drag handling. */}
      <div
        className="flex-shrink-0 h-14 flex items-center justify-between px-6 bg-black/40 cursor-pointer"
        onClick={onClose}
      >
        <span className="text-white text-[12px] font-semibold tracking-[0.2em] uppercase select-none">
          {set.title}
        </span>
        <div className="flex items-center gap-3">
          {canToggleUV && (
            <UVToggleButton
              active={uvOn}
              onClick={() => setUvOn((v) => !v)}
              variant="bar"
            />
          )}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onClose();
            }}
            className="text-white/70 hover:text-white text-2xl leading-none"
            aria-label="Close fullscreen preview"
          >
            ×
          </button>
        </div>
      </div>

      {/* 3D canvas — fills the remaining viewport. Relative so the
          dynamic-imported viewer can position its own absolute wrapper
          (gradient backgrounds) correctly inside it. */}
      <div className="flex-1 min-h-0 relative">{viewer}</div>
    </div>
  );
}
