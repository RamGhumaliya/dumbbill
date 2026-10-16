/**
 * WCAG colour-contrast maths.
 *
 * The contrast ratio tells how readable one colour is on top of another, from 1 (identical) to 21
 * (black on white). The accessibility rules (WCAG 2.2) ask for at least:
 *   4.5  for normal text
 *   3    for large text and for the visible edges of controls and focus outlines
 * The design tokens are checked against these numbers automatically (see tokens.ts), so a colour that
 * is too faint can never be committed.
 */

/** "#1b1f23" or "#fff" -> [27, 31, 35]. Throws for anything that is not a hex colour. */
export function parseHex(hex: string): [number, number, number] {
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!match?.[1]) throw new Error(`Not a hex colour: "${hex}"`);
  const digits =
    match[1].length === 3
      ? match[1]
          .split('')
          .map((d) => d + d)
          .join('')
      : match[1];
  return [0, 2, 4].map((start) => parseInt(digits.slice(start, start + 2), 16)) as [
    number,
    number,
    number,
  ];
}

/** Relative luminance: how bright a colour appears to the human eye (0 = black, 1 = white). */
export function luminance(hex: string): number {
  const [r, g, b] = parseHex(hex).map((channel) => {
    const c = channel / 255;
    // Convert from the screen's gamma-encoded value to linear light.
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Contrast ratio between two hex colours (order does not matter). */
export function contrastRatio(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}
