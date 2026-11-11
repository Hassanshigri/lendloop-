"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { UserButton } from "@clerk/nextjs";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { CATEGORIES, type Category } from "@/convex/lib/constants";

type Condition = "new" | "good" | "fair" | "worn";
type Tab = "browse" | "listings" | "incoming" | "requests" | "admin";

function errorMessage(err: unknown): string {
  if (err instanceof ConvexError) return String(err.data);
  return "Something went wrong. Please try again.";
}

function timeAgo(ms: number): string {
  const days = Math.floor((Date.now() - ms) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "1 day ago";
  return `${days} days ago`;
}

const STATUS_STYLE: Record<string, string> = {
  pending: "bg-amber-100 text-amber-800",
  approved: "bg-emerald-100 text-emerald-800",
  declined: "bg-stone-200 text-stone-700",
  returned: "bg-sky-100 text-sky-800",
  cancelled: "bg-stone-200 text-stone-700",
};

function Badge({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${className}`}>{children}</span>;
}

function Button(props: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" | "danger" }) {
  const { variant = "primary", className = "", ...rest } = props;
  const styles = {
    primary: "bg-brand text-white hover:bg-brand-dark",
    ghost: "border border-stone-300 bg-white hover:bg-stone-50",
    danger: "border border-red-300 bg-white text-red-700 hover:bg-red-50",
  }[variant];
  return (
    <button
      {...rest}
      className={`rounded-md px-3 py-1.5 text-sm font-medium disabled:opacity-50 ${styles} ${className}`}
    />
  );
}

/** Runs a mutation and shows its error inline instead of throwing. */
function useAction<A>(fn: (args: A) => Promise<unknown>) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (args: A) => {
    setBusy(true);
    setError(null);
    try {
      await fn(args);
      return true;
    } catch (err) {
      setError(errorMessage(err));
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { run, error, busy };
}

export default function Dashboard() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const storeUser = useMutation(api.users.store);
  const [stored, setStored] = useState(false);
  const me = useQuery(api.users.me, stored ? {} : "skip");
  const [tab, setTab] = useState<Tab>("browse");

  useEffect(() => {
    if (isAuthenticated && !stored) {
      storeUser().then(() => setStored(true));
    }
  }, [isAuthenticated, stored, storeUser]);

  if (isLoading || (isAuthenticated && !me)) {
    return <p className="p-8 text-stone-500">Loading…</p>;
  }
  if (!isAuthenticated) {
    return (
      <p className="p-8">
        Your session could not be verified. <Link href="/" className="underline">Go back</Link>.
      </p>
    );
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: "browse", label: "All tools" },
    { id: "listings", label: "My listings" },
    { id: "incoming", label: "Incoming requests" },
    { id: "requests", label: "My requests" },
    ...(me?.role === "admin" ? [{ id: "admin" as Tab, label: "Admin" }] : []),
  ];

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8">
      <header className="mb-6 flex items-center justify-between">
        <Link href="/" className="text-xl font-bold text-brand">LendLoop</Link>
        <div className="flex items-center gap-3">
          <span className="text-sm text-stone-600">
            {me?.name}
            {me?.role === "admin" && <Badge className="ml-2 bg-stone-800 text-white">admin</Badge>}
          </span>
          <UserButton />
        </div>
      </header>

      <nav className="mb-6 flex flex-wrap gap-2" aria-label="Sections">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            aria-current={tab === t.id ? "page" : undefined}
            className={`rounded-full px-3 py-1.5 text-sm font-medium ${
              tab === t.id ? "bg-brand text-white" : "bg-white text-stone-700 hover:bg-stone-100"
            }`}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {tab === "browse" && <Browse />}
      {tab === "listings" && <MyListings />}
      {tab === "incoming" && <LoanList kind="incoming" />}
      {tab === "requests" && <LoanList kind="requests" />}
      {tab === "admin" && me?.role === "admin" && <Admin />}
    </div>
  );
}

function Browse() {
  const [category, setCategory] = useState<Category | "">("");
  const tools = useQuery(api.tools.listForMembers, category ? { category } : {});
  return (
    <section>
      <label className="mb-4 flex items-center gap-2 text-sm">
        Category
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value as Category | "")}
          className="rounded-md border border-stone-300 bg-white px-2 py-1 capitalize"
        >
          <option value="">All</option>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      </label>
      {tools === undefined ? (
        <p className="text-stone-500">Loading…</p>
      ) : tools.length === 0 ? (
        <p className="text-stone-500">No tools in this category yet.</p>
      ) : (
        <ul className="space-y-3">
          {tools.map((t) => (
            <li key={t._id} className="rounded-lg border border-stone-200 bg-white p-4">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="font-semibold">{t.name}</h3>
                <Badge className="bg-stone-100 text-stone-600">{t.category}</Badge>
                <Badge className={t.available ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}>
                  {t.available ? "available" : "on loan"}
                </Badge>
              </div>
              <p className="mt-1 text-sm text-stone-600">{t.description}</p>
              <p className="mt-1 text-xs text-stone-500">
                Condition: {t.condition} · Lent by {t.isMine ? "you" : t.ownerFirstName}
                {t.ownerTrusted && <Badge className="ml-2 bg-sky-100 text-sky-800">trusted lender</Badge>}
              </p>
              {!t.isMine && <RequestForm toolId={t._id} />}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function RequestForm({ toolId }: { toolId: Id<"tools"> }) {
  const request = useMutation(api.loans.request);
  const { run, error, busy } = useAction(request);
  const [open, setOpen] = useState(false);
  const [startDate, setStart] = useState("");
  const [endDate, setEnd] = useState("");
  const [sent, setSent] = useState(false);
  const today = new Date().toISOString().slice(0, 10);

  if (sent) return <p className="mt-3 text-sm text-emerald-700">Request sent. Track it under My requests.</p>;
  if (!open) {
    return (
      <Button variant="ghost" className="mt-3" onClick={() => setOpen(true)}>
        Request to borrow
      </Button>
    );
  }
  return (
    <form
      className="mt-3 flex flex-wrap items-end gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        if (await run({ toolId, startDate, endDate })) setSent(true);
      }}
    >
      <label className="text-sm">
        From
        <input type="date" required min={today} value={startDate} onChange={(e) => setStart(e.target.value)}
          className="ml-1 rounded-md border border-stone-300 px-2 py-1" />
      </label>
      <label className="text-sm">
        To
        <input type="date" required min={startDate || today} value={endDate} onChange={(e) => setEnd(e.target.value)}
          className="ml-1 rounded-md border border-stone-300 px-2 py-1" />
      </label>
      <Button type="submit" disabled={busy}>Send request</Button>
      <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
      {error && <p className="w-full text-sm text-red-700">{error}</p>}
    </form>
  );
}

type ToolForm = { name: string; category: Category; condition: Condition; description: string };
const EMPTY: ToolForm = { name: "", category: "power tools", condition: "good", description: "" };

function ToolEditor({
  initial,
  onSubmit,
  onCancel,
  submitLabel,
}: {
  initial: ToolForm;
  onSubmit: (f: ToolForm) => Promise<boolean>;
  onCancel?: () => void;
  submitLabel: string;
}) {
  const [form, setForm] = useState(initial);
  const field = "rounded-md border border-stone-300 px-2 py-1 w-full";
  return (
    <form
      className="grid gap-3 rounded-lg border border-stone-200 bg-white p-4 sm:grid-cols-2"
      onSubmit={async (e) => {
        e.preventDefault();
        if ((await onSubmit(form)) && !onCancel) setForm(EMPTY);
      }}
    >
      <label className="text-sm">Name
        <input required maxLength={80} className={field} value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })} />
      </label>
      <label className="text-sm">Category
        <select className={`${field} capitalize`} value={form.category}
          onChange={(e) => setForm({ ...form, category: e.target.value as Category })}>
          {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </label>
      <label className="text-sm">Condition
        <select className={`${field} capitalize`} value={form.condition}
          onChange={(e) => setForm({ ...form, condition: e.target.value as Condition })}>
          {(["new", "good", "fair", "worn"] as const).map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </label>
      <label className="text-sm sm:col-span-2">Short description
        <textarea required maxLength={500} rows={2} className={field} value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })} />
      </label>
      <div className="flex gap-2 sm:col-span-2">
        <Button type="submit">{submitLabel}</Button>
        {onCancel && <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>}
      </div>
    </form>
  );
}

function MyListings() {
  const tools = useQuery(api.tools.myListings);
  const create = useAction(useMutation(api.tools.create));
  const update = useAction(useMutation(api.tools.update));
  const remove = useAction(useMutation(api.tools.remove));
  const [editing, setEditing] = useState<Id<"tools"> | null>(null);

  return (
    <section className="space-y-6">
      <div>
        <h2 className="mb-2 font-semibold">List a tool</h2>
        <ToolEditor initial={EMPTY} submitLabel="Add listing" onSubmit={(f) => create.run(f)} />
        {create.error && <p className="mt-2 text-sm text-red-700">{create.error}</p>}
      </div>
      <div>
        <h2 className="mb-2 font-semibold">Your listings</h2>
        {(update.error || remove.error) && <p className="mb-2 text-sm text-red-700">{update.error ?? remove.error}</p>}
        {tools === undefined ? (
          <p className="text-stone-500">Loading…</p>
        ) : tools.length === 0 ? (
          <p className="text-stone-500">You have not listed anything yet.</p>
        ) : (
          <ul className="space-y-3">
            {tools.map((t) =>
              editing === t._id ? (
                <li key={t._id}>
                  <ToolEditor
                    initial={{ name: t.name, category: t.category, condition: t.condition, description: t.description }}
                    submitLabel="Save"
                    onCancel={() => setEditing(null)}
                    onSubmit={async (f) => {
                      const ok = await update.run({ toolId: t._id, ...f });
                      if (ok) setEditing(null);
                      return ok;
                    }}
                  />
                </li>
              ) : (
                <li key={t._id} className="flex items-center justify-between rounded-lg border border-stone-200 bg-white p-4">
                  <div>
                    <span className="font-semibold">{t.name}</span>{" "}
                    <Badge className="bg-stone-100 text-stone-600">{t.category}</Badge>{" "}
                    <Badge className={t.available ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}>
                      {t.available ? "available" : "on loan"}
                    </Badge>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="ghost" onClick={() => setEditing(t._id)}>Edit</Button>
                    <Button
                      variant="danger"
                      disabled={remove.busy}
                      onClick={() => {
                        if (window.confirm(`Delete "${t.name}"?`)) remove.run({ toolId: t._id });
                      }}
                    >
                      Delete
                    </Button>
                  </div>
                </li>
              ),
            )}
          </ul>
        )}
      </div>
    </section>
  );
}

type LoanView = {
  _id: Id<"loans">;
  toolName: string;
  lenderFirstName: string;
  borrowerFirstName: string;
  startDate: string;
  endDate: string;
  status: string;
  overdue: boolean;
  activity: { kind: string; status: string; at: number }[];
};

function Activity({ items }: { items: LoanView["activity"] }) {
  if (items.length === 0) return null;
  const e = items[0];
  const label = e.kind === "overdue_reminder" ? "Reminder" : "Notification";
  return (
    <p className="mt-1 text-xs text-stone-500">
      {label} {e.status === "sent" ? "sent" : "failed"} {timeAgo(e.at)}
    </p>
  );
}

function LoanList({ kind }: { kind: "incoming" | "requests" }) {
  const loans = useQuery(kind === "incoming" ? api.loans.incoming : api.loans.myRequests);
  const approve = useAction(useMutation(api.loans.approve));
  const decline = useAction(useMutation(api.loans.decline));
  const returned = useAction(useMutation(api.loans.markReturned));
  const cancel = useAction(useMutation(api.loans.cancel));
  const error = approve.error ?? decline.error ?? returned.error ?? cancel.error;

  if (loans === undefined) return <p className="text-stone-500">Loading…</p>;
  if (loans.length === 0) {
    return (
      <p className="text-stone-500">
        {kind === "incoming" ? "No one has asked to borrow your tools yet." : "You have not requested anything yet."}
      </p>
    );
  }
  return (
    <section>
      {error && <p className="mb-2 text-sm text-red-700">{error}</p>}
      <ul className="space-y-3">
        {loans.map((l: LoanView) => (
          <li key={l._id} className="rounded-lg border border-stone-200 bg-white p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold">{l.toolName}</span>
              <Badge className={STATUS_STYLE[l.status]}>{l.status}</Badge>
              {l.overdue && <Badge className="bg-red-100 text-red-800">overdue</Badge>}
            </div>
            <p className="mt-1 text-sm text-stone-600">
              {kind === "incoming" ? `${l.borrowerFirstName} wants it` : `From ${l.lenderFirstName}`} ·{" "}
              {l.startDate} to {l.endDate}
            </p>
            <Activity items={l.activity} />
            <div className="mt-3 flex gap-2">
              {kind === "incoming" && l.status === "pending" && (
                <>
                  <Button onClick={() => approve.run({ loanId: l._id })}>Approve</Button>
                  <Button variant="ghost" onClick={() => decline.run({ loanId: l._id })}>Decline</Button>
                </>
              )}
              {kind === "incoming" && l.status === "approved" && (
                <Button variant="ghost" onClick={() => returned.run({ loanId: l._id })}>Mark returned</Button>
              )}
              {kind === "requests" && l.status === "pending" && (
                <Button variant="ghost" onClick={() => cancel.run({ loanId: l._id })}>Cancel request</Button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Admin() {
  const loans = useQuery(api.loans.allForAdmin);
  const users = useQuery(api.users.listForAdmin);
  const tools = useQuery(api.tools.listForMembers, {});
  const setTrusted = useAction(useMutation(api.users.setTrustedLender));
  const remove = useAction(useMutation(api.tools.remove));

  return (
    <section className="space-y-8">
      <div>
        <h2 className="mb-2 font-semibold">All loans</h2>
        {loans === undefined ? <p className="text-stone-500">Loading…</p> : loans.length === 0 ? (
          <p className="text-stone-500">No loans yet.</p>
        ) : (
          <table className="w-full overflow-hidden rounded-lg border border-stone-200 bg-white text-sm">
            <thead className="bg-stone-100 text-left">
              <tr><th className="p-2">Tool</th><th className="p-2">Lender</th><th className="p-2">Borrower</th><th className="p-2">Dates</th><th className="p-2">Status</th></tr>
            </thead>
            <tbody>
              {loans.map((l) => (
                <tr key={l._id} className="border-t border-stone-200">
                  <td className="p-2">{l.toolName}</td>
                  <td className="p-2">{l.lenderFirstName}</td>
                  <td className="p-2">{l.borrowerFirstName}</td>
                  <td className="p-2">{l.startDate} to {l.endDate}</td>
                  <td className="p-2"><Badge className={STATUS_STYLE[l.status]}>{l.status}</Badge>{l.overdue && " overdue"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div>
        <h2 className="mb-2 font-semibold">Members</h2>
        {setTrusted.error && <p className="mb-2 text-sm text-red-700">{setTrusted.error}</p>}
        <ul className="space-y-2">
          {users?.map((u) => (
            <li key={u._id} className="flex items-center justify-between rounded-lg border border-stone-200 bg-white px-4 py-2">
              <span>{u.name} {u.role === "admin" && <Badge className="bg-stone-800 text-white">admin</Badge>}</span>
              <Button variant="ghost" onClick={() => setTrusted.run({ userId: u._id, trusted: !u.trustedLender })}>
                {u.trustedLender ? "Remove Trusted Lender" : "Mark Trusted Lender"}
              </Button>
            </li>
          ))}
        </ul>
      </div>

      <div>
        <h2 className="mb-2 font-semibold">Moderate listings</h2>
        {remove.error && <p className="mb-2 text-sm text-red-700">{remove.error}</p>}
        <ul className="space-y-2">
          {tools?.map((t) => (
            <li key={t._id} className="flex items-center justify-between rounded-lg border border-stone-200 bg-white px-4 py-2">
              <span>{t.name} <span className="text-xs text-stone-500">by {t.isMine ? "you" : t.ownerFirstName}</span></span>
              <Button
                variant="danger"
                onClick={() => {
                  if (window.confirm(`Remove "${t.name}" for all users?`)) remove.run({ toolId: t._id });
                }}
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
