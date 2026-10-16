/**
 * Builds the Content-Security-Policy (CSP) header.
 *
 * A CSP is a list of rules the browser enforces about what a page may load or run. A strict one is
 * the main defence against cross-site scripting (XSS): even if an attacker manages to inject a
 * <script> into a page, the browser refuses to run it because it does not carry this request's
 * secret "nonce".
 *
 * It lives in its own pure function so it can be tested without starting the app.
 */
export interface CspOptions {
  /** A fresh random value for this single request. Scripts and styles must carry it to run. */
  nonce: string;
  /** Development needs two extra allowances (React debugging and hot reload). Never in production. */
  isDev: boolean;
  /** Origin of the Dumbbill API, so the browser may call it. */
  apiOrigin: string;
  /** Origin that receives Sentry error reports. Undefined when Sentry is off. */
  sentryOrigin?: string;
}

/** Turn a full URL such as "https://abc@o1.ingest.sentry.io/5" into its origin "https://o1.ingest.sentry.io". */
export function originOf(url: string): string {
  return new URL(url).origin;
}

export function buildContentSecurityPolicy({
  nonce,
  isDev,
  apiOrigin,
  sentryOrigin,
}: CspOptions): string {
  const connect = [
    "'self'",
    apiOrigin,
    ...(sentryOrigin ? [sentryOrigin] : []),
    ...(isDev ? ['ws:', 'wss:'] : []),
  ];

  const directives: Record<string, string[]> = {
    // Anything not listed below may only come from our own address.
    'default-src': ["'self'"],
    // Scripts run only with this request's nonce. 'strict-dynamic' lets those trusted scripts load
    // their own chunks. No third-party script is allowed anywhere, including the POS.
    'script-src': [
      "'self'",
      `'nonce-${nonce}'`,
      "'strict-dynamic'",
      ...(isDev ? ["'unsafe-eval'"] : []),
    ],
    // Style sheets: ours plus the nonce for framework-injected ones. Development uses 'unsafe-inline'
    // instead (a nonce would make browsers ignore it): the dev server injects styles on the fly for hot
    // reload and its error overlay, and would otherwise fill the console with warnings.
    'style-src': isDev ? ["'self'", "'unsafe-inline'"] : ["'self'", `'nonce-${nonce}'`],
    // Positioning styles set by UI libraries on elements (menus, popovers). Style attributes cannot
    // run code, so allowing them is low risk, and the component library needs them.
    'style-src-attr': ["'unsafe-inline'"],
    'img-src': ["'self'", 'blob:', 'data:'],
    'font-src': ["'self'"],
    'connect-src': connect,
    // The browser may not load plug-ins, change the base address, or post forms elsewhere.
    'object-src': ["'none'"],
    'base-uri': ["'self'"],
    'form-action': ["'self'"],
    // Nobody may embed this site in a frame (clickjacking).
    'frame-ancestors': ["'none'"],
  };

  const policy = Object.entries(directives)
    .map(([name, values]) => `${name} ${values.join(' ')}`)
    .join('; ');
  // Upgrade stray http:// links to https:// in production. Not in dev, where we run on plain http.
  return isDev ? policy : `${policy}; upgrade-insecure-requests`;
}

/**
 * Permissions-Policy: which powerful browser features a page may use.
 * USB and serial access (for receipt printers and scanners) is allowed ONLY on the POS pages.
 */
export function buildPermissionsPolicy(pathname: string): string {
  const isPos = pathname === '/pos' || pathname.startsWith('/pos/');
  const hardware = isPos ? '(self)' : '()';
  return `usb=${hardware}, serial=${hardware}, camera=(), microphone=(), geolocation=(), payment=()`;
}
