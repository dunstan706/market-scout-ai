"use client";

import * as React from "react";
import { motion, useScroll, useMotionValueEvent, type Variants } from "framer-motion";
import { ChevronDown, Menu, Navigation } from "lucide-react";
import { cn } from "@/lib/utils";

export type AnimatedNavItem = {
  name: string;
  href?: string;
  onClick?: () => void;
  danger?: boolean;
  /** Renders the item as a dropdown trigger with a chevron; the children are
   *  listed in a panel that drops below the pill. A child with neither href
   *  nor onClick renders as a muted, non-interactive row. */
  children?: AnimatedNavItem[];
  /** Highlights the row as the current selection (dropdown children). */
  active?: boolean;
};

const defaultItems: AnimatedNavItem[] = [
  { name: "Home", href: "#" },
  { name: "About", href: "#" },
  { name: "Services", href: "#" },
  { name: "Contact", href: "#" },
];

const EXPAND_SCROLL_THRESHOLD = 80;

const containerVariants: Variants = {
  expanded: {
    y: 0,
    opacity: 1,
    width: "auto",
    transition: {
      y: { type: "spring", damping: 18, stiffness: 250 },
      opacity: { duration: 0.3 },
      type: "spring",
      damping: 20,
      stiffness: 300,
      staggerChildren: 0.07,
      delayChildren: 0.2,
    },
  },
  collapsed: {
    y: 0,
    opacity: 1,
    width: "3rem",
    transition: {
      type: "spring",
      damping: 20,
      stiffness: 300,
      when: "afterChildren",
      staggerChildren: 0.05,
      staggerDirection: -1,
    },
  },
};

const logoVariants: Variants = {
  expanded: { opacity: 1, x: 0, rotate: 0, transition: { type: "spring", damping: 15 } },
  collapsed: { opacity: 0, x: -25, rotate: -180, transition: { duration: 0.3 } },
};

const itemVariants: Variants = {
  expanded: { opacity: 1, x: 0, scale: 1, transition: { type: "spring", damping: 15 } },
  collapsed: { opacity: 0, x: -20, scale: 0.95, transition: { duration: 0.2 } },
};

const collapsedIconVariants: Variants = {
  expanded: { opacity: 0, scale: 0.8, transition: { duration: 0.2 } },
  collapsed: {
    opacity: 1,
    scale: 1,
    transition: {
      type: "spring",
      damping: 15,
      stiffness: 300,
      delay: 0.15,
    },
  },
};

/**
 * Scroll-collapsing floating pill navigation.
 *
 * The pill stays expanded until the page is scrolled down (past 150px), then
 * springs into a small circle showing only a menu glyph. Clicking the circle
 * expands it again; scrolling back up past the collapse point re-expands it.
 *
 * Defaults reproduce the original demo exactly (generic items, navigation
 * icon). The landing page passes its own brand mark, section anchors, the
 * auth link and a call-to-action.
 */
export function AnimatedNavFramer({
  items = defaultItems,
  logo = <Navigation className="h-6 w-6" />,
  cta,
  auth,
  collapsible = true,
}: {
  items?: AnimatedNavItem[];
  logo?: React.ReactNode;
  cta?: { href: string; label: string; shortLabel?: string };
  auth?: React.ReactNode;
  /** False pins the pill permanently expanded (and keeps items visible at all
   *  widths) — for chrome that must not shrink away, e.g. over a canvas. */
  collapsible?: boolean;
}) {
  const [isExpanded, setExpanded] = React.useState(true);
  const [openDropdown, setOpenDropdown] = React.useState<string | null>(null);
  const wrapRef = React.useRef<HTMLDivElement | null>(null);

  // Close any open dropdown when the pointer lands outside the pill + panel.
  React.useEffect(() => {
    if (!openDropdown) return;
    const onPointerDown = (e: PointerEvent) => {
      const t = e.target;
      if (t instanceof Node && wrapRef.current?.contains(t)) return;
      setOpenDropdown(null);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [openDropdown]);

  const { scrollY } = useScroll();
  const lastScrollY = React.useRef(0);
  const scrollPositionOnCollapse = React.useRef(0);

  useMotionValueEvent(scrollY, "change", (latest) => {
    if (!collapsible) return;
    const previous = lastScrollY.current;

    if (isExpanded && latest > previous && latest > 150) {
      setExpanded(false);
      scrollPositionOnCollapse.current = latest;
    } else if (
      !isExpanded &&
      latest < previous &&
      scrollPositionOnCollapse.current - latest > EXPAND_SCROLL_THRESHOLD
    ) {
      setExpanded(true);
    }

    lastScrollY.current = latest;
  });

  const handleNavClick = (e: React.MouseEvent) => {
    if (collapsible && !isExpanded) {
      e.preventDefault();
      setExpanded(true);
    }
  };

  return (
    <div ref={wrapRef} className="fixed top-6 left-1/2 -translate-x-1/2 z-50">
      <motion.nav
        initial={{ y: -80, opacity: 0 }}
        animate={isExpanded ? "expanded" : "collapsed"}
        variants={containerVariants}
        whileHover={!isExpanded ? { scale: 1.1 } : {}}
        whileTap={!isExpanded ? { scale: 0.95 } : {}}
        onClick={handleNavClick}
        className={cn(
          "flex items-center overflow-hidden rounded-full border bg-background/80 shadow-lg backdrop-blur-sm h-12",
          !isExpanded && "cursor-pointer justify-center"
        )}
      >
        <motion.div
          variants={logoVariants}
          className="flex-shrink-0 flex items-center font-semibold pl-5 pr-2"
        >
          {logo}
        </motion.div>

        {/* Section links — hidden on small screens so the pill stays compact
            (kept visible at every width when collapsible is false). */}
        <motion.div
          className={cn(
            collapsible ? "hidden md:flex" : "flex",
            "items-center gap-1 sm:gap-4",
            !isExpanded && "pointer-events-none"
          )}
        >
          {items.map((item) => {
            const itemClass =
              "text-sm font-medium transition-colors px-2 py-1 " +
              (item.danger
                ? "text-signal-red hover:text-signal-red/70"
                : "text-muted-foreground hover:text-foreground");
            if (item.children) {
              const open = openDropdown === item.name;
              return (
                <motion.button
                  key={item.name}
                  type="button"
                  variants={itemVariants}
                  aria-expanded={open}
                  aria-haspopup="menu"
                  onClick={(e) => {
                    e.stopPropagation();
                    setOpenDropdown(open ? null : item.name);
                  }}
                  className={cn(itemClass, "inline-flex items-center gap-1")}
                >
                  {item.name}
                  <ChevronDown
                    className={cn(
                      "h-3.5 w-3.5 transition-transform duration-200",
                      open && "rotate-180"
                    )}
                    aria-hidden="true"
                  />
                </motion.button>
              );
            }
            if (item.href) {
              return (
                <motion.a
                  key={item.name}
                  href={item.href}
                  variants={itemVariants}
                  onClick={(e) => e.stopPropagation()}
                  className={itemClass}
                >
                  {item.name}
                </motion.a>
              );
            }
            return (
              <motion.button
                key={item.name}
                type="button"
                variants={itemVariants}
                onClick={(e) => {
                  e.stopPropagation();
                  item.onClick?.();
                }}
                className={itemClass}
              >
                {item.name}
              </motion.button>
            );
          })}
        </motion.div>

        {auth && (
          <motion.div variants={itemVariants} className="flex-shrink-0 md:border-l md:border-rule md:ml-1 md:pl-3">
            {auth}
          </motion.div>
        )}

        {cta && (
          <motion.a
            href={cta.href}
            variants={itemVariants}
            onClick={(e) => e.stopPropagation()}
            className={cn(
              "flex-shrink-0 rounded-full bg-primary px-3.5 py-1.5 ml-2 mr-4 md:mr-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-accent",
              !isExpanded && "pointer-events-none"
            )}
          >
            <span className="md:hidden">{cta.shortLabel ?? cta.label}</span>
            <span className="hidden md:inline">{cta.label}</span>
          </motion.a>
        )}

        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <motion.div variants={collapsedIconVariants} animate={isExpanded ? "expanded" : "collapsed"}>
            <Menu className="h-6 w-6" />
          </motion.div>
        </div>
      </motion.nav>

      {/* Dropdown panels — siblings of the pill so the pill's rounded
          overflow-hidden never clips them. Centered under the pill. */}
      {items.map((item) =>
        item.children && openDropdown === item.name ? (
          <motion.div
            key={`${item.name}-menu`}
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            role="menu"
            className="absolute left-1/2 top-full mt-2 w-56 -translate-x-1/2 rounded-md border border-rule bg-background/90 p-1 shadow-lift backdrop-blur-sm"
          >
            {item.children.map((child) => {
              const childClass =
                "flex w-full items-center gap-2 whitespace-nowrap rounded-sm px-3 py-2 text-left text-sm transition-colors " +
                (child.danger
                  ? "text-signal-red hover:bg-rule/60 hover:text-signal-red/80"
                  : child.active
                    ? "text-foreground hover:bg-rule/60"
                    : "text-muted-foreground hover:bg-rule/60 hover:text-foreground");
              if (child.href) {
                return (
                  <a
                    key={child.name}
                    href={child.href}
                    role="menuitem"
                    onClick={() => setOpenDropdown(null)}
                    className={childClass}
                  >
                    {child.name}
                  </a>
                );
              }
              if (child.onClick) {
                return (
                  <button
                    key={child.name}
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setOpenDropdown(null);
                      child.onClick?.();
                    }}
                    className={childClass}
                  >
                    {child.name}
                  </button>
                );
              }
              return (
                <span
                  key={child.name}
                  className="block w-full cursor-default whitespace-nowrap rounded-sm px-3 py-2 text-left text-sm text-muted-foreground/70"
                >
                  {child.name}
                </span>
              );
            })}
          </motion.div>
        ) : null
      )}
    </div>
  );
}
