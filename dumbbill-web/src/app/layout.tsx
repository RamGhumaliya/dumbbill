import type { Metadata } from 'next';
import { Barlow_Condensed, Inter_Tight, JetBrains_Mono } from 'next/font/google';
import { getLocale, getMessages, getTranslations } from 'next-intl/server';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { QueryProvider } from '@/components/providers/query-provider';
import { getThemeChoice } from '@/lib/theme-server';
import { themeAttribute } from '@/lib/theme';
import './globals.css';

/*
 * One type system for both themes (design guide section 0):
 *   Inter Tight       interface text
 *   Barlow Condensed  totals, big numbers, headings
 *   JetBrains Mono    prices in tables, SKUs, barcodes
 * next/font downloads the font files at build time and serves them from our own address, so the
 * browser never contacts Google (good for privacy, speed and our strict security policy).
 */
const interTight = Inter_Tight({ subsets: ['latin'], variable: '--font-ui', display: 'swap' });
const barlowCondensed = Barlow_Condensed({
  subsets: ['latin'],
  weight: ['500', '600', '700'],
  variable: '--font-numerals',
  display: 'swap',
});
const jetBrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-code',
  display: 'swap',
});

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
      className={`${interTight.variable} ${barlowCondensed.variable} ${jetBrainsMono.variable}`}
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
          <QueryProvider>{children}</QueryProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
