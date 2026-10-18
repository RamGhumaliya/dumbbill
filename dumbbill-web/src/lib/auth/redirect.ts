/**
 * Where to send a person after they sign in: the page they were trying to open (`/login?next=/pos`).
 *
 * `next` comes from the address bar, so anyone can put anything in it. A link like
 * `/login?next=https://evil.example` that bounced a freshly signed-in owner to a look-alike site would be an
 * "open redirect": a classic way to phish people right after they typed their password. So only plain paths
 * inside THIS site are accepted; everything else falls back to the home screen.
 */

/** Pages that must never be a destination (they would send the person straight back to sign in or loop). */
const AUTH_PAGES = ['/login', '/signup', '/verify-email', '/forgot-password', '/reset-password'];

/**
 * @returns `value` when it is a safe in-site path, otherwise `fallback`.
 * Safe means: starts with a single "/", has no scheme or host, no backslash and no control characters
 * (browsers treat `/\evil.example` and `//evil.example` as other sites), and is not an auth page.
 */
export function safeNextPath(value: string | null | undefined, fallback = '/'): string {
  if (!value || value.length > 300) return fallback;
  if (!value.startsWith('/') || value.startsWith('//')) return fallback;
  if (value.includes('\\') || /[\u0000-\u001f\u007f]/.test(value)) return fallback;
  const path = value.split(/[?#]/)[0] ?? '';
  if (AUTH_PAGES.some((page) => path === page || path.startsWith(`${page}/`))) return fallback;
  return value;
}
