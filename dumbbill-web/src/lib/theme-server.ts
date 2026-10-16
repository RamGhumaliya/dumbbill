import { cookies } from 'next/headers';
import { parseThemeChoice, THEME_COOKIE, type ThemeChoice } from './theme';

/** The user's saved theme choice, read from the request cookie. Server-only (it uses request headers). */
export async function getThemeChoice(): Promise<ThemeChoice> {
  const store = await cookies();
  return parseThemeChoice(store.get(THEME_COOKIE)?.value);
}
