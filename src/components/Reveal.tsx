import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

type RevealProps = {
  children: ReactNode;
  className?: string;
  /** Observer-fallback stagger in ms (one-shot entrance on older browsers). */
  delayMs?: number;
  /** Set false for sticky elements — a view() timeline freezes for stuck boxes. */
  scrollLinked?: boolean;
  /**
   * Sequential light-up mode for items inside a grid: item `seqIndex` of each
   * row animates over the scroll window `[entry + seqIndex*seqPx,
   * entry + (seqIndex+1)*seqPx]`, so same-row items pop one by one while rows
   * still sequence naturally by geometry. Pass seqIndex = item's position
   * within its row (index % measured column count).
   */
  seqIndex?: number;
  seqPx?: number;
};

/** Scroll distance before the element enters the viewport that the motion spans. */
const SCROLL_LEAD = 220;

/**
 * Entrance motion bound to scroll. When the browser supports scroll-driven
 * animations (animation-timeline: view()) the element rises as it enters the
 * viewport and reverses as you scroll back up — visible at any scroll speed.
 * Older browsers fall back to an IntersectionObserver one-shot reveal.
 * SSR/no-JS safe: content is only hidden after the client arms it.
 */
export function Reveal({ children, className = "", delayMs = 0, scrollLinked = true, seqIndex, seqPx }: RevealProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<"scroll" | "observer" | null>(null);
  const [shown, setShown] = useState(false);

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const canScrollDrive =
      typeof window !== "undefined" &&
      typeof window.CSS !== "undefined" &&
      typeof window.CSS.supports === "function" &&
      window.CSS.supports("animation-timeline: view()");
    if (canScrollDrive && scrollLinked) {
      setMode("scroll");
      return;
    }
    if (typeof IntersectionObserver === "undefined") {
      setMode("observer");
      setShown(true);
      return;
    }
    setMode("observer");
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setShown(true);
          observer.disconnect();
        }
      },
      { threshold: 0.12, rootMargin: "0px 0px -8% 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  let classes = className;
  let style: CSSProperties | undefined;

  if (mode === "scroll") {
    classes = "ls-scroll-reveal " + className;
    if (seqPx != null && seqIndex != null) {
      style = {
        animationRangeStart: `entry ${seqIndex * seqPx}px`,
        animationRangeEnd: `entry ${(seqIndex + 1) * seqPx}px`,
      } as CSSProperties;
    } else {
      // Standalone elements: rise as the element approaches the viewport.
      style = {
        animationRangeStart: `entry -${SCROLL_LEAD}px`,
        animationRangeEnd: "entry 100%",
      } as CSSProperties;
    }
  } else if (mode === "observer") {
    const pending = !shown;
    classes = (pending ? "ls-reveal-pending " : "") + (shown ? "animate-rise " : "") + className;
    if (shown && delayMs > 0) {
      style = { animationDelay: delayMs + "ms" };
    }
  }

  return (
    <div ref={ref} className={classes} style={style}>
      {children}
    </div>
  );
}
