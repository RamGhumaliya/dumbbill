import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

/**
 * Next.js settings.
 *
 * Security headers that never change are set here. The Content-Security-Policy changes on every
 * request (it contains a one-time "nonce"), so it is set in src/proxy.ts instead.
 */
const nextConfig: NextConfig = {
  // Do not advertise the framework in a response header.
  poweredByHeader: false,
  reactStrictMode: true,

  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          // Stop browsers from guessing a file's type (blocks "image that is really a script" tricks).
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          // Send only the site name, not the full address, to other sites when a link is followed.
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          // Nobody may put Dumbbill inside a frame on their own page (clickjacking). The CSP says the same
          // with frame-ancestors; this header covers older browsers.
          { key: 'X-Frame-Options', value: 'DENY' },
          // Keep other sites' windows from sharing a browsing context with ours.
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
          // Tell browsers to use HTTPS only (ignored on plain-http localhost, so it is safe in development).
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
        ],
      },
    ];
  },
};

// next-intl connects the translation files (messages/en.json) to the app. See src/i18n/request.ts.
const withNextIntl = createNextIntlPlugin();

export default withNextIntl(nextConfig);
