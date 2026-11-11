import Link from "next/link";
import type { ButtonHTMLAttributes, ReactNode } from "react";

export function Wordmark() {
  return (
    <Link href="/" className="inline-flex items-center gap-2 font-display text-xl font-bold text-ink">
      {/* A loop of string, like the one on a hang tag. */}
      <svg width="26" height="26" viewBox="0 0 26 26" aria-hidden="true">
        <circle cx="13" cy="13" r="9" fill="none" stroke="currentColor" strokeWidth="2.5" />
        <circle cx="13" cy="4" r="2.6" fill="var(--color-yellow)" stroke="currentColor" strokeWidth="1.5" />
      </svg>
      LendLoop
    </Link>
  );
}

type Variant = "primary" | "plain" | "danger" | "quiet";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-yellow text-ink hover:bg-yellow-deep shadow-[inset_0_-2px_0_rgba(0,0,0,0.15)]",
  plain: "bg-tag text-ink ring-1 ring-line hover:ring-ink/40",
  danger: "bg-tag text-bad ring-1 ring-bad/30 hover:ring-bad/60",
  quiet: "text-steel underline-offset-4 hover:underline px-1",
};

export function Button({
  variant = "primary",
  className = "",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      {...rest}
      className={`rounded-lg px-4 py-2 text-[0.95rem] font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${VARIANTS[variant]} ${className}`}
    />
  );
}

export function Notice({ tone = "bad", children }: { tone?: "bad" | "ok"; children: ReactNode }) {
  return (
    <p
      role={tone === "bad" ? "alert" : "status"}
      className={`rounded-lg px-3 py-2 text-[0.95rem] ${tone === "bad" ? "bg-bad/10 text-bad" : "bg-ok/10 text-ok"}`}
    >
      {children}
    </p>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-xl border-2 border-dashed border-line bg-tag/60 px-6 py-10 text-center">
      <p className="font-display text-lg font-semibold">{title}</p>
      {children && <div className="mt-1 text-muted">{children}</div>}
    </div>
  );
}

export function Skeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-label="Loading">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="hang-tag h-36 animate-pulse bg-tag/70" />
      ))}
    </div>
  );
}

const STATUS: Record<string, { label: string; className: string }> = {
  pending: { label: "Waiting for owner", className: "bg-yellow/30 text-warn" },
  approved: { label: "On loan", className: "bg-ok/15 text-ok" },
  declined: { label: "Declined", className: "bg-board-deep text-muted" },
  returned: { label: "Returned", className: "bg-steel/12 text-steel" },
  cancelled: { label: "Cancelled", className: "bg-board-deep text-muted" },
};

export function StatusPill({ status, overdue }: { status: string; overdue?: boolean }) {
  if (overdue) {
    return <span className="rounded-full bg-bad/12 px-2.5 py-0.5 text-sm font-bold text-bad">Overdue</span>;
  }
  const s = STATUS[status] ?? { label: status, className: "bg-board-deep text-muted" };
  return <span className={`rounded-full px-2.5 py-0.5 text-sm font-bold ${s.className}`}>{s.label}</span>;
}

export function formatDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

export function timeAgo(ms: number): string {
  const days = Math.floor((Date.now() - ms) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}
