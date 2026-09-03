import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

type RevealProps = {
  children: ReactNode;
  className?: string;
  /** Stagger delay in ms once the element scrolls into view. */
  delayMs?: number;
};

/**
 * Scroll-triggered entrance. Content renders normally (SSR/no-JS safe), gets
 * hidden in a layout effect (before first paint), then animates in with the
 * shared "rise" motion once it scrolls into view. Falls back to an instant
 * reveal when IntersectionObserver is unavailable.
 */
export function Reveal({ children, className = "", delayMs = 0 }: RevealProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [armed, setArmed] = useState(false);
  const [shown, setShown] = useState(false);

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (typeof IntersectionObserver === "undefined") {
      setShown(true);
      return;
    }
    setArmed(true);
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

  const pending = armed && !shown;
  const classes = [pending ? "ls-reveal-pending" : "", shown ? "animate-rise" : "", className]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      ref={ref}
      className={classes}
      style={shown && delayMs ? { animationDelay: delayMs + "ms" } : undefined}
    >
      {children}
    </div>
  );
}
