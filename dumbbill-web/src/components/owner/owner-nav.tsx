'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useCan } from '@/lib/auth/use-can';
import { cn } from '@/lib/cn';

/**
 * The owner area's main navigation. Settings links appear only for people who can manage settings; that is a
 * convenience, because the API refuses the calls behind them for everyone else anyway.
 * The page you are on is marked with `aria-current` so screen readers (and the bold style) show where you are.
 */
export function OwnerNav() {
  const t = useTranslations('Nav');
  const pathname = usePathname();
  const canManage = useCan('settings.manage');

  const links = [
    { href: '/', label: t('dashboard'), exact: true },
    { href: '/branches', label: t('branches'), exact: false },
    ...(canManage ? [{ href: '/settings/business', label: t('business'), exact: false }] : []),
    { href: '/pos', label: t('pos'), exact: false },
  ];

  return (
    <nav aria-label={t('main')} className="flex flex-wrap gap-4 text-small">
      {links.map((link) => {
        const current = link.exact ? pathname === link.href : pathname.startsWith(link.href);
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={current ? 'page' : undefined}
            className={cn(current ? 'font-medium' : 'text-muted hover:text-ink')}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
