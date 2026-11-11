"use client";

import Link from "next/link";
import { SignInButton, useAuth } from "@clerk/nextjs";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";

export default function Home() {
  const tools = useQuery(api.tools.listPublic);
  const { isSignedIn } = useAuth();

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-12">
      <header className="mb-10">
        <p className="text-sm font-semibold uppercase tracking-wide text-brand">LendLoop</p>
        <h1 className="mt-2 text-4xl font-bold">Borrow what you need. Lend what you don&apos;t.</h1>
        <p className="mt-3 text-stone-600">
          A neighborhood tool-lending board. Sign in to list a tool or ask to borrow one.
        </p>
        <div className="mt-6">
          {isSignedIn ? (
            <Link
              href="/dashboard"
              className="inline-block rounded-md bg-brand px-4 py-2 font-medium text-white hover:bg-brand-dark"
            >
              Open your dashboard
            </Link>
          ) : (
            <SignInButton mode="modal" forceRedirectUrl="/dashboard">
              <button className="rounded-md bg-brand px-4 py-2 font-medium text-white hover:bg-brand-dark">
                Sign in to lend or borrow
              </button>
            </SignInButton>
          )}
        </div>
      </header>

      <section aria-labelledby="available">
        <h2 id="available" className="mb-3 text-lg font-semibold">
          Available now
        </h2>
        {tools === undefined ? (
          <p className="text-stone-500">Loading tools…</p>
        ) : tools.length === 0 ? (
          <p className="text-stone-500">No tools listed yet. Be the first to lend one.</p>
        ) : (
          <ul className="divide-y divide-stone-200 rounded-lg border border-stone-200 bg-white">
            {tools.map((t) => (
              <li key={t._id} className="flex items-center justify-between px-4 py-3">
                <span className="font-medium">{t.name}</span>
                <span className="rounded-full bg-stone-100 px-2 py-0.5 text-xs capitalize text-stone-600">
                  {t.category}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
