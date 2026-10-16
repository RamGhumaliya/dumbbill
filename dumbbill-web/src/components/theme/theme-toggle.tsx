'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { THEME_CHOICES, type ThemeChoice } from '@/lib/theme';
import { applyThemeChoice } from '@/lib/theme-client';

/**
 * Lets the user pick System / Dark / Light.
 *
 * The choice is saved in a cookie (so the server renders the right theme next time, with no flash) and
 * applied immediately by setting `data-theme` on the page, which the CSS tokens react to.
 * `initial` comes from the server, which read the same cookie, so the buttons start in the right state.
 *
 * A "segmented control": three buttons sharing one outlined box. The selected one is filled with the accent
 * colour and announced with aria-pressed (so it never relies on colour alone: the screen reader says "pressed").
 */
export function ThemeToggle({ initial }: { initial: ThemeChoice }) {
  const t = useTranslations('Theme');
  const [choice, setChoice] = useState<ThemeChoice>(initial);

  function select(next: ThemeChoice) {
    setChoice(next);
    applyThemeChoice(next);
  }

  return (
    <div
      role="group"
      aria-label={t('label')}
      className="flex overflow-hidden rounded-control border border-control"
    >
      {THEME_CHOICES.map((value) => (
        <button
          key={value}
          type="button"
          aria-pressed={choice === value}
          onClick={() => select(value)}
          className="min-h-(--size-control-sm) px-3 text-caption font-medium text-muted transition-colors duration-(--duration-micro) ease-enter hover:bg-hover hover:text-ink aria-pressed:bg-accent aria-pressed:text-on-accent"
        >
          {t(value)}
        </button>
      ))}
    </div>
  );
}
