"use client";

import { useEffect, useState } from "react";
import { useAuth, useClerk, useUser, UserButton } from "@clerk/nextjs";
import { useConvexAuth, useConvexConnectionState, useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { CATEGORIES, type Category } from "@/convex/lib/constants";
import { Button, Empty, Notice, Skeleton, StatusPill, Wordmark, formatDate, timeAgo } from "../ui";

type Condition = "new" | "good" | "fair" | "worn";
type Tab = "browse" | "listings" | "incoming" | "requests" | "admin";

function errorMessage(err: unknown): string {
  if (err instanceof ConvexError) return String(err.data);
  return "That didn't go through. Check your connection and try again.";
}

/** Runs a mutation and keeps its error next to the control that triggered it. */
function useRun<A>(fn: (args: A) => Promise<unknown>) {
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

const field =
  "mt-1 w-full rounded-lg border border-line bg-tag px-3 py-2 text-ink placeholder:text-muted/70 focus:border-steel focus:outline-none";

export default function Dashboard() {
  const clerk = useAuth();
  const { user } = useUser();
  const { signOut } = useClerk();
  const convexAuth = useConvexAuth();
  const storeUser = useMutation(api.users.store);
  const [stored, setStored] = useState(false);
  const [storeError, setStoreError] = useState<string | null>(null);
  const me = useQuery(api.users.me, stored ? {} : "skip");
  const incoming = useQuery(api.loans.incoming, stored ? {} : "skip");
  const [tab, setTab] = useState<Tab>("browse");
  const connection = useConvexConnectionState();
  const [graceOver, setGraceOver] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setGraceOver(true), 7000);
    return () => clearTimeout(timer);
  }, []);
  const unreachable = graceOver && !connection.hasEverConnected && !connection.isWebSocketConnected;

  const displayName =
    user?.fullName || user?.firstName || user?.username || user?.primaryEmailAddress?.emailAddress?.split("@")[0];

  useEffect(() => {
    if (convexAuth.isAuthenticated && !stored && user !== undefined) {
      storeUser({ displayName: displayName ?? undefined })
        .then(() => setStored(true))
        .catch((err) => setStoreError(errorMessage(err)));
    }
  }, [convexAuth.isAuthenticated, stored, storeUser, displayName, user]);

  // The browser can't open a connection to Convex at all (firewall, antivirus,
  // VPN, extension or ISP). Say so plainly instead of blaming the sign-in.
  if (unreachable) {
    return (
      <Shell>
        <div className="mx-auto mt-10 max-w-lg rounded-xl bg-tag p-8 ring-1 ring-line">
          <h1 className="text-2xl font-bold">Can&apos;t reach the LendLoop server</h1>
          <p className="mt-3 text-muted">
            Your browser couldn&apos;t open a connection to the app&apos;s database. Something on this network or
            device is blocking it, often a VPN, an antivirus web shield, or a browser extension.
          </p>
          <ul className="mt-3 list-disc space-y-1 pl-5 text-muted">
            <li>Try a private window, which turns most extensions off.</li>
            <li>Turn a VPN or antivirus web protection off for a minute.</li>
            <li>Try another network, such as mobile data.</li>
          </ul>
          <div className="mt-6">
            <Button onClick={() => window.location.reload()}>Try again</Button>
          </div>
        </div>
      </Shell>
    );
  }

  // Signed in with Clerk, but Convex never accepted the session token.
  if (clerk.isLoaded && clerk.isSignedIn && !convexAuth.isLoading && !convexAuth.isAuthenticated) {
    return (
      <Shell>
        <div className="mx-auto mt-10 max-w-lg rounded-xl bg-tag p-8 ring-1 ring-line">
          <h1 className="text-2xl font-bold">Your sign-in didn&apos;t reach the board</h1>
          <p className="mt-3 text-muted">
            You&apos;re signed in, but the app couldn&apos;t confirm your session with its database. This usually
            clears up after signing in again.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Button onClick={() => signOut({ redirectUrl: "/" })}>Sign out and start again</Button>
            <Button variant="plain" onClick={() => window.location.reload()}>
              Try again
            </Button>
          </div>
        </div>
      </Shell>
    );
  }

  if (storeError) {
    return (
      <Shell>
        <div className="mx-auto mt-10 max-w-lg">
          <Notice>Your profile couldn&apos;t be saved: {storeError}</Notice>
        </div>
      </Shell>
    );
  }

  if (!clerk.isLoaded || convexAuth.isLoading || !me) {
    return (
      <Shell>
        <div className="mt-8">
          <Skeleton rows={3} />
        </div>
      </Shell>
    );
  }

  const waiting = incoming?.filter((l) => l.status === "pending").length ?? 0;
  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: "browse", label: "Borrow" },
    { id: "listings", label: "My tools" },
    { id: "incoming", label: "Requests for my tools", count: waiting },
    { id: "requests", label: "Things I asked for" },
    ...(me.role === "admin" ? [{ id: "admin" as Tab, label: "Admin" }] : []),
  ];

  return (
    <Shell
      who={
        <span className="hidden text-muted sm:inline">
          {me.name}
          {me.role === "admin" && <span className="ml-2 rounded bg-ink px-1.5 py-0.5 text-xs text-tag">admin</span>}
        </span>
      }
    >
      <nav aria-label="Sections" className="mt-2 flex gap-1 overflow-x-auto border-b-2 border-ink">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            aria-current={tab === t.id ? "page" : undefined}
            className={`-mb-0.5 shrink-0 rounded-t-lg px-4 py-2.5 font-bold ${
              tab === t.id ? "bg-ink text-tag" : "text-muted hover:text-ink"
            }`}
          >
            {t.label}
            {t.count ? (
              <span className="ml-2 rounded-full bg-yellow px-2 text-sm text-ink">{t.count}</span>
            ) : null}
          </button>
        ))}
      </nav>

      <div className="mt-8">
        {tab === "browse" && <Browse />}
        {tab === "listings" && <MyTools />}
        {tab === "incoming" && <Loans kind="incoming" />}
        {tab === "requests" && <Loans kind="requests" />}
        {tab === "admin" && me.role === "admin" && <Admin />}
      </div>
    </Shell>
  );
}

function Shell({ children, who }: { children: React.ReactNode; who?: React.ReactNode }) {
  const connection = useConvexConnectionState();
  const reconnecting = connection.hasEverConnected && !connection.isWebSocketConnected;
  return (
    <div className="mx-auto w-full max-w-5xl px-5 pb-20">
      {reconnecting && (
        <p role="status" className="mt-3 rounded-lg bg-yellow/30 px-3 py-2 text-center text-[0.95rem] text-warn">
          Connection lost. Reconnecting, and your changes will sync when it&apos;s back.
        </p>
      )}
      <header className="flex items-center justify-between py-6">
        <Wordmark />
        <div className="flex items-center gap-3">
          {who}
          <UserButton />
        </div>
      </header>
      {children}
    </div>
  );
}

function Browse() {
  const [category, setCategory] = useState<Category | "">("");
  const tools = useQuery(api.tools.listForMembers, category ? { category } : {});
  return (
    <section>
      <div className="mb-6 flex flex-wrap items-center gap-2" role="group" aria-label="Filter by category">
        {(["", ...CATEGORIES] as const).map((c) => (
          <button
            key={c || "all"}
            onClick={() => setCategory(c)}
            aria-pressed={category === c}
            className={`rounded-full px-3.5 py-1.5 text-[0.95rem] capitalize ${
              category === c ? "bg-ink font-bold text-tag" : "bg-tag text-ink ring-1 ring-line hover:ring-ink/40"
            }`}
          >
            {c || "Everything"}
          </button>
        ))}
      </div>
      {tools === undefined ? (
        <Skeleton />
      ) : tools.length === 0 ? (
        <Empty title={category ? `No ${category} on the board` : "The board is empty"}>
          {category ? "Try another category." : "List something you own under My tools."}
        </Empty>
      ) : (
        <ul className="grid gap-x-4 gap-y-5 sm:grid-cols-2 lg:grid-cols-3">
          {tools.map((t) => (
            <li key={t._id} className="hang-tag flex flex-col">
              <div className="flex items-start justify-between gap-2">
                <h3 className="text-xl font-bold">{t.name}</h3>
                {!t.available && <StatusPill status="approved" />}
              </div>
              <p className="mt-0.5 text-sm capitalize text-muted">
                {t.category}, {t.condition} condition
              </p>
              <p className="mt-3 flex-1 text-[0.95rem]">{t.description}</p>
              <p className="mt-3 text-sm text-muted">
                {t.isMine ? "Yours" : `Lent by ${t.ownerFirstName}`}
                {t.ownerTrusted && <span className="ml-2 font-bold text-steel">Trusted lender</span>}
              </p>
              {!t.isMine && <RequestForm toolId={t._id} toolName={t.name} />}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function RequestForm({ toolId, toolName }: { toolId: Id<"tools">; toolName: string }) {
  const { run, error, busy } = useRun(useMutation(api.loans.request));
  const [open, setOpen] = useState(false);
  const [startDate, setStart] = useState("");
  const [endDate, setEnd] = useState("");
  const [sent, setSent] = useState(false);
  const today = new Date().toISOString().slice(0, 10);

  if (sent) {
    return (
      <div className="mt-3">
        <Notice tone="ok">Request sent. You&apos;ll see the answer under Things I asked for.</Notice>
      </div>
    );
  }
  if (!open) {
    return (
      <Button className="mt-4 w-full" onClick={() => setOpen(true)}>
        Ask to borrow
      </Button>
    );
  }
  return (
    <form
      className="mt-4 space-y-3 border-t border-line pt-3"
      onSubmit={async (e) => {
        e.preventDefault();
        if (await run({ toolId, startDate, endDate })) setSent(true);
      }}
    >
      <div className="grid grid-cols-2 gap-2">
        <label className="text-sm font-bold">
          Pick up
          <input type="date" required min={today} value={startDate} onChange={(e) => setStart(e.target.value)} className={field} />
        </label>
        <label className="text-sm font-bold">
          Return by
          <input type="date" required min={startDate || today} value={endDate} onChange={(e) => setEnd(e.target.value)} className={field} />
        </label>
      </div>
      {error && <Notice>{error}</Notice>}
      <div className="flex gap-2">
        <Button type="submit" disabled={busy} className="flex-1">
          {busy ? "Sending…" : `Request ${toolName}`}
        </Button>
        <Button type="button" variant="plain" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

type ToolForm = { name: string; category: Category; condition: Condition; description: string };
const EMPTY_TOOL: ToolForm = { name: "", category: "power tools", condition: "good", description: "" };

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
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        const ok = await onSubmit(form);
        setBusy(false);
        if (ok && !onCancel) setForm(EMPTY_TOOL);
      }}
    >
      <label className="block text-sm font-bold">
        What is it?
        <input required maxLength={80} placeholder="Cordless drill" className={field} value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })} />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="block text-sm font-bold">
          Category
          <select className={`${field} capitalize`} value={form.category}
            onChange={(e) => setForm({ ...form, category: e.target.value as Category })}>
            {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <label className="block text-sm font-bold">
          Condition
          <select className={`${field} capitalize`} value={form.condition}
            onChange={(e) => setForm({ ...form, condition: e.target.value as Condition })}>
            {(["new", "good", "fair", "worn"] as const).map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
      </div>
      <label className="block text-sm font-bold">
        Anything a borrower should know?
        <textarea required maxLength={500} rows={3} placeholder="Comes with two batteries and a charger."
          className={field} value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })} />
      </label>
      <div className="flex gap-2">
        <Button type="submit" disabled={busy}>{busy ? "Saving…" : submitLabel}</Button>
        {onCancel && <Button type="button" variant="plain" onClick={onCancel}>Cancel</Button>}
      </div>
    </form>
  );
}

function MyTools() {
  const tools = useQuery(api.tools.myListings);
  const create = useRun(useMutation(api.tools.create));
  const update = useRun(useMutation(api.tools.update));
  const remove = useRun(useMutation(api.tools.remove));
  const [editing, setEditing] = useState<Id<"tools"> | null>(null);
  const [added, setAdded] = useState(false);

  return (
    <section className="grid gap-8 lg:grid-cols-[22rem_1fr]">
      <div className="h-fit rounded-xl bg-tag p-5 ring-1 ring-line lg:sticky lg:top-6">
        <h2 className="mb-4 text-xl font-bold">Lend something</h2>
        <ToolEditor
          initial={EMPTY_TOOL}
          submitLabel="Put it on the board"
          onSubmit={async (f) => {
            const ok = await create.run(f);
            setAdded(ok);
            return ok;
          }}
        />
        <div className="mt-3">
          {create.error && <Notice>{create.error}</Notice>}
          {added && !create.error && <Notice tone="ok">It&apos;s on the board.</Notice>}
        </div>
      </div>

      <div>
        <h2 className="mb-4 text-xl font-bold">Your tools</h2>
        {(update.error || remove.error) && (
          <div className="mb-3"><Notice>{update.error ?? remove.error}</Notice></div>
        )}
        {tools === undefined ? (
          <Skeleton rows={2} />
        ) : tools.length === 0 ? (
          <Empty title="You haven't lent anything yet">Add your first tool with the form.</Empty>
        ) : (
          <ul className="grid gap-x-4 gap-y-5 sm:grid-cols-2">
            {tools.map((t) => (
              <li key={t._id} className="hang-tag">
                {editing === t._id ? (
                  <ToolEditor
                    initial={{ name: t.name, category: t.category, condition: t.condition, description: t.description }}
                    submitLabel="Save changes"
                    onCancel={() => setEditing(null)}
                    onSubmit={async (f) => {
                      const ok = await update.run({ toolId: t._id, ...f });
                      if (ok) setEditing(null);
                      return ok;
                    }}
                  />
                ) : (
                  <>
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="text-xl font-bold">{t.name}</h3>
                      {!t.available && <StatusPill status="approved" />}
                    </div>
                    <p className="mt-0.5 text-sm capitalize text-muted">{t.category}, {t.condition} condition</p>
                    <p className="mt-3 text-[0.95rem]">{t.description}</p>
                    <div className="mt-4 flex gap-2">
                      <Button variant="plain" onClick={() => setEditing(t._id)}>Edit</Button>
                      <Button
                        variant="danger"
                        disabled={remove.busy}
                        onClick={() => {
                          if (window.confirm(`Take "${t.name}" off the board?`)) remove.run({ toolId: t._id });
                        }}
                      >
                        Remove
                      </Button>
                    </div>
                  </>
                )}
              </li>
            ))}
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
  const what = e.kind === "overdue_reminder" ? "Reminder" : "Notification";
  return (
    <p className="mt-1 text-sm text-muted">
      {what} {e.status === "sent" ? "sent" : "failed"} {timeAgo(e.at)}
    </p>
  );
}

function Loans({ kind }: { kind: "incoming" | "requests" }) {
  const loans = useQuery(kind === "incoming" ? api.loans.incoming : api.loans.myRequests);
  const approve = useRun(useMutation(api.loans.approve));
  const decline = useRun(useMutation(api.loans.decline));
  const returned = useRun(useMutation(api.loans.markReturned));
  const cancel = useRun(useMutation(api.loans.cancel));
  const error = approve.error ?? decline.error ?? returned.error ?? cancel.error;
  const busy = approve.busy || decline.busy || returned.busy || cancel.busy;

  if (loans === undefined) return <Skeleton rows={2} />;
  if (loans.length === 0) {
    return kind === "incoming" ? (
      <Empty title="No one has asked yet">Requests to borrow your tools will show up here.</Empty>
    ) : (
      <Empty title="You haven't asked for anything">Find something under Borrow.</Empty>
    );
  }
  return (
    <section>
      {error && <div className="mb-4"><Notice>{error}</Notice></div>}
      <ul className="divide-y divide-line overflow-hidden rounded-xl bg-tag ring-1 ring-line">
        {loans.map((l: LoanView) => (
          <li key={l._id} className="flex flex-wrap items-center justify-between gap-4 px-5 py-4">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-display text-lg font-bold">{l.toolName}</span>
                <StatusPill status={l.status} overdue={l.overdue} />
              </div>
              <p className="mt-0.5 text-muted">
                {kind === "incoming" ? `${l.borrowerFirstName} wants it` : `${l.lenderFirstName}'s`}{" "}
                from {formatDate(l.startDate)} to {formatDate(l.endDate)}
              </p>
              <Activity items={l.activity} />
            </div>
            <div className="flex gap-2">
              {kind === "incoming" && l.status === "pending" && (
                <>
                  <Button disabled={busy} onClick={() => approve.run({ loanId: l._id })}>Approve</Button>
                  <Button variant="plain" disabled={busy} onClick={() => decline.run({ loanId: l._id })}>Decline</Button>
                </>
              )}
              {kind === "incoming" && l.status === "approved" && (
                <Button variant="plain" disabled={busy} onClick={() => returned.run({ loanId: l._id })}>
                  Mark returned
                </Button>
              )}
              {kind === "requests" && l.status === "pending" && (
                <Button variant="plain" disabled={busy} onClick={() => cancel.run({ loanId: l._id })}>
                  Cancel request
                </Button>
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
  const setTrusted = useRun(useMutation(api.users.setTrustedLender));
  const remove = useRun(useMutation(api.tools.remove));

  return (
    <section className="space-y-10">
      <div>
        <h2 className="mb-3 text-xl font-bold">Every loan</h2>
        {loans === undefined ? <Skeleton rows={1} /> : loans.length === 0 ? (
          <Empty title="No loans yet" />
        ) : (
          <div className="overflow-x-auto rounded-xl bg-tag ring-1 ring-line">
            <table className="w-full text-left text-[0.95rem]">
              <thead className="border-b border-line text-muted">
                <tr>
                  <th className="px-4 py-2.5 font-bold">Tool</th>
                  <th className="px-4 py-2.5 font-bold">Lender</th>
                  <th className="px-4 py-2.5 font-bold">Borrower</th>
                  <th className="px-4 py-2.5 font-bold">Dates</th>
                  <th className="px-4 py-2.5 font-bold">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {loans.map((l) => (
                  <tr key={l._id}>
                    <td className="px-4 py-2.5 font-bold">{l.toolName}</td>
                    <td className="px-4 py-2.5">{l.lenderFirstName}</td>
                    <td className="px-4 py-2.5">{l.borrowerFirstName}</td>
                    <td className="px-4 py-2.5">{formatDate(l.startDate)} to {formatDate(l.endDate)}</td>
                    <td className="px-4 py-2.5"><StatusPill status={l.status} overdue={l.overdue} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="grid gap-10 lg:grid-cols-2">
        <div>
          <h2 className="mb-3 text-xl font-bold">Neighbors</h2>
          {setTrusted.error && <div className="mb-3"><Notice>{setTrusted.error}</Notice></div>}
          <ul className="divide-y divide-line rounded-xl bg-tag ring-1 ring-line">
            {users?.map((u) => (
              <li key={u._id} className="flex items-center justify-between gap-3 px-4 py-3">
                <span>
                  {u.name}
                  {u.trustedLender && <span className="ml-2 text-sm font-bold text-steel">Trusted lender</span>}
                </span>
                <Button variant="quiet" onClick={() => setTrusted.run({ userId: u._id, trusted: !u.trustedLender })}>
                  {u.trustedLender ? "Remove trusted" : "Mark trusted"}
                </Button>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h2 className="mb-3 text-xl font-bold">Listings</h2>
          {remove.error && <div className="mb-3"><Notice>{remove.error}</Notice></div>}
          <ul className="divide-y divide-line rounded-xl bg-tag ring-1 ring-line">
            {tools?.map((t) => (
              <li key={t._id} className="flex items-center justify-between gap-3 px-4 py-3">
                <span>
                  {t.name} <span className="text-sm text-muted">by {t.isMine ? "you" : t.ownerFirstName}</span>
                </span>
                <Button
                  variant="quiet"
                  className="text-bad"
                  onClick={() => {
                    if (window.confirm(`Remove "${t.name}" for everyone?`)) remove.run({ toolId: t._id });
                  }}
                >
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
