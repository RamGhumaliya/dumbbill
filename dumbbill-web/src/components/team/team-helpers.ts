import type { PermissionInfo } from '@/lib/api/schemas/team';

/**
 * Small pure helpers for the team screens: percentage boxes, grouping the permission catalogue, and turning a ticked
 * list of abilities back into "extras" and "taken away" relative to a role. Kept apart from the components so they can be
 * unit-tested without a browser page.
 */

/**
 * Basis points as the text for a percentage box: 500 -> "5", 750 -> "7.5", null -> "" (use the role's limit).
 * (1 basis point = 0.01%, so 10,000 = 100%.) Works on whole numbers only, so there is no float rounding.
 */
export function bpToPercentText(basisPoints: number | null): string {
  if (basisPoints === null) return '';
  const whole = Math.floor(basisPoints / 100);
  const fraction = basisPoints % 100;
  if (fraction === 0) return String(whole);
  return `${whole}.${String(fraction).padStart(2, '0').replace(/0$/, '')}`;
}

/**
 * What a person typed in a percentage box, as basis points. Blank means "no value" (null). Returns `'invalid'` for
 * anything that is not 0 to 100 with at most two decimals. The digits are read as text, never as a float.
 */
export function percentTextToBp(text: string): number | null | 'invalid' {
  const trimmed = text.trim().replace(/%$/, '').trim();
  if (trimmed === '') return null;
  const match = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(trimmed);
  if (!match) return 'invalid';
  const basisPoints = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
  return basisPoints > 10_000 ? 'invalid' : basisPoints;
}

/** The permission catalogue split into its groups ("Products", "Stock", ...), keeping the server's order. */
export function groupPermissions(
  catalogue: readonly PermissionInfo[],
): Array<{ group: string; items: PermissionInfo[] }> {
  const groups = new Map<string, PermissionInfo[]>();
  for (const info of catalogue) {
    const items = groups.get(info.group) ?? [];
    items.push(info);
    groups.set(info.group, items);
  }
  return [...groups.entries()].map(([group, items]) => ({ group, items }));
}

/**
 * Compare what is ticked with what the role already gives: ticked-but-not-in-role are EXTRAS; in-role-but-unticked are
 * TAKEN AWAY. This is how a person's access is stored (role + extras - taken away), so the screen can show the final
 * result as one simple list of tick boxes.
 */
export function diffFromRole(
  rolePermissions: readonly string[],
  ticked: ReadonlySet<string>,
): { extra: string[]; denied: string[] } {
  const inRole = new Set(rolePermissions);
  return {
    extra: [...ticked].filter((key) => !inRole.has(key)).sort(),
    denied: rolePermissions.filter((key) => !ticked.has(key)).sort(),
  };
}
