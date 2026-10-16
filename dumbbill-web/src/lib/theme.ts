/**
 * Colour theme choice: "system" (follow the device), "dark" or "light".
 *
 * The choice is kept in a cookie rather than in the browser's local storage so that the SERVER knows
 * it and can render the right theme from the very first byte. With local storage the page would first
 * paint in the wrong theme and then flash. The cookie lasts a year, which also means a POS terminal
 * remembers its theme between shifts.
 */
export const THEME_COOKIE = 'dumbbill-theme';

export const THEME_CHOICES = ['system', 'dark', 'light'] as const;
export type ThemeChoice = (typeof THEME_CHOICES)[number];

/** Read a cookie value safely: anything other than a known theme means "follow the device". */
export function parseThemeChoice(value: string | undefined): ThemeChoice {
  return value === 'dark' || value === 'light' ? value : 'system';
}

/** The value for the `data-theme` attribute, or undefined to let the device setting decide. */
export function themeAttribute(choice: ThemeChoice): 'dark' | 'light' | undefined {
  return choice === 'system' ? undefined : choice;
}

/** One year, in seconds. */
export const THEME_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;
