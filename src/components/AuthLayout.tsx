import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { ConstellationGrid } from "@/components/ConstellationGrid";

export function AuthLayout({
  eyebrow,
  title,
  subtitle,
  children,
  footer,
}: {
  eyebrow: string;
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <main className="theme-dark relative flex min-h-screen items-center justify-center bg-background px-4 py-12">
      <ConstellationGrid className="fixed inset-0 h-screen w-full" />
      <div className="relative w-full max-w-md">
        <Link
          to="/"
          className="animate-fade block text-center font-serif text-3xl tracking-tight"
        >
          Localscope<span className="text-accent">.</span>
        </Link>
        <div className="paper-card animate-rise mt-6 rounded-md p-7 shadow-lift [animation-delay:120ms]">
          <p className="eyebrow">{eyebrow}</p>
          <h1 className="mt-2 font-serif text-3xl">{title}</h1>
          {subtitle && <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{subtitle}</p>}
          <div className="mt-6">{children}</div>
        </div>
        {footer && (
          <div className="animate-fade mt-5 text-center text-sm text-muted-foreground [animation-delay:300ms]">
            {footer}
          </div>
        )}
      </div>
    </main>
  );
}

export const authInput =
  "w-full rounded-sm border border-input bg-card px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/70 focus:outline-none focus:ring-2 focus:ring-ring/40 focus:border-ring";

export const authButton =
  "w-full rounded-sm bg-primary px-5 py-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-accent disabled:opacity-60";