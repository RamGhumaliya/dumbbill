/**
 * Turns a browser/app "User-Agent" string into a short human label for the session list,
 * for example "Chrome on Windows". The goal is only that a person can recognise their own devices
 * ("that is my shop laptop") and spot a stranger's; it does not need to be exact.
 */

/** Browser names, most specific first (Edge and Opera also say "Chrome" in their User-Agent). */
const BROWSERS: ReadonlyArray<readonly [RegExp, string]> = [
  [/Edg(e|A|iOS)?\//, 'Edge'],
  [/OPR\/|Opera/, 'Opera'],
  [/SamsungBrowser\//, 'Samsung Internet'],
  [/Firefox\/|FxiOS\//, 'Firefox'],
  [/Chrome\/|CriOS\//, 'Chrome'],
  [/Safari\//, 'Safari'],
];

/** Operating systems. Android and iPhone come before Linux/Mac because their strings mention those too. */
const SYSTEMS: ReadonlyArray<readonly [RegExp, string]> = [
  [/Android/, 'Android'],
  [/iPhone|iPad|iPod/, 'iOS'],
  [/Windows/, 'Windows'],
  [/Mac OS X|Macintosh/, 'macOS'],
  [/CrOS/, 'ChromeOS'],
  [/Linux/, 'Linux'],
];

/** Our own mobile apps send `Dumbbill/<version> (<os>)`-style agents; the Dart HTTP client says "Dart/". */
export function describeDevice(userAgent: string | undefined, clientType: string): string {
  const agent = userAgent ?? '';
  if (/^Dart\//.test(agent) || /Dumbbill/i.test(agent)) {
    const system = SYSTEMS.find(([pattern]) => pattern.test(agent))?.[1];
    return system ? `Dumbbill app on ${system}` : 'Dumbbill app';
  }
  const browser = BROWSERS.find(([pattern]) => pattern.test(agent))?.[1];
  const system = SYSTEMS.find(([pattern]) => pattern.test(agent))?.[1];
  if (browser && system) return `${browser} on ${system}`;
  if (browser) return browser;
  return clientType === 'MOBILE' ? 'Mobile app' : 'Unknown browser';
}
