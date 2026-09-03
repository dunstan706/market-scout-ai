import { useEffect, useRef } from "react";

interface GridNode {
  x: number;
  y: number;
  vx: number;
  vy: number;
  baseX: number;
  baseY: number;
  radius: number;
  label: string;
  pulse: number;
}

/**
 * Interactive "market constellation" backdrop for the landing hero.
 *
 * Nodes sit on a jittered grid, spring back to their anchors, and ripple away
 * from the cursor (harder the faster it sweeps). Nearby nodes are joined with
 * fading lines; near the cursor they brighten, grow, and show radar rings plus
 * hex readouts — a nod to the "we're watching the local market" story.
 *
 * Brand-adapted from the original demo: paper-white nodes on deep ink, with the
 * amber accent for proximity. Respects prefers-reduced-motion (renders a static
 * frame) and pauses the loop when scrolled out of view.
 */
export function ConstellationGrid({ className }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    // Brand palette (ink / paper / amber) as RGB strings for canvas alpha.
    const BG = "rgb(28, 23, 21)";
    const NODE_RGB = "245, 240, 230";
    const ACCENT_RGB = "190, 105, 25";
    const SPACING = 56;
    const MAX_CONN = 75;
    const MAX_CONN_SQ = MAX_CONN * MAX_CONN;

    const mouse = { x: -1000, y: -1000, prevX: -1000, prevY: -1000, vx: 0, vy: 0, radius: 220 };

    let width = 0;
    let height = 0;
    let cols = 0;
    let rows = 0;
    let nodes: GridNode[] = [];
    let raf = 0;

    const initNodes = () => {
      nodes = [];
      cols = Math.ceil(width / SPACING) + 1;
      rows = Math.ceil(height / SPACING) + 1;
      for (let j = 0; j < rows; j++) {
        for (let i = 0; i < cols; i++) {
          // Small random anchor jitter keeps the resting lattice organic
          // (some diagonals fall under the connection threshold).
          const baseX = i * SPACING + (Math.random() - 0.5) * 14;
          const baseY = j * SPACING + (Math.random() - 0.5) * 14;
          nodes.push({
            x: baseX,
            y: baseY,
            vx: 0,
            vy: 0,
            baseX,
            baseY,
            radius: Math.random() * 1.2 + 1.2,
            label: `${(i * 7).toString(16).toUpperCase()}:${(j * 11).toString(16).toUpperCase()}`,
            pulse: Math.random() * Math.PI * 2,
          });
        }
      }
    };

    const drawFrame = () => {
      ctx.fillStyle = BG;
      ctx.fillRect(0, 0, width, height);

      // Connections. Nodes are grid-ordered, so each node can only ever be near
      // its ±2 grid neighbours — checking those windows (instead of every pair)
      // keeps the frame cost linear at any screen size.
      for (let j = 0; j < rows; j++) {
        for (let i = 0; i < cols; i++) {
          const n = nodes[j * cols + i];
          if (!n) continue;
          for (let dj = -2; dj <= 2; dj++) {
            const nj = j + dj;
            if (nj < 0 || nj >= rows) continue;
            for (let di = -2; di <= 2; di++) {
              if (di === 0 && dj === 0) continue;
              // Upper neighbours only, so each line is drawn once.
              if (di < 0 || (di === 0 && dj < 0)) continue;
              const ni = i + di;
              if (ni < 0 || ni >= cols) continue;
              const n2 = nodes[nj * cols + ni];
              if (!n2) continue;
              const dx = n.x - n2.x;
              const dy = n.y - n2.y;
              const distSq = dx * dx + dy * dy;
              if (distSq < MAX_CONN_SQ) {
                const alpha = (1 - Math.sqrt(distSq) / MAX_CONN) * 0.18;
                ctx.strokeStyle = `rgba(${NODE_RGB}, ${alpha.toFixed(3)})`;
                ctx.lineWidth = 0.7;
                ctx.beginPath();
                ctx.moveTo(n.x, n.y);
                ctx.lineTo(n2.x, n2.y);
                ctx.stroke();
              }
            }
          }
        }
      }

      // Nodes, radar rings and readouts.
      for (const n of nodes) {
        const dx = mouse.x - n.x;
        const dy = mouse.y - n.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const isNear = dist < mouse.radius;

        const baseAlpha = isNear ? 0.95 : 0.25 + Math.sin(n.pulse) * 0.1;
        ctx.fillStyle = isNear ? `rgba(${ACCENT_RGB}, ${baseAlpha})` : `rgba(${NODE_RGB}, ${baseAlpha})`;
        const radius = isNear ? n.radius * 2.2 : n.radius + Math.sin(n.pulse) * 0.3;
        ctx.beginPath();
        ctx.arc(n.x, n.y, Math.max(0.5, radius), 0, Math.PI * 2);
        ctx.fill();

        if (dist < 90) {
          const ring = ((n.pulse * 20) % 30) + 4;
          const ringAlpha = (1 - ring / 34) * 0.4;
          ctx.strokeStyle = `rgba(${ACCENT_RGB}, ${ringAlpha.toFixed(3)})`;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(n.x, n.y, ring, 0, Math.PI * 2);
          ctx.stroke();

          ctx.font = "8px ui-monospace, SFMono-Regular, Consolas, monospace";
          ctx.fillStyle = `rgba(${ACCENT_RGB}, 0.85)`;
          ctx.fillText(n.label, n.x + 10, n.y - 10);
        }
      }
    };

    const handleResize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      canvas.width = Math.max(1, Math.round(width * dpr));
      canvas.height = Math.max(1, Math.round(height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      initNodes();
      drawFrame();
    };

    const handleMouseMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      mouse.x = e.clientX - rect.left;
      mouse.y = e.clientY - rect.top;
    };

    const handleMouseLeave = () => {
      mouse.x = -1000;
      mouse.y = -1000;
      mouse.prevX = -1000;
      mouse.prevY = -1000;
    };

    let lastTime = 0;
    const render = (now: number) => {
      const dt = Math.min((now - lastTime) / 1000, 0.05);
      lastTime = now;

      // Cursor velocity (drives the shockwave strength on fast sweeps).
      mouse.vx = (mouse.x - mouse.prevX) / (dt * 1000 || 1);
      mouse.vy = (mouse.y - mouse.prevY) / (dt * 1000 || 1);
      mouse.prevX = mouse.x;
      mouse.prevY = mouse.y;
      const speed = Math.sqrt(mouse.vx * mouse.vx + mouse.vy * mouse.vy);

      // Spring-mass-damping physics: repel from cursor, ease back to anchor.
      const SPRING_K = 18;
      const DAMPING = 0.82;
      for (const n of nodes) {
        n.pulse += dt * 3;

        const dx = mouse.x - n.x;
        const dy = mouse.y - n.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < mouse.radius && dist > 0) {
          const power = 1 - dist / mouse.radius;
          const force = power * (1500 + speed * 150);
          const angle = Math.atan2(dy, dx);
          n.vx -= Math.cos(angle) * force * dt;
          n.vy -= Math.sin(angle) * force * dt;
        }

        n.vx += (n.baseX - n.x) * SPRING_K * dt;
        n.vy += (n.baseY - n.y) * SPRING_K * dt;
        n.vx *= DAMPING;
        n.vy *= DAMPING;
        n.x += n.vx * dt * 60;
        n.y += n.vy * dt * 60;
      }

      drawFrame();
      raf = requestAnimationFrame(render);
    };

    const start = () => {
      if (raf || reducedMotion) return;
      lastTime = performance.now();
      raf = requestAnimationFrame(render);
    };
    const stop = () => {
      if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
    };

    handleResize();
    window.addEventListener("resize", handleResize);

    let io: IntersectionObserver | null = null;
    if (!reducedMotion) {
      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseleave", handleMouseLeave);
      io = new IntersectionObserver(
        ([entry]) => {
          if (entry && entry.isIntersecting) start();
          else stop();
        },
        { rootMargin: "200px 0px" }
      );
      io.observe(canvas);
      start();
    }

    return () => {
      stop();
      io?.disconnect();
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseleave", handleMouseLeave);
    };
  }, []);

  return <canvas ref={canvasRef} className={className} aria-hidden="true" />;
}