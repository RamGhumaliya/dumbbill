import { THEME_COOKIE, THEME_COOKIE_MAX_AGE, themeAttribute, type ThemeChoice } from './theme';

/**
 * Applies and remembers a theme choice. Browser only (it touches `document`).
 *
 *  1. Sets or removes `data-theme` on the page, so the CSS tokens switch at once.
 *  2. Saves the choice in a cookie, so the server renders the right theme next time with no flash.
 *
 * Kept as a plain function (not inside a component) because it changes things outside React.
 */
export function applyThemeChoice(choice: ThemeChoice): void {
  const attribute = themeAttribute(choice);
  if (attribute) document.documentElement.setAttribute('data-theme', attribute);
  else document.documentElement.removeAttribute('data-theme'); // follow the device again

  // SameSite=Lax: sent on normal page loads, not on requests triggered by other sites.
  document.cookie = `${THEME_COOKIE}=${choice}; path=/; max-age=${THEME_COOKIE_MAX_AGE}; samesite=lax`;
}
