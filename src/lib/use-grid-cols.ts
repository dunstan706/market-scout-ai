import { useLayoutEffect, useRef, useState } from "react";

/**
 * Reports how many columns the given CSS grid currently renders as, and keeps
 * the count fresh across viewport changes (ResizeObserver).
 *
 * Use it to compute an item's position *within its row* for sequential
 * scroll reveals: index % columns. `cols` is null until the first client
 * measurement, so callers should treat null as a single column.
 */
export function useGridCols<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [cols, setCols] = useState<number | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const tracks = getComputedStyle(el).gridTemplateColumns;
      const n = tracks.split(" ").length;
      setCols(n > 0 && tracks !== "none" ? n : null);
    };
    measure();
    const ro =
      typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    return () => ro?.disconnect();
  }, []);

  return { ref, cols };
}
