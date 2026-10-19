import { create } from 'zustand';
import { onSignedOut } from '@/lib/api/auth';
import type { Access, AuthTenant, AuthUser } from '@/lib/api/schemas/auth';

/**
 * Who is signed in, as far as the screens are concerned.
 *
 *   restoring   the page just loaded and we are still asking the API whether a login exists (the access token
 *               lives only in memory, so every reload starts here)
 *   signedIn    we have an access token and know the person
 *   signedOut   there is no login: the screens behind it send the person to /login
 *
 * IMPORTANT: this only decides what the SCREEN shows. Hiding a screen is not security. The API refuses every
 * call without a valid token, and that is what actually protects the data.
 */
export type SessionStatus = 'restoring' | 'signedIn' | 'signedOut';

interface SessionState {
  status: SessionStatus;
  user: AuthUser | null;
  tenant: AuthTenant | null;
  /** What they may do (permissions, discount limit, branches). Screens use it to show or hide actions. */
  access: Access | null;
  /** True when the person chose to sign out (so the next screen says "you were signed out", not "continue where you were"). */
  choseToSignOut: boolean;
  /** Record a successful sign-in (or restore). */
  setSignedIn: (user: AuthUser, tenant: AuthTenant, access: Access) => void;
  /** Record that there is no login. Pass `deliberate` when the person asked to sign out. */
  setSignedOut: (deliberate?: boolean) => void;
  /** Change facts about the signed-in person (for example two-step sign-in was just switched on). */
  updateUser: (changes: Partial<AuthUser>) => void;
}

export const useSession = create<SessionState>()((set) => ({
  status: 'restoring',
  user: null,
  tenant: null,
  access: null,
  choseToSignOut: false,
  setSignedIn: (user, tenant, access) =>
    set({ status: 'signedIn', user, tenant, access, choseToSignOut: false }),
  setSignedOut: (deliberate = false) =>
    set({
      status: 'signedOut',
      user: null,
      tenant: null,
      access: null,
      choseToSignOut: deliberate,
    }),
  updateUser: (changes) =>
    set((state) => (state.user ? { user: { ...state.user, ...changes } } : state)),
}));

// When the API client finds the login dead (a refresh failed after a 401), the screens must hear about it.
onSignedOut(() => useSession.getState().setSignedOut(false));
