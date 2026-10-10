"use client";

import { usePathname, useRouter } from "next/navigation";
import { useCallback } from "react";
import { ApiError } from "@/lib/api-client";

/** Returns a handler that sends the player to sign in when the API says the session is gone. */
export function useAuthRedirect() {
  const router = useRouter();
  const pathname = usePathname();
  return useCallback(
    (error: unknown) => {
      if (error instanceof ApiError && error.status === 401) {
        router.replace(`/login?next=${encodeURIComponent(pathname)}`);
        return true;
      }
      return false;
    },
    [router, pathname],
  );
}
