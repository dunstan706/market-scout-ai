import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

type RevealProps = {
  children: ReactNode;
  className?: string;
  /** Stagger offset in ms (mapped to extra scroll distance in scroll-linked mode). */
  delayMs?: number;
};

/** Scroll distance before the element enters the viewport that the motion spans. */
const SCROLL_LEAD = 160;

/**
 * Entrance motion bound to scroll. When the browser supports scroll-driven
 * animations (animation-timeline: view()) the element rises as it enters the
 * viewport and reverses as you scroll back up — visible at any scroll speed.
 * Older browsers fall back to an IntersectionObserver one-shot reveal.
 * SSR/no-JS safe: content is only hidden after the client arms it.
 */
export function Reveal({ children, className = "", delayMs = 0 }: RevealProps) {
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
    if (canScrollDrive) {
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
    // Stagger by starting each element's range further before the viewport.
    if (delayMs > 0) {
      style = { animationRange: `entry -${SCROLL_LEAD + delayMs}px entry 100%` } as CSSProperties;
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
