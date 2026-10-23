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
  const canSeeProducts = useCan('products.read');
  const canBuy = useCan('purchases.write');
  const canReadAudit = useCan('audit.read');
  const canManageTeam = useCan('team.manage');

  const links = [
    { href: '/', label: t('dashboard'), exact: true },
    ...(canSeeProducts ? [{ href: '/products', label: t('products'), exact: false }] : []),
    ...(canSeeProducts ? [{ href: '/stock', label: t('stock'), exact: false }] : []),
    ...(canBuy
      ? [
          { href: '/purchases', label: t('purchases'), exact: false },
          { href: '/suppliers', label: t('suppliers'), exact: false },
        ]
      : []),
    { href: '/branches', label: t('branches'), exact: false },
    ...(canManage ? [{ href: '/settings/business', label: t('business'), exact: false }] : []),
    ...(canManageTeam ? [{ href: '/team', label: t('team'), exact: false }] : []),
    ...(canReadAudit ? [{ href: '/audit', label: t('audit'), exact: false }] : []),
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
