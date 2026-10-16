import type { Metadata } from 'next';
import localFont from 'next/font/local';
import { getLocale, getMessages, getTranslations } from 'next-intl/server';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { QueryProvider } from '@/components/providers/query-provider';
import { ToastProvider } from '@/components/ui';
import { getThemeChoice } from '@/lib/theme-server';
import { themeAttribute } from '@/lib/theme';
import './globals.css';

/*
 * One type system for both themes (design guide section 0), SELF-HOSTED from src/fonts (no request to Google
 * or any font service; builds work offline). Run `pnpm fonts` only when changing fonts.
 *   Inter Tight       interface text
 *   Barlow Condensed  totals, big numbers, headings
 *   JetBrains Mono    prices in tables, SKUs, barcodes
 *
 * Each font is loaded as two files: "latin" (letters and digits) and "latin-ext" (extra characters).
 * CSS stacks in src/styles/tailwind-theme.css list them in that order, so the extended file is only
 * downloaded when a page needs a character the first one lacks. Note: only Inter Tight contains the rupee
 * sign, which is why the numerals and code stacks fall back to Inter Tight for it.
 * `adjustFontFallback: false` stops Next from inserting an Arial stand-in ahead of the next font in the stack.
 */
const interTightLatin = localFont({
  src: '../fonts/inter-tight-latin-wght-normal.woff2',
  weight: '100 900',
  variable: '--font-ui-latin',
  display: 'swap',
  adjustFontFallback: false,
});
const interTightExt = localFont({
  src: '../fonts/inter-tight-latin-ext-wght-normal.woff2',
  weight: '100 900',
  variable: '--font-ui-ext',
  display: 'swap',
  preload: false,
  adjustFontFallback: false,
});

// next/font reads these options at build time, so they must be written out literally (no loops or templates).
const barlowLatin = localFont({
  src: [
    { path: '../fonts/barlow-condensed-latin-500-normal.woff2', weight: '500', style: 'normal' },
    { path: '../fonts/barlow-condensed-latin-600-normal.woff2', weight: '600', style: 'normal' },
    { path: '../fonts/barlow-condensed-latin-700-normal.woff2', weight: '700', style: 'normal' },
  ],
  variable: '--font-numerals-latin',
  display: 'swap',
  adjustFontFallback: false,
});
const barlowExt = localFont({
  src: [
    {
      path: '../fonts/barlow-condensed-latin-ext-500-normal.woff2',
      weight: '500',
      style: 'normal',
    },
    {
      path: '../fonts/barlow-condensed-latin-ext-600-normal.woff2',
      weight: '600',
      style: 'normal',
    },
    {
      path: '../fonts/barlow-condensed-latin-ext-700-normal.woff2',
      weight: '700',
      style: 'normal',
    },
  ],
  variable: '--font-numerals-ext',
  display: 'swap',
  preload: false,
  adjustFontFallback: false,
});

const jetBrainsLatin = localFont({
  src: '../fonts/jetbrains-mono-latin-wght-normal.woff2',
  weight: '100 800',
  variable: '--font-code-latin',
  display: 'swap',
  adjustFontFallback: false,
});
const jetBrainsExt = localFont({
  src: '../fonts/jetbrains-mono-latin-ext-wght-normal.woff2',
  weight: '100 800',
  variable: '--font-code-ext',
  display: 'swap',
  preload: false,
  adjustFontFallback: false,
});

/** All six font variables, applied to <html> so every element can use them. */
const fontVariables = [
  interTightLatin,
  interTightExt,
  barlowLatin,
  barlowExt,
  jetBrainsLatin,
  jetBrainsExt,
]
  .map((font) => font.variable)
  .join(' ');

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('Brand');
  return { title: { default: t('name'), template: `%s · ${t('name')}` } };
}

/**
 * The outer shell of every page: sets the language, the colour theme, the fonts, the translations,
 * the data-fetching provider, and a "skip to main content" link for keyboard and screen-reader users.
 */
export default async function RootLayout({ children }: { children: ReactNode }) {
  const [locale, messages, theme, t] = await Promise.all([
    getLocale(),
    getMessages(),
    getThemeChoice(),
    getTranslations('Common'),
  ]);

  return (
    <html
      lang={locale}
      // Set only when the user picked a theme; otherwise the device setting decides (see styles/tokens.css).
      data-theme={themeAttribute(theme)}
      className={fontVariables}
    >
      <body className="bg-base font-sans text-ink">
        {/* First thing a keyboard user reaches: jump past the header straight to the content. */}
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-control focus:bg-accent focus:px-3 focus:py-2 focus:text-on-accent"
        >
          {t('skipToContent')}
        </a>
        <NextIntlClientProvider messages={messages}>
          <QueryProvider>
            <ToastProvider>{children}</ToastProvider>
          </QueryProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
