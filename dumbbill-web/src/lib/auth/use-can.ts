'use client';

import { useSession } from '@/stores/session';

/**
 * Does the signed-in person hold this permission? Used to show or hide buttons and menu items.
 *
 * This is a convenience only. The API checks the permission again on every call and refuses what is not allowed
 * (docs/api/team-and-permissions.md), so a hidden button is never the thing that protects anything.
 *
 * @param permission a key from the backend's permission catalogue, for example `settings.manage`.
 */
export function useCan(permission: string): boolean {
  return useSession((state) => state.access?.permissions.includes(permission) ?? false);
}
