"use client";

import { useEffect, useState } from "react";

/** Width below which we treat the viewport as "mobile" for the client
 *  surface's performance overrides (DPR cap, AA off, smaller HDRI,
 *  2×2 hero layout). 768px matches Tailwind's `md` breakpoint and the
 *  hero grid's `sm:` / `lg:` responsive classes, so CSS layout and
 *  JS-driven settings flip at the same threshold. */
export const MOBILE_BREAKPOINT_PX = 768;

/** Returns true when the viewport is mobile-width. Hydration-safe:
 *  the SSR pass returns `false` (desktop) so server markup matches the
 *  desktop layout, and the hook flips to the real value on mount.
 *  Re-evaluates on resize so the flag flips cleanly when the user
 *  rotates a tablet or resizes a dev-tools window. */
export function useIsMobile(): boolean {
  // Check matchMedia in the useState initializer so the FIRST client
  // render already has the correct value. Prevents a flash of the
  // desktop tree (and its WebGL contexts) on mobile devices before
  // the useEffect would have otherwise flipped the flag. SSR still
  // falls back to desktop — the consumer is expected to be rendered
  // only client-side (e.g. behind a loading gate) so the hydration
  // mismatch doesn't surface.
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT_PX}px)`).matches;
  });

  useEffect(() => {
    // matchMedia is the cheapest way to track a single breakpoint;
    // the MQL listener is O(1) regardless of how many components
    // subscribe. The listener handles later changes (e.g. the user
    // rotates a tablet or drags a dev-tools window boundary).
    if (typeof window === "undefined") return;
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT_PX}px)`);
    const update = () => setIsMobile(mql.matches);
    // Re-sync in case the viewport changed between render and this
    // effect running (rare but possible during load).
    update();
    mql.addEventListener("change", update);
    return () => mql.removeEventListener("change", update);
  }, []);

  return isMobile;
}
