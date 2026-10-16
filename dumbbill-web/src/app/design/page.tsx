import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Gallery } from '@/components/design/gallery';
import { SiteHeader } from '@/components/layout/site-header';
import { env } from '@/lib/env';

export const metadata: Metadata = { title: 'Design system' };

/**
 * The design-system gallery (/design). Only exists when NEXT_PUBLIC_DESIGN_GALLERY=true (development and the
 * test build). On the live site the setting is false, so this address answers "not found", exactly as if
 * the page had never been written.
 */
export default function DesignPage() {
  if (!env.NEXT_PUBLIC_DESIGN_GALLERY) notFound();

  return (
    <>
      <SiteHeader />
      <main id="main" className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
        <Gallery />
      </main>
    </>
  );
}
