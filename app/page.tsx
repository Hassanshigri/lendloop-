"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { SignInButton, useAuth } from "@clerk/nextjs";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { Empty, Skeleton, Wordmark } from "./ui";

type PublicTool = { _id: string; name: string; category: string };

// The public board never needs a login, so it uses a plain HTTP client that
// cannot be held up by the signed-in session.
const publicClient = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

function usePublicTools() {
  const [tools, setTools] = useState<PublicTool[] | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    const load = () =>
      publicClient
        .query(api.tools.listPublic, {})
        .then((t) => {
          if (alive) {
            setTools(t);
            setFailed(false);
          }
        })
        .catch(() => alive && setFailed(true));
    load();
    const timer = setInterval(load, 20_000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);
  return { tools, failed };
}

export default function Home() {
  const { tools, failed } = usePublicTools();
  const { isSignedIn } = useAuth();

  return (
    <div className="mx-auto w-full max-w-5xl px-5 pb-20">
      <header className="flex items-center justify-between py-6">
        <Wordmark />
        {isSignedIn ? (
          <Link href="/dashboard" className="font-bold text-steel underline-offset-4 hover:underline">
            Your dashboard
          </Link>
        ) : (
          <SignInButton mode="modal" forceRedirectUrl="/dashboard">
            <button className="font-bold text-steel underline-offset-4 hover:underline">Sign in</button>
          </SignInButton>
        )}
      </header>

      <section className="mt-8 grid items-end gap-8 md:mt-14 md:grid-cols-[1.4fr_1fr]">
        <div>
          <h1 className="font-display text-5xl font-extrabold sm:text-6xl">
            Borrow what you need. Lend what you don&apos;t.
          </h1>
          <p className="mt-5 max-w-[34rem] text-lg text-muted">
            The drill you use twice a year is the one your neighbor needs this weekend. List what sits in your
            shed, borrow what you&apos;re missing, and give it back when you&apos;re done.
          </p>
        </div>
        <div className="md:justify-self-end">
          {isSignedIn ? (
            <Link
              href="/dashboard"
              className="inline-block rounded-lg bg-yellow px-6 py-3.5 text-lg font-bold text-ink shadow-[inset_0_-3px_0_rgba(0,0,0,0.15)] hover:bg-yellow-deep"
            >
              Open your dashboard
            </Link>
          ) : (
            <SignInButton mode="modal" forceRedirectUrl="/dashboard">
              <button className="rounded-lg bg-yellow px-6 py-3.5 text-lg font-bold text-ink shadow-[inset_0_-3px_0_rgba(0,0,0,0.15)] hover:bg-yellow-deep">
                Sign in to lend or borrow
              </button>
            </SignInButton>
          )}
        </div>
      </section>

      <section aria-labelledby="board" className="mt-16">
        <div className="mb-5 flex items-baseline justify-between gap-4 border-b-2 border-ink pb-2">
          <h2 id="board" className="text-2xl font-bold">On the board right now</h2>
          {tools && tools.length > 0 && (
            <p className="text-muted">
              {tools.length} {tools.length === 1 ? "tool" : "tools"} ready to borrow
            </p>
          )}
        </div>

        {failed && !tools ? (
          <Empty title="The board didn't load">Check your connection. It retries every 20 seconds.</Empty>
        ) : tools === undefined ? (
          <Skeleton />
        ) : tools.length === 0 ? (
          <Empty title="Nothing hanging on the board yet">Sign in and list the first tool.</Empty>
        ) : (
          <ul className="grid gap-x-4 gap-y-5 sm:grid-cols-2 lg:grid-cols-3">
            {tools.map((t, i) => (
              <li
                key={t._id}
                className="hang-tag swing-in"
                style={{ animationDelay: `${Math.min(i, 8) * 60}ms` }}
              >
                <p className="font-display text-2xl font-bold">{t.name}</p>
                <p className="mt-1 capitalize text-muted">{t.category}</p>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-6 text-sm text-muted">
          Owner details and descriptions are only shown to signed-in neighbors.
        </p>
      </section>
    </div>
  );
}
