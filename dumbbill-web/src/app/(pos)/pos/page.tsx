import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { PosScreen } from '@/components/pos/pos-screen';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('Pos');
  return { title: t('title') };
}

/** The point-of-sale route (/pos). The interactive bill is a client component; see components/pos. */
export default function PosPage() {
  return <PosScreen />;
}
