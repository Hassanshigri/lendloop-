"use client";

import { useAuth } from "@clerk/nextjs";
import { ConvexProviderWithAuth, ConvexReactClient } from "convex/react";
import { useCallback, useEffect, useMemo, useRef, type ReactNode } from "react";

const convex = new ConvexReactClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

// Convex pauses every query until the auth token arrives. If Clerk never
// returns one (expired dev session, blocked cookies, missing JWT template),
// the whole app would wait forever. After this many ms we continue signed out
// and the dashboard explains how to recover.
const TOKEN_TIMEOUT_MS = 8000;

function useClerkAuthForConvex() {
  const { isLoaded, isSignedIn, getToken, sessionId } = useAuth();
  // getToken is not guaranteed to be stable; keep the latest in a ref so the
  // fetcher below only changes when the session does.
  const getTokenRef = useRef(getToken);
  useEffect(() => {
    getTokenRef.current = getToken;
  }, [getToken]);

  const fetchAccessToken = useCallback(
    async ({ forceRefreshToken }: { forceRefreshToken: boolean }) => {
      if (!sessionId) return null;
      try {
        const token = getTokenRef.current({ template: "convex", skipCache: forceRefreshToken });
        const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), TOKEN_TIMEOUT_MS));
        return await Promise.race([token, timeout]);
      } catch {
        return null;
      }
    },
    [sessionId],
  );

  return useMemo(
    () => ({ isLoading: !isLoaded, isAuthenticated: isSignedIn ?? false, fetchAccessToken }),
    [isLoaded, isSignedIn, fetchAccessToken],
  );
}

export function ConvexClientProvider({ children }: { children: ReactNode }) {
  return (
    <ConvexProviderWithAuth client={convex} useAuth={useClerkAuthForConvex}>
      {children}
    </ConvexProviderWithAuth>
  );
}
