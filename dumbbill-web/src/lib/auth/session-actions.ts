import type { QueryClient } from '@tanstack/react-query';
import { authApi, currentCsrfToken, getBrowserApiClient, refreshBrowserLogin } from '@/lib/api';
import { clearAccessToken, setAccessToken } from '@/lib/api/auth';
import type { LoginResponse } from '@/lib/api/schemas/auth';
import { usePosCart } from '@/stores/pos-cart';
import { useSession } from '@/stores/session';

/**
 * The few actions that change who is signed in. Kept out of the components so they are easy to read, and so
 * every sign-in and sign-out does exactly the same things.
 */

/** Remember a successful sign-in: keep the access token in memory and tell the screens who is signed in. */
export function startSession(result: LoginResponse): void {
  setAccessToken(result.accessToken);
  useSession.getState().setSignedIn(result.user, result.tenant, result.access);
}

// React's development mode runs effects twice; a second restore must not start a second refresh.
let restoring: Promise<void> | undefined;

/**
 * Work out whether the person is already signed in (called once when a protected screen opens).
 *
 * The refresh cookie is the only thing that survives a page reload, so: renew the login with it, then ask who we
 * are. If either step fails, the person is simply signed out.
 */
export function restoreSession(): Promise<void> {
  restoring ??= (async () => {
    try {
      if (!(await refreshBrowserLogin())) {
        useSession.getState().setSignedOut();
        return;
      }
      const me = await authApi.getCurrentUser(getBrowserApiClient());
      useSession.getState().setSignedIn(me.user, me.tenant, me.access);
    } catch {
      // Could not reach the API or it refused: treat as signed out (the sign-in screen explains any outage).
      clearAccessToken();
      useSession.getState().setSignedOut();
    } finally {
      restoring = undefined;
    }
  })();
  return restoring;
}

/**
 * Sign out on this device.
 *
 * The server is told (so the refresh token stops working at once), but the screen is cleared even if that call
 * fails, because the person asked to leave. Everything held for the previous person is wiped: cached server data
 * and the bill being built at the till. On a shared shop computer the next person must never see either.
 */
export async function endSession(queryClient: QueryClient): Promise<void> {
  try {
    await authApi.logOut(getBrowserApiClient(), currentCsrfToken());
  } catch {
    // Offline or the session was already gone. Nothing more to do on the server side.
  }
  clearAccessToken();
  queryClient.clear();
  usePosCart.getState().clear();
  useSession.getState().setSignedOut(true);
}
