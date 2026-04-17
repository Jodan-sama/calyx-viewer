"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { useCreateStore } from "leva";
// Same trick as in BagViewer — Leva's StoreType isn't re-exported
// from the package root, so we reconstruct it from the hook's
// return type.
type LevaStore = ReturnType<typeof useCreateStore>;

/**
 * Top-down XY drag widget for positioning rect area lights in the scene.
 *
 * Renders as a small square canvas (bag viewed from above — the bag
 * bottom sits at world y = -1.1, so from this overhead view we're
 * looking straight down at the bag's footprint). Every active rect
 * light is represented as a coloured draggable disc positioned by its
 * world X / Y (Leva keys `rect{i}X` / `rect{i}Y`). Dragging a disc
 * writes the new X/Y back into the Leva store imperatively via
 * `store.setValueAtPath`, which propagates through the normal Leva
 * subscription — the slider numbers update in sync and the scene
 * re-renders with the new light position.
 *
 * The Z axis (vertical / height) is NOT shown on the map — it stays
 * on its own slider inside the Lighting panel's "Rect Area Lights"
 * folder. Users who want to lift a light above the bag edit the Z
 * slider independently.
 *
 * The map range is fixed at [-6, 6] on both axes to match the Leva
 * slider bounds. The bag's visible footprint (~±1 unit) lands in the
 * centre so the user can see lights positioned "around" it at a
 * glance. A light icon with a dot marks world origin (where the bag
 * sits centered) for orientation.
 */

type RectLightState = {
  index: number; // 1..4
  color: string;
  x: number;
  y: number;
};

const MAP_SIZE = 180; // px
const WORLD_RANGE = 6; // ± on each axis

// Map a world coord in [-WORLD_RANGE, +WORLD_RANGE] to a pixel 0..MAP_SIZE.
const worldToPx = (v: number): number =>
  ((v + WORLD_RANGE) / (2 * WORLD_RANGE)) * MAP_SIZE;
// Inverse — pixel 0..MAP_SIZE to a world coord.
const pxToWorld = (p: number): number =>
  (p / MAP_SIZE) * 2 * WORLD_RANGE - WORLD_RANGE;

export default function RectLightMap({ store }: { store: LevaStore }) {
  // Subscribe to the Lighting store and pull every rect{i}{X,Y,Color}
  // plus the active rect count. We don't use Leva's useControls here
  // because this component sits outside the store's useControls call —
  // instead we read the values directly from the store's zustand state.
  const [lights, setLights] = useState<RectLightState[]>([]);
  const [count, setCount] = useState(0);

  useEffect(() => {
    // Read live store values + set up a subscription. Leva stores are
    // zustand stores under the hood, exposed via `useStore` / `getData`.
    // `store.subscribeToEditedPaths` isn't stable API, but the raw
    // store's `subscribe` works: it fires whenever any control updates.
    const read = () => {
      // `get` returns the value at a full path like "Rect Area Lights.rect1X".
      const get = (path: string): unknown => {
        try {
          return store.get(path);
        } catch {
          return undefined;
        }
      };
      const n = Number(get("Rect Area Lights.rectCount") ?? 0);
      const nextLights: RectLightState[] = [];
      for (let i = 1; i <= n; i++) {
        const x = Number(get(`Rect Area Lights.rect${i}X`) ?? 0);
        const y = Number(get(`Rect Area Lights.rect${i}Y`) ?? 0);
        const color = String(get(`Rect Area Lights.rect${i}Color`) ?? "#ffffff");
        nextLights.push({ index: i, color, x, y });
      }
      setCount(n);
      setLights(nextLights);
    };
    read();
    const unsub = store.useStore.subscribe(() => read());
    return () => unsub();
  }, [store]);

  // ── Drag handling ──────────────────────────────────────────────────────────
  // The component uses native pointer events so no extra dependency is
  // needed. On pointerdown on a disc we record which light is being
  // dragged and start listening for pointermove/up on window (so the
  // drag keeps tracking even if the cursor exits the svg bounds).
  const dragRef = useRef<{ index: number; rectBounds: DOMRect } | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<SVGCircleElement>, index: number) => {
      if (!svgRef.current) return;
      (e.target as Element).setPointerCapture?.(e.pointerId);
      dragRef.current = {
        index,
        rectBounds: svgRef.current.getBoundingClientRect(),
      };
      e.stopPropagation();
      e.preventDefault();
    },
    []
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      const d = dragRef.current;
      if (!d) return;
      const px = e.clientX - d.rectBounds.left;
      // Invert Y so the map reads like "top of screen = +Y"
      const py = d.rectBounds.height - (e.clientY - d.rectBounds.top);
      const clampedPx = Math.max(0, Math.min(MAP_SIZE, px));
      const clampedPy = Math.max(0, Math.min(MAP_SIZE, py));
      const nx = +pxToWorld(clampedPx).toFixed(2);
      const ny = +pxToWorld(clampedPy).toFixed(2);
      // Write back to Leva. `setValueAtPath(path, value, fromPanel=true)`
      // updates the control + fires the subscription so the subscription
      // effect above re-reads and re-renders.
      store.setValueAtPath(`Rect Area Lights.rect${d.index}X`, nx, true);
      store.setValueAtPath(`Rect Area Lights.rect${d.index}Y`, ny, true);
    },
    [store]
  );

  const onPointerUp = useCallback(() => {
    dragRef.current = null;
  }, []);

  if (count === 0) {
    return (
      <div className="px-4 py-3 text-[10px] text-[#272724]/40 select-none">
        <p className="leading-relaxed">
          <span className="font-semibold tracking-[0.14em] uppercase">
            Rect Light Map
          </span>
          <br />
          Set <code>Rect Area Lights → Count ≥ 1</code> to position softboxes
          around the object with drag.
        </p>
      </div>
    );
  }

  const originPx = worldToPx(0);

  return (
    <div className="px-4 py-3 select-none">
      <p className="text-[9px] font-semibold tracking-[0.18em] uppercase text-[#272724]/55 mb-2">
        Rect Light Map (top-down)
      </p>
      <div
        className="mx-auto"
        style={{ width: MAP_SIZE, height: MAP_SIZE }}
      >
        <svg
          ref={svgRef}
          width={MAP_SIZE}
          height={MAP_SIZE}
          viewBox={`0 0 ${MAP_SIZE} ${MAP_SIZE}`}
          className="rounded-md bg-[#f5f7fb] border border-[#e8ecf2] touch-none"
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onPointerLeave={onPointerUp}
        >
          {/* Faint grid — every 1 unit */}
          {Array.from({ length: 2 * WORLD_RANGE - 1 }, (_, i) => {
            const u = i - (WORLD_RANGE - 1);
            const px = worldToPx(u);
            return (
              <g key={`grid-${u}`}>
                <line
                  x1={px}
                  x2={px}
                  y1={0}
                  y2={MAP_SIZE}
                  stroke="#e8ecf2"
                  strokeWidth={u === 0 ? 0.8 : 0.4}
                />
                <line
                  x1={0}
                  x2={MAP_SIZE}
                  y1={MAP_SIZE - px}
                  y2={MAP_SIZE - px}
                  stroke="#e8ecf2"
                  strokeWidth={u === 0 ? 0.8 : 0.4}
                />
              </g>
            );
          })}

          {/* Bag footprint indicator — a small square at origin roughly
              matching the bag's XY extent so the user sees where the
              object sits relative to their lights. */}
          <rect
            x={worldToPx(-0.7)}
            y={MAP_SIZE - worldToPx(1.0)}
            width={worldToPx(0.7) - worldToPx(-0.7)}
            height={worldToPx(1.0) - worldToPx(-1.0)}
            fill="rgba(39, 39, 36, 0.08)"
            stroke="rgba(39, 39, 36, 0.35)"
            strokeWidth="1"
            strokeDasharray="2 2"
            rx="3"
            pointerEvents="none"
          />
          <circle
            cx={originPx}
            cy={MAP_SIZE - originPx}
            r="2"
            fill="#272724"
            pointerEvents="none"
          />

          {/* Light discs — drag to reposition. SVG Y axis grows down
              in screen space; we map world +Y to top of SVG by
              subtracting from MAP_SIZE on paint. */}
          {lights.map((l) => {
            const cx = worldToPx(l.x);
            const cy = MAP_SIZE - worldToPx(l.y);
            return (
              <g key={l.index}>
                <circle
                  cx={cx}
                  cy={cy}
                  r="10"
                  fill={l.color}
                  stroke="rgba(39, 39, 36, 0.5)"
                  strokeWidth="1.2"
                  style={{ cursor: "grab" }}
                  onPointerDown={(e) => onPointerDown(e, l.index)}
                />
                <text
                  x={cx}
                  y={cy + 3.5}
                  textAnchor="middle"
                  fontSize="9"
                  fontWeight="700"
                  fill="rgba(39, 39, 36, 0.8)"
                  pointerEvents="none"
                >
                  R{l.index}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
      <p className="mt-2 text-[9px] text-[#272724]/45 leading-relaxed">
        Drag discs to set X / Y · Z (height) is on each light&apos;s slider
      </p>
    </div>
  );
}
