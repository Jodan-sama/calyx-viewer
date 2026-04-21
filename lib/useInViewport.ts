"use client";

import { useEffect, useState, type RefObject } from "react";

/** Tracks whether a DOM element is intersecting the viewport. Used to
 *  flip the R3F Canvas `frameloop` between `"always"` (in view) and
 *  `"demand"` (off-screen), so off-screen Canvases don't burn GPU and
 *  battery rendering into a hidden framebuffer.
 *
 *  Defaults to `true` so the very first render (before the observer
 *  fires) assumes in-view — avoids a single-frame black flash when a
 *  slot is visible from the start.
 *
 *  `rootMargin` defaults to "200px" so we start rendering a bit before
 *  the slot actually scrolls into view; the browser can finish the
 *  first frame while the user is still scrolling toward it, so the
 *  model appears immediately when it lands in-viewport.
 *
 *  No `root` option — we observe the document viewport, which matches
 *  the client page's `<main>` scroll container after it flushes its
 *  content into the viewport. If we ever need to observe inside an
 *  explicit scroll container, the signature needs widening to accept
 *  one. */
export function useInViewport(
  ref: RefObject<Element | null>,
  rootMargin: string = "200px"
): boolean {
  const [inViewport, setInViewport] = useState(true);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        // One entry per observed element; we only observe one here.
        for (const entry of entries) setInViewport(entry.isIntersecting);
      },
      { rootMargin, threshold: 0 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, rootMargin]);

  return inViewport;
}
