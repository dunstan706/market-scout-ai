import { useEffect } from "react";

/**
 * Gently smooths wheel/touch scrolling on the page that mounts it.
 *
 * Scroll stays continuous and free — no section locking or snapping. Gesture
 * deltas are lightly damped into a target position, and the page glides
 * toward it at a capped, constant speed with a soft deceleration near the
 * end. Fast gestures advance faster but never exceed the cap, so scrolling
 * down feels a bit slower and smoother without being physically limited.
 * Native scrollbar and keyboard scrolling are left untouched, and the hook
 * stands down for reduced-motion users.
 */
export function useSmoothedScroll() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

    const DAMP = 0.85; // gesture keeps 85% of its travel
    const SPEED = 1100; // px per second, the glide cap
    const EASE_ZONE = 160; // px from target where we decelerate
    const MAX_LEAD = window.innerHeight * 3; // how far target may run ahead

    let current = window.scrollY;
    let target = window.scrollY;
    let raf = 0;
    let lastTs = 0;
    let animating = false;
    let lastTouchY = 0;

    const maxScroll = () => document.documentElement.scrollHeight - window.innerHeight;
    const clamp = (v: number) => Math.min(Math.max(v, 0), maxScroll());

    function tick(ts: number) {
      const dt = lastTs ? Math.min((ts - lastTs) / 1000, 0.05) : 0.016;
      lastTs = ts;
      const dist = target - current;
      const abs = Math.abs(dist);
      if (abs < 0.5) {
        current = target;
        animating = false;
        raf = 0;
        window.scrollTo({ top: Math.round(current), behavior: "instant" });
        return;
      }
      // Constant-speed glide, easing only inside the final EASE_ZONE.
      let step = abs > EASE_ZONE ? SPEED * dt : abs * 0.22;
      if (step > abs) step = abs;
      current += Math.sign(dist) * step;
      window.scrollTo({ top: Math.round(current), behavior: "instant" });
      raf = requestAnimationFrame(tick);
    }

    function kick() {
      if (!raf) {
        animating = true;
        lastTs = 0;
        raf = requestAnimationFrame(tick);
      }
    }

    function onWheel(event: WheelEvent) {
      // Let ctrl+wheel (pinch zoom) and alt-modified scrolls behave natively.
      if (event.ctrlKey || event.altKey) return;
      event.preventDefault();
      const delta =
        event.deltaY *
        (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? window.innerHeight : 1);
      target = clamp(target + delta * DAMP);
      const lead = target - current;
      if (lead > MAX_LEAD) target = current + MAX_LEAD;
      else if (lead < -MAX_LEAD) target = current - MAX_LEAD;
      kick();
    }

    function onTouchStart(event: TouchEvent) {
      const touch = event.touches[0];
      if (touch) lastTouchY = touch.clientY;
    }

    function onTouchMove(event: TouchEvent) {
      const touch = event.touches[0];
      if (!touch || event.touches.length !== 1) return;
      event.preventDefault();
      const dy = lastTouchY - touch.clientY;
      lastTouchY = touch.clientY;
      target = clamp(target + dy * DAMP);
      kick();
    }

    // Native scrolls (scrollbar drag, keyboard, anchor jumps) resync target
    // so the eased loop never fights them. Our own per-frame scrolls happen
    // while animating and are ignored here.
    function onScroll() {
      if (!animating) {
        current = window.scrollY;
        target = window.scrollY;
      }
    }

    window.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchmove", onTouchMove, { passive: false });
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("wheel", onWheel);
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("scroll", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);
}