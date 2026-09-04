import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Expand, Plus } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { GlobeScene, type GlobeState } from "@/components/GlobeScene";
import { AnimatedNavFramer } from "@/components/ui/animated-nav-framer";
import { ConstellationGrid } from "@/components/ConstellationGrid";
import { createBusiness, type BusinessType } from "@/lib/account.functions";

export const Route = createFileRoute("/dashboardtest")({
  head: () => ({
    meta: [
      { title: "Localscope" },
      { robots: "noindex" },
    ],
  }),
  component: DashboardTestPage,
});

const BUSINESS_TYPES: Array<{ value: BusinessType; label: string }> = [
  { value: "salon", label: "Salon" },
  { value: "spa", label: "Spa" },
  { value: "other", label: "Other" },
];

type AddState = "idle" | "saving" | "error";

function DashboardTestPage() {
  const router = useRouter();
  const addBusiness = useServerFn(createBusiness);
  // Shared, live globe state: GlobeScene writes its center + limb radius here
  // every frame, and the constellation reads it for the warp — same document,
  // so no iframe and no postMessage.
  const fallbackHalf =
    typeof window === "undefined"
      ? 200
      : Math.min(window.innerHeight * 0.8, window.innerWidth * 0.8) / 2;
  const globeStateRef = useRef<GlobeState>({
    cx: 0,
    cy: 0,
    radius: fallbackHalf * 0.318,
    markX: 0,
    markY: 0,
    markVisible: false,
  });
  // Incrementing this tells the globe to play its reveal sequence.
  const revealTriggerRef = useRef(0);

  // Add-a-business overlay state.
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<{
    businessName: string;
    businessType: BusinessType;
    location: string;
  }>({ businessName: "", businessType: "salon", location: "" });
  const [addState, setAddState] = useState<AddState>("idle");
  const [addError, setAddError] = useState("");

  // Dev aids: expose the live warp radius and a reveal trigger for verification.
  useEffect(() => {
    const id = setInterval(() => {
      const main = document.querySelector("main");
      main?.setAttribute("data-warp-radius", String(Math.round(globeStateRef.current.radius)));
      main?.setAttribute("data-mark", globeStateRef.current.markVisible ? "1" : "0");
    }, 300);
    const w = window as unknown as Record<string, unknown>;
    w["__reveal"] = () => {
      revealTriggerRef.current += 1;
    };
    return () => {
      clearInterval(id);
      delete w["__reveal"];
    };
  }, []);

  // The "run a scan" callout box rides below the globe's mark, following its
  // live screen position every frame (drag the globe and it tags along).
  const boxRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    let raf = 0;
    let wasVisible = false;
    const tick = () => {
      const s = globeStateRef.current;
      const box = boxRef.current;
      if (box) {
        if (s.markVisible && s.markY > 0) {
          const bw = 232;
          const bh = box.offsetHeight || 120;
          let left = s.markX - bw / 2;
          let top = s.markY + 26;
          left = Math.max(8, Math.min(window.innerWidth - 8 - bw, left));
          top = Math.max(8, Math.min(window.innerHeight - 8 - bh, top));
          box.style.left = `${left}px`;
          box.style.top = `${top}px`;
          box.style.opacity = "1";
          if (!wasVisible) {
            box.classList.remove("animate-rise");
            void box.offsetWidth; // restart the entrance animation
            box.classList.add("animate-rise");
            wasVisible = true;
          }
        } else {
          wasVisible = false;
          box.style.opacity = "0";
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  async function onSignOut() {
    await supabase.auth.signOut();
    await router.navigate({ to: "/" });
  }

  function openAdd() {
    setDraft({ businessName: "", businessType: "salon", location: "" });
    setAddState("idle");
    setAddError("");
    setAdding(true);
  }
  function closeAdd() {
    setAdding(false);
  }

  async function onSubmitAdd(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setAddState("saving");
    setAddError("");
    try {
      await addBusiness({ data: draft });
      // First business created — close the panel and let the globe play its
      // reveal: one fast full turn, the type fades to a plain dotted field,
      // and the mark pops onto the front.
      closeAdd();
      revealTriggerRef.current += 1;
    } catch (err) {
      const message =
        err instanceof Error && err.message ? err.message : "Could not add your business. Please try again.";
      console.error(err);
      setAddError(message);
      setAddState("error");
    }
  }

  return (
    <main className="theme-dark relative h-screen w-full overflow-hidden">
      {/* Page-wide constellation — lights up amber near the cursor (small
          radius), and warps around the globe's limb instead of the cursor.
          The warp tracks the sphere radius the globe writes live. */}
      <ConstellationGrid
        className="fixed inset-0 h-screen w-full"
        warp={false}
        glowRadius={85}
        globeWarp
        globeStateRef={globeStateRef}
      />

      {/* The globe, drawn directly on the page (no iframe). A full-viewport
          canvas that is transparent everywhere outside the sphere's disc, so
          the starfield shows through all around it — and since the canvas is
          as big as the screen, the disc can never be clipped by a square.
          Interactions (drag/zoom) are handled at the window level. */}
      <GlobeScene
        stateRef={globeStateRef}
        revealTriggerRef={revealTriggerRef}
        className="fixed inset-0 h-screen w-full"
      />

      {/* Expanded floating pill — dashboard navigation. */}
      <AnimatedNavFramer
        collapsible={false}
        logo={
          <Link to="/" className="whitespace-nowrap font-serif text-xl tracking-tight sm:text-2xl">
            Localscope<span className="text-accent">.</span>
          </Link>
        }
        items={[
          { name: "Business", href: "/dashboard" },
          { name: "Plans", href: "/dashboard" },
          { name: "Profile", href: "/dashboard" },
          { name: "Sign out", onClick: onSignOut, danger: true },
        ]}
      />

      {/* Add-business pill — expands into the add-a-business panel. The icon
          rotates into an × while the panel is open, and the pill stays above
          the overlay so it doubles as the close button. */}
      <div className="fixed bottom-6 left-1/2 z-[60] -translate-x-1/2">
        <button
          type="button"
          aria-label={adding ? "Close add a business" : "Add a business"}
          aria-expanded={adding}
          onClick={() => (adding ? closeAdd() : openAdd())}
          className="flex h-12 w-12 items-center justify-center rounded-full border border-rule bg-background/80 text-foreground shadow-lg backdrop-blur-sm transition-colors hover:bg-primary hover:text-primary-foreground"
        >
          <Plus
            className={`h-5 w-5 transition-transform duration-300 ${adding ? "rotate-45" : ""}`}
            aria-hidden="true"
          />
        </button>
      </div>

      {/* Callout box below the globe's mark — "Run a scan" with an expand
          handle top-right; the body is empty for now. Display-only until the
          scan flow lands. */}
      <div
        ref={boxRef}
        aria-hidden="true"
        className="pointer-events-none fixed left-0 top-0 z-40 w-[232px] rounded-md border border-rule bg-background/85 opacity-0 shadow-lift backdrop-blur-sm"
        style={{ left: "-1000px", top: "-1000px", transition: "opacity 0.35s ease" }}
      >
        <div className="flex items-center justify-between border-b border-rule px-3.5 py-2">
          <span className="text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
            Run a scan
          </span>
          <Expand className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
        </div>
        <div className="h-16" />
      </div>

      {/* Add-a-business overlay — rises over the globe like the auth card and
          landing sections, on the same paper-card language. */}
      {adding && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4" data-skip-globe>
          <div
            className="animate-fade absolute inset-0 bg-ink/60 backdrop-blur-[2px]"
            onClick={closeAdd}
            data-skip-globe
          />
          <div
            className="paper-card animate-rise relative w-full max-w-md rounded-md p-7 shadow-lift md:p-8"
            data-skip-globe
          >
            <p className="eyebrow">Getting started</p>
            <h2 className="mt-2 font-serif text-3xl">Add a business</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              Tell us which business to watch — its name, type, and neighbourhood anchor every scan
              and brief.
            </p>
            <form onSubmit={onSubmitAdd} className="mt-6 space-y-3" noValidate>
              <input
                className={inputCls}
                name="businessName"
                required
                minLength={2}
                maxLength={120}
                placeholder="Business name"
                aria-label="Business name"
                value={draft.businessName}
                onChange={(e) => setDraft({ ...draft, businessName: e.target.value })}
              />
              <input
                className={inputCls}
                name="location"
                required
                minLength={2}
                maxLength={160}
                placeholder="Neighbourhood, city (e.g. Shoreditch, London)"
                aria-label="Location"
                value={draft.location}
                onChange={(e) => setDraft({ ...draft, location: e.target.value })}
              />
              <select
                className={inputCls}
                name="businessType"
                aria-label="Business type"
                value={draft.businessType}
                onChange={(e) =>
                  setDraft({ ...draft, businessType: e.target.value as BusinessType })
                }
              >
                {BUSINESS_TYPES.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <button
                type="submit"
                disabled={addState === "saving"}
                className="w-full rounded-sm bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-accent disabled:opacity-60"
              >
                {addState === "saving" ? "Adding…" : "Add business"}
              </button>
              {addState === "error" && addError && (
                <p className="text-sm text-signal-red">{addError}</p>
              )}
              <p className="text-xs leading-relaxed text-muted-foreground">
                The free plan includes one business. Paid plans (coming soon) let you watch more.
              </p>
            </form>
          </div>
        </div>
      )}
    </main>
  );
}

const inputCls =
  "w-full rounded-sm border border-rule/80 bg-card/50 px-3.5 py-3 text-sm text-foreground backdrop-blur-sm transition-colors placeholder:text-muted-foreground/60 focus:border-accent/70 focus:outline-none focus:ring-2 focus:ring-accent/20";