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
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    // matchMedia is the cheapest way to track a single breakpoint;
    // the MQL listener is O(1) regardless of how many components
    // subscribe. We sample once on mount to cover the initial state,
    // then let the listener fire on changes.
    if (typeof window === "undefined") return;
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT_PX}px)`);
    const update = () => setIsMobile(mql.matches);
    update();
    mql.addEventListener("change", update);
    return () => mql.removeEventListener("change", update);
  }, []);

  return isMobile;
}
