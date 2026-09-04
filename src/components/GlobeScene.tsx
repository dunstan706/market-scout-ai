import { useEffect, useRef } from "react";

/**
 * Live position of the globe's limb, published every frame so the page's
 * constellation can warp around the sphere (and glow amber near it) with the
 * exact same center and radius the globe draws with — no iframe, no messaging.
 */
export type GlobeState = {
  cx: number;
  cy: number;
  radius: number;
  /** The revealed business mark's live screen position (CSS px, viewport
   *  coords) so the page can anchor a callout box below it. */
  markX: number;
  markY: number;
  markVisible: boolean;
};

/* ---------- study constants (warm ink-and-paper palette) ---------- */

const FACE =
  '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif';
const INK = "245, 240, 230"; // paper type on a near-black ground
const GROUND = "#1C1715"; // the landing ink — the sphere's opaque body
const MW = 288;
const MH = 144;
const PHRASE = "everypointonthisballisapathbacktoanotherone";

const LAND_B64 = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAPcBAOD/HwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACA//+P//f/LwgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD4/v/4/////wcAAAAEAPABAAAAfAAAAAAAAAAAAAAAAAAAAADg9w/4/////wEAAP4AAAAAAAAA+AAAAAAAAAAAAAAAAAAAAIAG+Of//////wAAAHwGAAAAAAAAAAMAAAAAAAAAAAAAAACABwAc/4P//////wAAADAAAAAAQAAAAD4AAAAAAAAAAAAAAAAAfMbDcQAA/v///wAAAAAAAADABwAA//8HAMAPAAAAAAAAAABgAAAAAAAA/P///wAAAAAAAABwAADg//8AAAAAAAAAAAAAAADwG457dwcA8P//HwAAAAAAAAAYAAD///9/eAAAAAAAAAAAAAD4/g0H/w8A8P//PwAAAAAAAAAOgOv/////fwD/AAAAAAA/AAAA/B84/v8A8P//LwAAAAD4AAAA4PP//////////wAAAOD///H/+D/3cPgDoP//DwAAAID/BwAAx/v/////////P4AA/P///////////////////////w8AAOcBAAgAAAAAAAAAAAAAgP///////////////////////wcAACYAAAQAAAAAAAAAAAAAgf///////////////////////wMM8AAAAAAAAAAAAAAAAAAAIID/////////e+wPwH8AgA8AAP/5z/////////////////8/ANH///////9/AIALgD8AAAAAwH/+//////////////////9/APj///////8fADwAAD8AAAAA8D/+//////////////////sPAPC/+f////8fAPwAADgAAAAA8D/+////////////////D/wBAMCfAP////8PAPwYAAAAAAAA8H/4//////////////9/DgcAAAAcAOD///8/APw/AAAAAAAQAB7w//////////////8BgAMAAAACAMD/////Afh/AAAAAAA4gBz+/////////////38A4AMAAMAAAMD/////B/z/AAAAAABwwAb+/////////////x8A8AEAAAAAAAD/////P///AwAAAADmgOH//////////////z8A4AAAAAAAAAD+////P/7/BwAAAAD28P////////////////8D4AAAAAAAAAD8////f/7/BwAAAADz+f////////////////8HIAAAAAAAAAD6////////BAAAAABw/v////////////////8EAAAAAAAAAADo//////8jHgAAAACA//////////////////8MAAAAAAAAAADQ//////8OPgAAAADw//////////////////8AAAAAAAAAAADg//////+PIAAAAADA////v////////////38EAAAAAAAAAADg////////AAAAAACA//v/zD/8/////////z8AAAAAAAAAAADg//////8bAAAAAACA//N/gD///////////x8GAAAAAAAAAADw//////8AAAAAAAD+B8c/AD/+/////////wcPAAAAAAAAAADg//////8AAAAAAAD+gx4/DH74/////////wABAAAAAAAAAADg/////x8AAAAAAAD+gbCn///8////////fQABAAAAAAAAAADg/////w8AAAAAAAD/gCDn///4//////9/MgADAAAAAAAAAADA/////w8AAAAAAAD+AADm/3/4//////8/cIABAAAAAAAAAADA/////wcAAAAAAAA44AHC///5////////4+ABAAAAAAAAAACA/////wcAAAAAAACI/wEA4P//////////4OgAAAAAAAAAAAAA/////wMAAAAAAAD4/wAA4P//////////ADYAAAAAAAAAAAAA/P///wEAAAAAAAD+/wEA8P//////////AQcAAAAAAAAAAAAA+P//fwAAAAAAAAD//w8P8P//////////AQEAAAAAAAAAAAAAyP//fwAAAAAAAAD//3//////////////AQAAAAAAAAAAAAAA0P+PYQAAAAAAAAD//////z//////////AwAAAAAAAAAAAAAAoP8HwAAAAAAAAMD/////83/+////////AQAAAAAAAAAAAAAAIP8DwAAAAAAAAOD/////5//I////////AAAAAAAAAAAAAAAAQP4DgAAAAAAAAPD/////z/+A////////AAAAAAAAAAAAAAAAAPwDAAIAAAAAAPD/////z/8ZwP////9/AQAAAAAAAAAAAAAAAPgDQAAAAAAAAPj/////j/9/gP////8fAQAAAAAAAAAAAAAAAPADEAMAAAAAAPz/////v///AP9//P8DAAAAAAAAAAAAAAAAAPADAwwAAAAAAPj/////P/9/APw//B8AAAAAAAAAAAAIAAAAAPCHA8AAAAAAAPj/////P/4/APwP+J8BAAAAAAAAAAAAAAAAAMD/A0YEAAAAAPj/////f/4fAPwH+B8AAwAAAAAAAAAAAAAAAAD/AQAAAAAAAPj/////f/wHAPgD8D8AAwAAAAAAAAAAAAAAAADgHwAAAAAAAPj///////wDAPgAwH8AAQAAAAAAAAAAAAAAAADAHwAAAAAAAPz//////30AAPAAwH8AAAAAAAAAAAAAAAAAAAAAHAAAAAAAAPj//////wsAAPAAgH4AAQAAAAAAAAAAAAAAAAAAGEAAAAAAAPj//////wMBAPAAgHwAAAAAAAAAAAAAAAAAAAAAGPAhAAAAAPD///////cBAOAAgDiABAAAAAAAAAAAAAAAAAAAIPl/AAAAAOD///////8AAGABABBAFAAAAAAAAAAAAAAAAAAAgP7/AQAAAMD///////8AAAABgAAAHAAAAAAAAAAAAAAAAAAAAPz/AQAAAID///////8AAAABAAEgCAAAAAAAAAAAAAAAAAAAAPz/HwAAAAD/8P///38AAAAAAANgAAAAAAAAAAAAAAAAAAAAAPz/fwAAAAAAoP///z8AAAAAYAd4AAAAAAAAAAAAAAAAAAAAAPz/fwAAAAAAAP///x8AAAAAwAY8AAAAAAAAAAAAAAAAAAAAAP7//wAAAAAAAP///w8AAAAAgAc+AAAAAAAAAAAAAAAAAAAAAP///wAAAAAAAP///wcAAAAAgIM/TwAAAAAAAAAAAAAAAAAAAP///wEAAAAAgP///wMAAAAAAIc/QAQAAAAAAAAAAAAAAAAAgP///w8AAAAAgP///wEAAAAAAA6fAUQAAAAAAAAAAAAAAAAAAP////8AAAAAAP///wAAAAAAAB6ewuwDAgAAAAAAAAAAAAAAgP////8DAAAAAP7//wAAAAAAABwAAvAPAgAAAAAAAAAAAAAAgP////8PAAAAAPz/fwAAAAAAABAAAMCfAQAAAAAAAAAAAAAAAP////8PAAAAAPz//wAAAAAAAOADAIA/MAAAAAAAAAAAAAAAAP7///8PAAAAAPz/fwAAAAAAAAAPAMBngAAAAAAAAAAAAAAAAP7///8PAAAAAPz//wAAAAAAAAAACABAAAAAAAAAAAAAAAAAAPz///8HAAAAAPj//wAAAAAAAAAAAAAAAAIAAAAAAAAAAAAAAPz///8DAAAAAPj//wAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAPj///8BAAAAAPz//4AAAAAAAAAAAB8GAAAAAAAAAAAAAAAAAPj///8BAAAAAPz//8EAAAAAAAAAIB8OAAAAAAAAAAAAAAAAAPD///8BAAAAAP7//+AAAAAAAAAA+B8OACAAAAAAAAAAAAAAAMD///8BAAAAAP7/f/gAAAAAAAAA/H8eAAAAAAAAAAAAAAAAAID///8AAAAAAP7/H/gAAAAAAAAA/P8fAABAAAAAAAAAAAAAAAD///8AAAAAAPz/D3AAAAAAAAAA/v8/AAAAAAAAAAAAAAAAAAD///8AAAAAAPj/D3gAAAAAAADA//9/AAgAAAAAAAAAAAAAAAD//38AAAAAAPj/DzgAAAAAAADw////AAAAAAAAAAAAAAAAAAD//x8AAAAAAPD/DzgAAAAAAAD4////AQAAAAAAAAAAAAAAAAD//wMAAAAAAPD/DzgAAAAAAAD4////AwAAAAAAAAAAAAAAAID//wEAAAAAAPD/AwAAAAAAAAD4////AwAAAAAAAAAAAAAAAID//wEAAAAAAPD/AwAAAAAAAAD4////BwAAAAAAAAAAAAAAAID//wEAAAAAAOD/AwAAAAAAAAD4////BwAAAAAAAAAAAAAAAID//wAAAAAAAOD/AQAAAAAAAADw////BwAAAAAAAAAAAAAAAID//wAAAAAAAMD/AAAAAAAAAADw////AwAAAAAAAAAAAAAAAID/fwAAAAAAAIB/AAAAAAAAAADgf/z/AwAAAAAAAAAAAAAAAID/PwAAAAAAAIA/AAAAAAAAAADgB/D/AQAAAAAAAAAAAAAAAMD/HQAAAAAAAIABAAAAAAAAAADwAND/AQAAAAAAAAAAAAAAAMD/AwAAAAAAAAAAAAAAAAAAAAAAAID/AAAIAAAAAAAAAAAAAMD/BwAAAAAAAAAAAAAAAAAAAAAAAAD/AAAQAAAAAAAAAAAAAOD/AwAAAAAAAAAAAAAAAAAAAAAAAAA+AABwAAAAAAAAAAAAAOA/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA4AAAAAAAAAAAAAOA/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAOAPAAAAAAAAAAAAAAAAAAAAAAAAAABwAAAGAAAAAAAAAAAAAMAPAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAADAAAAAAAAAAAAAPAPAAAAAAAAAAAAAAAAAAAAAAAAAAAAAMABAAAAAAAAAAAAAPADAAAAAAAAAAAAAAAAAAAAAAAAAAAAAOABAAAAAAAAAAAAAPAHAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAPAHAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAPADAAAAAAAAAAAAAAAAgAAAAAAAAAAAAAAAAAAAAAAAAAAAAPABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAPCBAwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAGABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAMAHAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAwAAAAAAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAcAAAAAAAAAAAAAAA+AABAAJ8//j8PAAAAAAAAAAAAAAAAAAAMAAAAAAAAAAAAAPD/fwD///////8/AAAAAAAAAAAAAAAAAIA+AAAAAAAAAAAAPP///8D/////////HwAAAAAAAAAAAAAAAIA9AAAAAAAA8Pz/////P/j//////////wMAAAAAAAAAAMAAAPB9AAAAAID/////////P/7///////////8BAAAAAAAAAOABAwB/AAAAAPD///////////////////////8AAAAAAFACPoD///9/AAAAAPD//////////////////////x8AAAAA+P////////8HAAAAAP///////////////////////wcAAAAA/v///////wMAAAAA/v///////////////////////wcAAAD8/////////w8AAA7w/////////////////////////w8AAMAB/////////wMAgB84/////////////////////////wEAAAAA/P///////3/w4AcA/////////////////////////wAAAADg//////////8/gM///////////////////////////wMAAADg/////////////f///////////////////////////z8A7wMA/v////////////////////////////////////////8/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

let LAND: Uint8Array | null = null;
function landBitmap(): Uint8Array {
  if (LAND) return LAND;
  const bin = atob(LAND_B64);
  const land = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) land[i] = bin.charCodeAt(i);
  LAND = land;
  return land;
}

function isLand(lon: number, lat: number) {
  const land = landBitmap();
  const gx = Math.floor(((lon + 180) / 360) * MW);
  const gy = Math.floor(((90 - lat) / 180) * MH);
  if (gx < 0 || gx >= MW || gy < 0 || gy >= MH) return false;
  const b = gy * MW + gx;
  return (((land[b >> 3] ?? 0) >> (b & 7)) & 1) === 1;
}

type GlobeNode = { lat: number; lon: number; land: boolean; c: string };

/* Chrome rasterises and caches a glyph per (font, transform); snapping every
   rotation to one of 64 steps keeps the frame cost down at full resolution. */
const QA = (Math.PI * 2) / 64;
function qang(a: number) {
  return Math.round(a / QA) * QA;
}

function easeInOut(t: number) {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}
function easeOutBack(t: number) {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

/* The reveal sequence: after a business is added, the globe spins one full
   turn at a faster pace while the land type fades away to the plain dotted
   field, then a mark pops onto the front and the globe holds still. */
const REVEAL_SPEED = 3.0; // rad/s — one full turn ≈ 2.1s
const REVEAL_MS = ((Math.PI * 2) / REVEAL_SPEED) * 1000;
const MARK_POP_MS = 650;
/* With the globe's resting tilt (-0.36) the south pole faces the viewer, so
   the front meridian's northern latitudes sit behind the tangent plane and
   would be culled. A southern latitude lands the mark on the visible front. */
const MARK_LAT = -15;
const ACCENT = "190, 105, 25";

export function GlobeScene({
  stateRef,
  className,
  revealTriggerRef,
}: {
  /** Receives the globe's live center + limb radius every frame. */
  stateRef: React.MutableRefObject<GlobeState>;
  className?: string;
  /** Increment to start the reveal sequence (one fast full rotation that
   *  clears the globe's type, then pops the business mark onto its front). */
  revealTriggerRef?: React.MutableRefObject<number>;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let w = 0;
    let h = 0;
    let dpr = 1;
    const resize = () => {
      const r = canvas.getBoundingClientRect();
      if (!r.width || !r.height) return;
      dpr = Math.min(1.5, window.devicePixelRatio || 1);
      w = r.width;
      h = r.height;
      canvas.width = Math.max(1, Math.round(w * dpr));
      canvas.height = Math.max(1, Math.round(h * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    /* the halftone grid is fine enough to draw a coastline; every third land
       cell also carries a letter from the phrase. Built once, lazily. */
    let nodes: GlobeNode[] | null = null;
    const ensureNodes = () => {
      if (nodes) return nodes;
      nodes = [];
      const LAT_STEP = 3.05;
      let k = 0;
      let run = 0;
      let sea3 = 0;
      for (let lat = -86; lat <= 86; lat += LAT_STEP) {
        const rl = Math.cos((lat * Math.PI) / 180);
        const n = Math.max(1, Math.round(98 * rl));
        for (let i = 0; i < n; i++) {
          const lon = -180 + (360 * i) / n;
          const l = isLand(lon, lat);
          if (!l && sea3++ % 2 === 1) continue; // half the ocean carries the sphere
          let letter = "";
          if (l && run++ % 2 === 0) letter = PHRASE.charAt(k++ % PHRASE.length);
          nodes.push({
            lat: (lat * Math.PI) / 180,
            lon: (lon * Math.PI) / 180,
            land: l,
            c: letter,
          });
        }
      }
      return nodes;
    };

    /* prebuilt rgba strings, so drawing never builds a color per glyph */
    const SOFT = 0.88;
    const INK64: string[] = [];
    for (let q0 = 0; q0 < 64; q0++) {
      INK64.push(`rgba(${INK},${((q0 / 63) * SOFT).toFixed(4)})`);
    }
    const ink = (a: number) => INK64[a <= 0 ? 0 : a >= 1 ? 63 : (a * 63) | 0] ?? "";

    let spin = 2.1;
    let vel = 0.16;
    let hover = false;
    let drag: { x: number; y: number } | null = null;
    let tilt = -0.36;
    let vtilt = 0;
    let zoom = 1;
    let zoomT = 1;
    let look: { x: number; y: number } | null = null;
    let raf = 0;
    let last = 0;
    // the limb as last drawn, for hit-testing the hover state
    let lastCx = 0;
    let lastCy = 0;
    let lastR = 0;
    /* reveal sequence state */
    const reveal = {
      active: false,
      done: false,
      t: 0,
      startSpin: 0,
      markLon: 0,
      popT: 0,
    };
    let lastTrigger = 0;

    const startReveal = () => {
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      reveal.startSpin = spin;
      reveal.markLon = -spin; // faces dead front when the full turn completes
      reveal.t = 0;
      reveal.popT = 0;
      if (reduced) {
        reveal.active = false;
        reveal.done = true;
        vel = 0;
      } else {
        reveal.active = true;
        reveal.done = false;
        vel = REVEAL_SPEED;
      }
    };

    const local = (e: PointerEvent | WheelEvent) => {
      const r = canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };

    /* The canvas is a full-viewport, pointer-events-none layer, so interaction
       is handled at the window level — drag/wheel anywhere on the page drives
       the globe, while UI (pills, links) still works because its events are
       ignored here. */
    const isInteractive = (t: EventTarget | null) =>
      t instanceof Element &&
      !!t.closest("button, a, input, textarea, select, [role], [data-skip-globe]");

    const onPointerDown = (e: PointerEvent) => {
      if (isInteractive(e.target)) return;
      drag = local(e);
    };
    const onPointerMove = (e: PointerEvent) => {
      const p = local(e);
      look = p;
      hover = Math.hypot(p.x - lastCx, p.y - lastCy) < lastR * 1.3;
      if (!drag || reveal.active) return; // let the sweep play out untouched
      const u = Math.min(w, h);
      vel = ((p.x - drag.x) / u) * 9;
      vtilt = -((p.y - drag.y) / u) * 6;
      tilt = Math.max(-1.15, Math.min(1.15, tilt + vtilt * 0.016));
      drag = p;
    };
    const release = () => {
      drag = null;
    };
    const onWheel = (e: WheelEvent) => {
      if (isInteractive(e.target)) return;
      e.preventDefault();
      /* cap so the sphere's disc always fits the viewport (diameter = 0.986·u
         at max) — beyond this it would clip against the screen edge and the
         warp would engulf the whole starfield instead of parting around the
         limb */
      zoomT = Math.max(0.85, Math.min(1.55, zoomT * Math.exp(-e.deltaY * 0.0016)));
    };
    const onBlur = () => {
      hover = false;
      look = null;
    };

    const draw = (now: number, dt: number) => {
      ctx.clearRect(0, 0, w, h);
      const u = Math.min(w, h);

      zoom += (zoomT - zoom) * Math.min(1, dt / 180);
      if (reveal.active) {
        // the sweep: one full turn at a fixed fast pace, then stop dead
        reveal.t += dt / REVEAL_MS;
        if (reveal.t >= 1) {
          reveal.t = 1;
          spin = reveal.startSpin + Math.PI * 2; // land the mark dead front
          vel = 0;
          reveal.active = false;
          reveal.done = true;
          reveal.popT = 0;
        } else {
          spin += REVEAL_SPEED * (dt / 1000);
        }
      } else {
        if (!drag) {
          const idle = reveal.done ? 0 : hover ? 0.045 : 0.16; // hold still after the reveal
          vel += (idle - vel) * Math.min(1, reveal.done ? dt / 250 : dt / 900);
          vtilt *= Math.pow(0.9, dt / 16);
          tilt += (vtilt * dt) / 1000;
          tilt += (-0.36 - tilt) * Math.min(1, dt / 4000);
        }
        spin += (vel * dt) / 1000;
      }
      if (reveal.done && reveal.popT < 1) {
        reveal.popT = Math.min(1, reveal.popT + dt / MARK_POP_MS);
      }

      const cx = w / 2;
      const cy = h / 2 + u * 0.035;
      const R = u * 0.318 * zoom;
      const fs = u * 0.0275 * Math.pow(zoom, 0.72);
      const cs = Math.cos(spin);
      const sn = Math.sin(spin);
      const ct = Math.cos(tilt);
      const st = Math.sin(tilt);

      // Publish the limb for the constellation's warp (same document, live).
      const stRef = stateRef.current;
      stRef.cx = cx;
      stRef.cy = cy;
      stRef.radius = R;
      lastCx = cx;
      lastCy = cy;
      lastR = R;

      /* the sphere's body: an opaque disc of the ground colour, so the page's
         starfield is hidden behind the globe and parts around its limb — a
         circle, never a square. */
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.fillStyle = GROUND;
      ctx.fill();

      /* a soft pool of light under the cursor, so the type near it reads */
      const lx = look && !drag ? look.x : -1e9;
      const ly = look && !drag ? look.y : -1e9;
      const lr = u * 0.2;
      const lr2 = lr * lr;

      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      /* dots first, in depth passes — setting ctx.font per glyph is what kills
         the frame, so positions are bucketed by depth instead */
      const sea: number[] = [];
      const soil: number[] = [];
      /* interleaved: [px, py, angle, letter, 0] per letter, bucketed by depth */
      type Letter = [number, number, number, string, number];
      const land8: Letter[][] = [];
      for (const nd of ensureNodes()) {
        const cl = Math.cos(nd.lat);
        const x0 = cl * Math.cos(nd.lon);
        const y0 = Math.sin(nd.lat);
        const z0 = cl * Math.sin(nd.lon);
        const x1 = x0 * cs - z0 * sn;
        const z1 = x0 * sn + z0 * cs;
        const y2 = y0 * ct - z1 * st;
        const z2 = y0 * st + z1 * ct;
        if (z2 <= 0.02) continue; // solid earth: the far side is hidden

        const px = cx + x1 * R;
        const py = cy - y2 * R;
        const dx = px - lx;
        const dy = py - ly;
        const glow = dx * dx + dy * dy < lr2 ? 1 - Math.sqrt(dx * dx + dy * dy) / lr : 0;
        if (!nd.land) {
          sea.push(px, py, Math.min(0.999, z2 + glow * 0.55));
          continue;
        }
        if (!nd.c) {
          soil.push(px, py, Math.min(0.999, z2 + glow * 0.55));
          continue;
        }

        /* tangent to this parallel, so the type runs east */
        const tx0 = -Math.sin(nd.lon);
        const tz0 = Math.cos(nd.lon);
        const tx1 = tx0 * cs - tz0 * sn;
        const tz1 = tx0 * sn + tz0 * cs;
        const ang = qang(Math.atan2(tz1 * st, tx1));
        const b = Math.min(7, Math.max(0, (Math.min(0.999, z2 + glow * 0.6) * 7.99) | 0));
        (land8[b] || (land8[b] = [])).push([px, py, ang, nd.c, 0]);
      }

      /* during the reveal sweep the land type fades away, leaving the plain
         dotted field the globe carries everywhere else */
      const landA = reveal.active
        ? 1 - easeInOut(Math.min(1, reveal.t / 0.65))
        : reveal.done
          ? 0
          : 1;

      /* sea and land as a halftone, six depth passes each, one path per pass */
      const dmin = Math.max(0.7, u * 0.0029);
      const dots = (list: number[], base: number, gain: number, grow: number) => {
        for (let lvl = 0; lvl < 6; lvl++) {
          const z = (lvl + 0.5) / 6;
          const dsz = dmin * grow * (0.55 + 0.75 * z);
          ctx.fillStyle = ink(base + gain * z);
          ctx.beginPath();
          for (let q = 0; q < list.length; q += 3) {
            const qx = list[q]!;
            const qy = list[q + 1]!;
            const qz = list[q + 2]!;
            const lv = qz >= 1 ? 5 : (qz * 6) | 0;
            if (lv !== lvl) continue;
            ctx.rect(qx - dsz / 2, qy - dsz / 2, dsz, dsz);
          }
          ctx.fill();
        }
      };
      dots(sea, 0.1, 0.22, 1.0);
      ctx.globalAlpha = landA;
      dots(soil, 0.34, 0.46, 1.7);

      /* land: eight size buckets, so ctx.font is touched eight times */
      for (let bi = 0; bi < 8; bi++) {
        const arr = land8[bi];
        if (!arr || !arr.length) continue;
        const zb = (bi + 0.5) / 8;
        ctx.font = `bold ${(fs * (0.42 + 0.58 * zb)).toFixed(2)}px ${FACE}`;
        ctx.fillStyle = ink(0.28 + 0.72 * Math.pow(zb, 0.6));
        for (let t = 0; t < arr.length; t += 5) {
          const item = arr[t]!;
          ctx.save();
          ctx.translate(item[0], item[1]);
          ctx.rotate(item[2]);
          ctx.fillText(item[3], 0, 0);
          ctx.restore();
        }
      }
      ctx.globalAlpha = 1;

      /* the business mark: pops onto the front after the sweep, then stays as
         a live anchor for the page's callout box below it */
      if (reveal.done) {
        const mlat = (MARK_LAT * Math.PI) / 180;
        const x0 = Math.cos(mlat) * Math.cos(reveal.markLon);
        const y0 = Math.sin(mlat);
        const z0 = Math.cos(mlat) * Math.sin(reveal.markLon);
        const x1 = x0 * cs - z0 * sn;
        const z1 = x0 * sn + z0 * cs;
        const y2 = y0 * ct - z1 * st;
        const z2 = y0 * st + z1 * ct;
        if (z2 > 0.02) {
          const mpx = cx + x1 * R;
          const mpy = cy - y2 * R;
          stRef.markX = mpx;
          stRef.markY = mpy;
          stRef.markVisible = true;

          const p = easeOutBack(reveal.popT);
          const ringT = reveal.popT;
          const breathe = 0.5 + 0.5 * Math.sin(now / 420);

          // soft amber halo
          ctx.fillStyle = `rgba(${ACCENT}, ${(0.28 * (1 - ringT)).toFixed(3)})`;
          ctx.beginPath();
          ctx.arc(mpx, mpy, 6 + ringT * R * 0.2 + breathe * 3, 0, Math.PI * 2);
          ctx.fill();

          // expanding paper ring
          ctx.strokeStyle = `rgba(245, 240, 230, ${((1 - ringT) * 0.8).toFixed(3)})`;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(mpx, mpy, 8 + ringT * R * 0.14, 0, Math.PI * 2);
          ctx.stroke();

          // the mark itself: an amber diamond with a paper core
          ctx.save();
          ctx.translate(mpx, mpy);
          ctx.rotate(Math.PI / 4);
          ctx.fillStyle = `rgba(${ACCENT}, 0.95)`;
          const half = Math.max(0.001, 5.5 * p);
          ctx.fillRect(-half, -half, half * 2, half * 2);
          ctx.restore();
          ctx.fillStyle = "rgba(245, 240, 230, 0.9)";
          ctx.beginPath();
          ctx.arc(mpx, mpy, Math.max(0.001, 1.8 * p), 0, Math.PI * 2);
          ctx.fill();
        } else {
          stRef.markVisible = false;
        }
      } else {
        stRef.markVisible = false;
      }
    };

    const loop = (now: number) => {
      const dt = Math.min(now - last, 100);
      last = now;
      const trig = revealTriggerRef?.current ?? 0;
      if (trig !== lastTrigger) {
        lastTrigger = trig;
        startReveal();
      }
      draw(now, dt);
      raf = requestAnimationFrame(loop);
    };
    const start = () => {
      if (raf) return;
      last = performance.now();
      raf = requestAnimationFrame(loop);
    };
    const stop = () => {
      if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
    };

    resize();
    window.addEventListener("resize", resize);
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", release);
    window.addEventListener("pointercancel", release);
    window.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("blur", onBlur);
    document.addEventListener("mouseleave", onBlur);

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      draw(performance.now(), 16.7); // a single static frame
    } else {
      start();
    }

    return () => {
      stop();
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", release);
      window.removeEventListener("pointercancel", release);
      window.removeEventListener("wheel", onWheel);
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("mouseleave", onBlur);
    };
  }, [stateRef, revealTriggerRef]);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      aria-hidden="true"
      style={{ touchAction: "none", pointerEvents: "none" }}
    />
  );
}